import Foundation
#if canImport(Combine)
import Combine
#endif

/// Uses only the encrypted, verified native account vault. No email matching,
/// PWA identity, public Event Card, or unverified draft can authorize an alert.
@MainActor
final class NativeLocalEventReminderCoordinator {
#if os(iOS)
    static let shared = NativeLocalEventReminderCoordinator(
        environment: .live, center: NativeSystemEventReminderNotificationCenter())
#endif
    static let prefix = "pixl.native.event."
    static func resumePushKey(scope: String) -> String {
        "pixl.native.local-reminders.push-resume." + scope
    }
    private static let selectedKey = "pixl.native.local-reminders.selected"
    private let environment: NativeLocalReminderEnvironment
    private let center: NativeEventReminderNotificationCenter
    private var generation = 0
    private var running = false
    private var dirty = false
#if DEBUG
    var workCounts = NativeReminderWorkCounts()
#endif
#if canImport(Combine)
    @Published private(set) var isEnabled = false
    @Published private(set) var status = ""
    @Published private(set) var errorMessage: String?
#else
    private(set) var isEnabled = false
    private(set) var status = ""
    private(set) var errorMessage: String?
#endif
    var isSelected: Bool { environment.defaults.bool(forKey: Self.selectedKey) }

    init(environment: NativeLocalReminderEnvironment, center: NativeEventReminderNotificationCenter) {
        self.environment = environment
        self.center = center
    }

    private struct State: Codable {
        var enabled: Bool
        var preferences: NativeLocalReminderPreferences
        let notBefore: Date
        var planned: [NativeLocalReminderPlan.Reminder]
        // Stable semantic IDs survive kickoff edits and cannot replay an alert
        // that may already have fired while the app was suspended.
        var consumed: [String: Date]
    }

    private func state() -> State? {
        guard environment.canContinue(), let data = try? environment.readState() else { return nil }
        return try? JSONDecoder().decode(State.self, from: data)
    }
    private func persist(_ state: State) throws {
        try environment.writeState(JSONEncoder().encode(state))
    }
    private func isCurrent(_ revision: Int, scope: String) -> Bool {
        !Task.isCancelled && revision == generation
            && scope == environment.scope() && environment.canContinue()
    }

    func restore() {
        isEnabled = isSelected && state()?.enabled == true
    }

    /// Called only after authenticated server unregister has acknowledged the
    /// handoff. A short quiet window excludes any already in-flight push.
    func activate(preferences: NativeLocalReminderPreferences) async throws {
        guard environment.canContinue() else { throw environment.authorityError }
        generation += 1
        var consumed = state()?.consumed ?? [:]
        for reminder in state()?.planned ?? [] where reminder.fire <= environment.now() {
            consumed[reminder.id] = reminder.expires
        }
        try persist(State(enabled: true, preferences: preferences, notBefore: environment.now().addingTimeInterval(120),
                          planned: [], consumed: consumed))
        environment.defaults.set(true, forKey: Self.selectedKey)
        isEnabled = true
        await reconcile()
    }

    func updatePreferences(_ preferences: NativeLocalReminderPreferences) async throws {
        guard var saved = state(), saved.enabled else { return }
        saved.preferences = preferences
        try persist(saved)
        await reconcile()
    }

    /// Synchronous cancellation is also called before vault lock/clear, so an
    /// interrupted sign-out or ownership change cannot leave private requests.
    func cancel(disable: Bool = false, resetSelection: Bool = false) {
        generation += 1
        if let saved = state(), let scope = environment.scope() {
            let now = environment.now()
            let consumed = saved.planned.filter { $0.fire <= now }.map(\.expires)
                + Array(saved.consumed.values)
            let previous = environment.defaults.object(forKey: Self.resumePushKey(scope: scope)) as? Date ?? .distantPast
            if let latest = consumed.max(), latest > previous {
                environment.defaults.set(latest, forKey: Self.resumePushKey(scope: scope))
            }
        }
        cancelRoutineNotifications()
        if disable {
            do {
                if var saved = state() {
                    for reminder in saved.planned where reminder.fire <= environment.now() {
                        saved.consumed[reminder.id] = reminder.expires
                    }
                    saved.planned = []
                    saved.enabled = false
                    try persist(saved)
                }
            }
            catch { errorMessage = error.localizedDescription }
        }
        if disable || resetSelection {
            environment.defaults.set(false, forKey: Self.selectedKey)
        }
        isEnabled = false
        status = ""
    }

    func reconcile() async {
        dirty = true
        guard !running else { return }
        running = true
        defer { running = false }
        while dirty && !Task.isCancelled {
            dirty = false
            await rebuild()
        }
    }

    private func rebuild() async {
#if DEBUG
        workCounts.rebuilds += 1
#endif
        guard isSelected, var saved = state(), saved.enabled,
              let scope = environment.scope(), let lease = environment.lease() else {
            cancel()
            return
        }
        isEnabled = true
        generation += 1
        let revision = generation
#if DEBUG
        workCounts.settingsQueries += 1
#endif
        let authorized = await center.authorizationGranted()
        guard isCurrent(revision, scope: scope) else { return }
#if DEBUG
        workCounts.pendingQueries += 1
#endif
        let pending = await center.pendingRequests()
        guard isCurrent(revision, scope: scope) else { return }
        let routineIDs = pending.filter { $0.identifier.hasPrefix(Self.prefix) }.map(\.identifier)
        guard authorized else {
            center.removePending(routineIDs)
            status = "Reminders paused. Allow notifications in iPhone Settings."
            return
        }
        do {
            let schedule = try environment.schedule()
            guard schedule.status == "linked", schedule.linkID == lease.linkID else {
                throw environment.authorityError
            }
            let now = environment.now()
            for reminder in saved.planned where reminder.fire <= now {
                saved.consumed[reminder.id] = reminder.expires
            }
            saved.consumed = saved.consumed.filter { $0.value > now }
            let prepared = environment.preparedTokens()
            let events = schedule.events.filter {
                guard prepared.contains($0.shareToken), ["game", "practice"].contains($0.type),
                      !["completed", "cancelled", "canceled", "final"].contains($0.status) else { return false }
#if DEBUG
                workCounts.workspaceReads += 1
#endif
                return (try? environment.hasWorkspace($0.shareToken)) == true
            }.map {
                NativeLocalReminderPlan.Event(id: $0.id, date: $0.date,
                    start: NativeLocalReminderPlan.localInstant(date: $0.date, time: $0.time,
                        timezone: $0.timezone ?? schedule.timezone ?? saved.preferences.timezone),
                    title: $0.title, type: $0.type, timezone: $0.timezone ?? schedule.timezone)
            }
            let foreignCount = pending.filter {
                !$0.identifier.hasPrefix(Self.prefix)
                    && !$0.identifier.hasPrefix(NativeLocalReminderEnvironment.toolReminderPrefix)
            }.count
            let reminders = Array(NativeLocalReminderPlan.reminders(events: events, preferences: saved.preferences,
                now: now, notBefore: saved.notBefore,
                leaseEnd: lease.verifiedAt.addingTimeInterval(7 * 24 * 3600),
                consumedIDs: Set(saved.consumed.keys)).prefix(max(0, 48 - foreignCount)))
            saved.planned = reminders
            // Persist intent before handing it to iOS. Interrupted work may skip
            // an alert, but cannot replay one on the next launch.
            try persist(saved)
            let wanted = Set(reminders.map { Self.prefix + $0.id })
            center.removePending(routineIDs.filter { !wanted.contains($0) })
            let existing = Dictionary(pending.map { ($0.identifier, $0) }, uniquingKeysWith: { _, last in last })
            for reminder in reminders {
                guard isCurrent(revision, scope: scope) else { return }
                let request = NativeEventReminderRequest(
                    identifier: Self.prefix + reminder.id, title: reminder.title,
                    body: reminder.body, fire: reminder.fire)
                // Coalesced reconciliations must not re-submit an unchanged
                // accepted request. A changed kickoff still replaces the same ID.
                if existing[request.identifier] == request { continue }
#if DEBUG
                workCounts.adds += 1
#endif
                try await center.add(request)
                guard isCurrent(revision, scope: scope) else {
                    center.removePending([request.identifier])
                    return
                }
            }
            if let next = reminders.first {
                let formatter = DateFormatter()
                formatter.locale = Locale(identifier: "en_US_POSIX")
                formatter.timeZone = .current
                formatter.dateFormat = "EEE, MMM d 'at' h:mm a"
                status = "\(reminders.count) reminders saved on this iPhone. Next: \(formatter.string(from: next.fire))."
            } else {
                status = "No future reminders are currently saved on this iPhone. Only downloaded, verified events can have offline reminders."
            }
            errorMessage = nil
        } catch {
            guard revision == generation, scope == environment.scope() else { return }
            cancelRoutineNotifications()
            status = ""
            errorMessage = "Reminders could not be saved: \(error.localizedDescription)"
        }
    }

    private func cancelRoutineNotifications() {
        // Remove known requests synchronously before vault lock, and sweep only
        // this category. Fence late callbacks so a new rebuild cannot be erased.
        let ids = (state()?.planned ?? []).map { Self.prefix + $0.id }
        center.removePending(ids)
        let revision = generation
        Task { @MainActor in
            let pending = await center.pendingRequests()
            guard revision == generation else { return }
            center.removePending(
                pending.filter { $0.identifier.hasPrefix(Self.prefix) }.map(\.identifier))
            let delivered = await center.deliveredIdentifiers()
            guard revision == generation else { return }
            center.removeDelivered(delivered.filter { $0.hasPrefix(Self.prefix) })
        }
    }
}
#if canImport(Combine)
extension NativeLocalEventReminderCoordinator: ObservableObject {}
#endif
