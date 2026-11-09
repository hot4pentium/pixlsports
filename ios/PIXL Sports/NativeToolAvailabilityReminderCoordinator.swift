#if os(iOS)
import Combine
import Foundation
import UserNotifications

/// Per-phone opt-ins live in the existing encrypted, verified account vault.
/// No APNs registration or account-wide reminder preference is changed here.
@MainActor
final class NativeToolAvailabilityReminderCoordinator: ObservableObject {
    static let shared = NativeToolAvailabilityReminderCoordinator()
    static let prefix = "pixl.native.availability."
    private let key = "tool-availability-reminders"
    private let center = UNUserNotificationCenter.current()
    private var generation = 0
    private var accountGeneration = 0
    private var optInVersions: [String: Int] = [:]
    private var running = false
    private var dirty = false
    private var emptySweepScope: String?
    private var loadedScope: String?
    private var invalidationScheduled = false
#if DEBUG
    var workCounts = NativeReminderWorkCounts()
#endif
    @Published private(set) var selected = Set<String>()
    @Published private(set) var confirmed = Set<String>()
    @Published private(set) var busy = Set<String>()
    @Published private(set) var messages: [String: String] = [:]
    @Published private(set) var errorMessage: String?
    private var vault: NativeOfflineVault { .shared }

    private struct State: Codable {
        var selections: [String: NativeToolAvailabilityReminderPlan.Selection] = [:]
    }

    private struct Context {
        let eventID: String
        let start: Date?
        let ended: Bool
    }

    private func load() throws -> State {
        guard let bytes = try vault.read(key) else { return State() }
        do { return try JSONDecoder().decode(State.self, from: bytes) }
        catch { throw NativeOfflineError.corrupt }
    }

    private func persist(_ state: State) throws {
        try vault.write(JSONEncoder().encode(state), key: key)
        selected = Set(state.selections.filter { !$0.value.consumed }.keys)
        loadedScope = vault.namespace
    }

    /// Event-scoped invalidation never reads the vault or asks iOS about
    /// unrelated scores. Unknown account state always takes the full path.
    func invalidate(event token: String?) {
        guard loadedScope != vault.namespace || token == nil
                || token.map({ selected.contains($0) }) == true else { return }
        // Fence an in-flight OS add immediately, before the scheduled rebuild.
        generation += 1
        dirty = true
        if let token, let scope = vault.namespace {
            center.removePendingNotificationRequests(withIdentifiers: [
                NativeToolAvailabilityReminderPlan.requestID(scope: scope, token: token)
            ])
            confirmed.remove(token)
        }
        guard !running, !invalidationScheduled else { return }
        invalidationScheduled = true
        Task {
            invalidationScheduled = false
            await reconcile()
        }
    }

    private func valid(_ revision: Int, _ scope: String, _ subject: String) -> Bool {
        revision == generation && scope == vault.namespace && vault.canContinue(subject: subject)
    }

    private func validOptIn(_ accountRevision: Int, scope: String, subject: String, token: String, version: Int) -> Bool {
        accountRevision == accountGeneration && version == optInVersions[token, default: 0]
            && scope == vault.namespace && vault.canContinue(subject: subject)
    }

    private func contexts(subject: String, tokens: Set<String>) throws -> [String: Context] {
        guard let lease = vault.lease,
              let bytes = try vault.read("get/supporter/schedule", subject: subject) else {
            throw NativeOfflineError.notPrepared
        }
        let schedule = try JSONDecoder().decode(NativeSupporterSchedule.self, from: bytes)
        guard schedule.status == "linked", schedule.linkId == lease.linkId else { throw NativeOfflineError.locked }
        // Decode every pending file explicitly: unreadable local work must not
        // silently fall back to a stale server kickoff or deleted event.
        let changes = try vault.pendingEventCardIDs.map { id -> NativePendingEventCardChange in
            guard let data = try vault.read("pending/event-card/" + id, subject: subject) else {
                throw NativeOfflineError.corrupt
            }
            let change = try JSONDecoder().decode(NativePendingEventCardChange.self, from: data)
            guard change.id == id else { throw NativeOfflineError.corrupt }
            return change
        }
        var result: [String: Context] = [:]
        let prepared = Set(vault.preparedEvents)
        for event in schedule.events where tokens.contains(event.shareToken) {
            let change = changes.first {
                $0.id == event.eventId && ($0.shareToken == nil || $0.shareToken == event.shareToken)
            }
            let deleted = change?.operation == .delete
            let ended = deleted || event.type != "game" || ["final", "complete", "completed", "cancelled", "canceled"]
                .contains(event.status.lowercased())
            guard !ended else {
                result[event.shareToken] = Context(eventID: event.eventId, start: nil, ended: true)
                continue
            }
            guard prepared.contains(event.shareToken) else {
                result[event.shareToken] = Context(eventID: event.eventId, start: nil, ended: false)
                continue
            }
#if DEBUG
            workCounts.workspaceReads += 1
#endif
            guard let data = try vault.read("workspace/" + event.shareToken, subject: subject) else {
                result[event.shareToken] = Context(eventID: event.eventId, start: nil, ended: false)
                continue
            }
            let workspace = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
            guard workspace.linkId == lease.linkId else { throw NativeOfflineError.locked }
            let model = NativeEventToolModel.shared(shareToken: event.shareToken, accountID: subject)
            guard !model.unreadablePendingData else { throw NativeOfflineError.corrupt }
            let draft = change?.draft
            let start = NativeLocalReminderPlan.localInstant(
                date: draft?.date ?? event.date, time: draft?.time ?? event.time,
                timezone: draft?.timezone ?? event.timezone ?? schedule.timezone)
            result[event.shareToken] = Context(eventID: event.eventId, start: start,
                ended: model.trackerIsComplete || NativeEventDetailStep.gameIsComplete(
                    workspaceStatus: workspace.eventStatus, gameStatus: workspace.game?.status)
                    || (draft.map { $0.type != "game" } ?? false))
        }
        return result
    }

    func optIn(token: String, subject: String) async {
        guard !busy.contains(token) else { return }
        let accountRevision = accountGeneration
        let version = optInVersions[token, default: 0]
        busy.insert(token)
        defer { if accountRevision == accountGeneration { busy.remove(token) } }
        do {
            guard let scope = vault.namespace, vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
            var settings = await center.notificationSettings()
            guard validOptIn(accountRevision, scope: scope, subject: subject, token: token, version: version) else { return }
            if settings.authorizationStatus == .notDetermined {
                _ = try await center.requestAuthorization(options: [.alert, .sound])
                settings = await center.notificationSettings()
            }
            // Opening Apple's permission dialog can refresh the app's scene
            // and schedule. Recheck identity, not the ordinary rebuild counter.
            guard validOptIn(accountRevision, scope: scope, subject: subject, token: token, version: version) else { return }
            guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else {
                messages[token] = "Allow notifications in iPhone Settings to save a reminder. You can still use Record Moments."
                return
            }
            guard let context = try contexts(subject: subject, tokens: [token])[token], !context.ended,
                  let start = context.start, let lease = vault.lease else { throw NativeOfflineError.notPrepared }
            let selection = NativeToolAvailabilityReminderPlan.Selection(eventID: context.eventID, shareToken: token)
            guard NativeToolAvailabilityReminderPlan.opening(start: start, now: Date(),
                leaseEnd: lease.verifiedAt.addingTimeInterval(7 * 86400), selection: selection) != nil else {
                messages[token] = "No reminder was scheduled. Check the game time and refresh your saved event; the tools may already be available."
                return
            }
            var state = try load()
            let active = state.selections.values.filter {
                !$0.consumed && ($0.attemptedFire.map { $0 > Date() } ?? true)
            }
            guard active.contains(where: { $0.shareToken == token })
                    || active.count < NativeToolAvailabilityReminderPlan.limit else {
                messages[token] = "This iPhone already has 16 game-day tool reminders. Cancel another before adding one."
                return
            }
            state.selections[token] = selection
            try persist(state)
            confirmed.remove(token)
            messages[token] = "Scheduling your reminder…"
            await reconcile()
        } catch {
            guard accountRevision == accountGeneration, vault.canContinue(subject: subject),
                  version == optInVersions[token, default: 0] else { return }
            messages[token] = "Reminder not confirmed. \(error.localizedDescription)"
        }
    }

    func cancel(token: String, subject: String) {
        guard vault.canContinue(subject: subject), let scope = vault.namespace else { return }
        generation += 1
        optInVersions[token, default: 0] += 1
        do {
            var state = try load()
            state.selections.removeValue(forKey: token)
            try persist(state)
            let id = NativeToolAvailabilityReminderPlan.requestID(scope: scope, token: token)
            center.removePendingNotificationRequests(withIdentifiers: [id])
            center.removeDeliveredNotifications(withIdentifiers: [id])
            confirmed.remove(token)
            messages[token] = "Reminder cancelled."
            Task { await reconcile() }
        } catch { messages[token] = "Couldn’t cancel the reminder. \(error.localizedDescription)" }
    }

    func eventChanged(token: String, subject: String, deleted: Bool) {
        guard vault.canContinue(subject: subject), let scope = vault.namespace else { return }
        if deleted {
            cancel(token: token, subject: subject)
            return
        }
        generation += 1
        do {
            var state = try load()
            guard var entry = state.selections[token] else { return }
            // We know this future request is being cancelled before it fires.
            // Do not later mistake that cancelled instant for a delivered alert.
            if let fire = entry.attemptedFire, fire > Date(), !entry.consumed {
                entry.attemptedFire = nil
            }
            state.selections[token] = entry
            try persist(state)
            center.removePendingNotificationRequests(withIdentifiers: [
                NativeToolAvailabilityReminderPlan.requestID(scope: scope, token: token)
            ])
            confirmed.remove(token)
            messages[token] = "Updating the reminder for your changed event…"
            Task { await reconcile() }
        } catch { messages[token] = "Reminder update not confirmed. \(error.localizedDescription)" }
    }

    /// Only account lock/clear calls this broad cancellation. Routine reminder
    /// preference changes must never cancel a different category.
    func cancelForAccount() {
        generation += 1
        accountGeneration += 1
        optInVersions = [:]
        dirty = false
        selected = []
        confirmed = []
        busy = []
        messages = [:]
        errorMessage = nil
        emptySweepScope = nil
        loadedScope = nil
        center.removeAllPendingNotificationRequests()
        center.removeAllDeliveredNotifications()
    }

    func reconcile() async {
        generation += 1
        dirty = true
        guard !running else { return }
        running = true
        defer { running = false }
        while dirty {
            dirty = false
            await rebuild()
        }
    }

    private func rebuild() async {
#if DEBUG
        workCounts.rebuilds += 1
#endif
        guard let scope = vault.namespace, let subject = vault.subject,
              let lease = vault.lease, vault.canContinue(subject: subject) else {
            cancelForAccount()
            return
        }
        let revision = generation
        do {
            var state = try load()
            selected = Set(state.selections.filter { !$0.value.consumed }.keys)
            loadedScope = scope
            if state.selections.values.allSatisfy({ $0.consumed }) {
                selected = []
                confirmed = []
                if emptySweepScope != scope {
#if DEBUG
                    workCounts.pendingQueries += 1
#endif
                    let pending = await center.pendingNotificationRequests()
                    guard valid(revision, scope, subject) else { return }
                    center.removePendingNotificationRequests(withIdentifiers:
                        pending.filter { $0.identifier.hasPrefix(Self.prefix) }.map(\.identifier))
                    emptySweepScope = scope
                }
                errorMessage = nil
                return
            }
            emptySweepScope = nil
            let now = Date()
            // Consumed opt-ins require no workspace/model load. Re-arming
            // after a postponed game always requires another explicit tap.
            let activeTokens = Set(state.selections.filter {
                !$0.value.consumed && ($0.value.attemptedFire.map { $0 > now } ?? true)
            }.keys)
            let eventContexts = try contexts(subject: subject, tokens: activeTokens)
#if DEBUG
            workCounts.settingsQueries += 1
#endif
            let settings = await center.notificationSettings()
            guard valid(revision, scope, subject) else { return }
#if DEBUG
            workCounts.pendingQueries += 1
#endif
            let pending = await center.pendingNotificationRequests()
            guard valid(revision, scope, subject) else { return }
            let authorized = [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus)
            // Routine reminders reserve at most 48; this category reserves 16.
            // Both also subtract unknown categories, so concurrent rebuilds
            // cannot collectively exceed iOS's 64-request limit.
            let foreignCount = pending.filter {
                !$0.identifier.hasPrefix(Self.prefix)
                    && !$0.identifier.hasPrefix(NativeLocalEventReminderCoordinator.prefix)
            }.count
            let capacity = NativeToolAvailabilityReminderPlan.capacity(otherCategoryCount: foreignCount)
            var plans: [(String, Date)] = []
            let checkedAt = Date()
            for token in Array(state.selections.keys) {
                guard var entry = state.selections[token] else { continue }
                if entry.attemptedFire.map({ $0 <= checkedAt }) == true { entry.consumed = true }
                if entry.consumed {
                    state.selections[token] = entry
                    messages[token] = "The previous reminder time has passed."
                    continue
                }
                guard let context = eventContexts[token], context.eventID == entry.eventID else {
                    messages[token] = "This event is no longer available. Its reminder is cancelled."
                    state.selections.removeValue(forKey: token)
                    continue
                }
                if context.ended {
                    state.selections.removeValue(forKey: token)
                    messages[token] = "The event has ended or was removed. Its reminder is cancelled."
                    continue
                }
                state.selections[token] = entry
                if !authorized {
                    messages[token] = "Reminders are paused. Allow notifications in iPhone Settings."
                } else if let fire = NativeToolAvailabilityReminderPlan.opening(
                    start: context.start, now: checkedAt, leaseEnd: lease.verifiedAt.addingTimeInterval(7 * 86400), selection: entry) {
                    plans.append((token, fire))
                } else {
                    messages[token] = "No reminder scheduled. Check the start time or refresh your verified event closer to game day."
                }
            }
            plans.sort { $0.1 == $1.1 ? $0.0 < $1.0 : $0.1 < $1.1 }
            for (token, _) in plans.dropFirst(capacity) {
                messages[token] = "iPhone reminder storage is full. Cancel another reminder and try again."
            }
            plans = Array(plans.prefix(capacity))
            let wanted = Dictionary(uniqueKeysWithValues: plans.map {
                (NativeToolAvailabilityReminderPlan.requestID(scope: scope, token: $0.0), $0.1)
            })
            let obsolete = pending.filter { request in
                guard request.identifier.hasPrefix(Self.prefix) else { return false }
                guard let fire = wanted[request.identifier],
                      let trigger = request.trigger as? UNCalendarNotificationTrigger else { return true }
                return trigger.nextTriggerDate().map { abs($0.timeIntervalSince(fire)) > 1 } ?? true
            }.map(\.identifier)
            center.removePendingNotificationRequests(withIdentifiers: obsolete)
            confirmed = []
            // Persist consumption and intent before asking iOS. An interrupted
            // add may skip an alert, but cannot replay a possibly delivered one.
            for (token, fire) in plans { state.selections[token]?.attemptedFire = fire }
            try persist(state)
            for (token, fire) in plans {
                guard valid(revision, scope, subject) else { return }
                guard fire > Date() else {
                    state.selections[token]?.consumed = true
                    try persist(state)
                    messages[token] = "The reminder time has passed. Check the tools’ current availability."
                    continue
                }
                let id = NativeToolAvailabilityReminderPlan.requestID(scope: scope, token: token)
                if !pending.contains(where: { $0.identifier == id && !obsolete.contains(id) }) {
                    let content = UNMutableNotificationContent()
                    content.title = "Stats and Live Taps are available"
                    content.body = "Open your Event Card in PIXL Sports to choose a game-day tool."
                    content.sound = .default
                    content.threadIdentifier = "pixl-tool-availability"
                    content.categoryIdentifier = "PIXL_TOOL_AVAILABILITY"
                    var calendar = Calendar(identifier: .gregorian)
                    calendar.timeZone = TimeZone(secondsFromGMT: 0)!
                    var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: fire)
                    components.timeZone = calendar.timeZone
                    do {
#if DEBUG
                        workCounts.adds += 1
#endif
                        try await center.add(UNNotificationRequest(identifier: id, content: content,
                            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)))
                    } catch {
                        guard valid(revision, scope, subject) else { return }
                        messages[token] = "iPhone couldn’t save this reminder. Cancel it and try again."
                        continue
                    }
                    guard valid(revision, scope, subject) else {
                        center.removePendingNotificationRequests(withIdentifiers: [id])
                        return
                    }
                }
                confirmed.insert(token)
                messages[token] = "Reminder saved on this iPhone."
            }
            errorMessage = nil
        } catch {
            guard valid(revision, scope, subject) else { return }
            confirmed = []
            errorMessage = "Reminders couldn’t be checked. \(error.localizedDescription)"
#if DEBUG
            workCounts.pendingQueries += 1
#endif
            let pending = await center.pendingNotificationRequests()
            guard valid(revision, scope, subject) else { return }
            center.removePendingNotificationRequests(withIdentifiers:
                pending.filter { $0.identifier.hasPrefix(Self.prefix) }.map(\.identifier))
        }
    }
}
#endif
