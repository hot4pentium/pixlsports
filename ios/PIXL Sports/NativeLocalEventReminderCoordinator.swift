#if os(iOS)
import Combine
import Foundation
import UserNotifications

/// Uses only the encrypted, verified native account vault. No email matching,
/// PWA identity, public Event Card, or unverified draft can authorize an alert.
@MainActor
final class NativeLocalEventReminderCoordinator: ObservableObject {
    static let shared = NativeLocalEventReminderCoordinator()
    static let prefix = "pixl.native.event."
    static func resumePushKey(scope: String) -> String {
        "pixl.native.local-reminders.push-resume." + scope
    }
    private static let selectedKey = "pixl.native.local-reminders.selected"
    private let key = "local-event-reminders"
    private let center = UNUserNotificationCenter.current()
    private var generation = 0
    private var running = false
    private var dirty = false
#if DEBUG
    var workCounts = NativeReminderWorkCounts()
#endif
    @Published private(set) var isEnabled = false
    @Published private(set) var status = ""
    @Published private(set) var errorMessage: String?
    var isSelected: Bool { UserDefaults.standard.bool(forKey: Self.selectedKey) }

    private struct State: Codable {
        var enabled: Bool
        var preferences: NativeLocalReminderPreferences
        let notBefore: Date
        var planned: [NativeLocalReminderPlan.Reminder]
        // Stable semantic IDs survive kickoff edits and cannot replay an alert
        // that may already have fired while the app was suspended.
        var consumed: [String: Date]
    }

    private var vault: NativeOfflineVault { .shared }
    private func state() -> State? {
        guard vault.canContinue(), let data = try? vault.read(key) else { return nil }
        return try? JSONDecoder().decode(State.self, from: data)
    }
    private func persist(_ state: State) throws {
        try vault.write(JSONEncoder().encode(state), key: key)
    }

    func restore() {
        isEnabled = isSelected && state()?.enabled == true
    }

    /// Called only after authenticated server unregister has acknowledged the
    /// handoff. A short quiet window excludes any already in-flight push.
    func activate(preferences: NativeLocalReminderPreferences) async throws {
        guard vault.canContinue() else { throw NativeOfflineError.locked }
        generation += 1
        var consumed = state()?.consumed ?? [:]
        for reminder in state()?.planned ?? [] where reminder.fire <= Date() {
            consumed[reminder.id] = reminder.expires
        }
        try persist(State(enabled: true, preferences: preferences, notBefore: Date().addingTimeInterval(120),
                          planned: [], consumed: consumed))
        UserDefaults.standard.set(true, forKey: Self.selectedKey)
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
        if let saved = state(), let scope = vault.namespace {
            let now = Date()
            let consumed = saved.planned.filter { $0.fire <= now }.map(\.expires)
                + Array(saved.consumed.values)
            let previous = UserDefaults.standard.object(forKey: Self.resumePushKey(scope: scope)) as? Date ?? .distantPast
            if let latest = consumed.max(), latest > previous {
                UserDefaults.standard.set(latest, forKey: Self.resumePushKey(scope: scope))
            }
        }
        cancelRoutineNotifications()
        if disable {
            do {
                if var saved = state() {
                    for reminder in saved.planned where reminder.fire <= Date() {
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
            UserDefaults.standard.set(false, forKey: Self.selectedKey)
        }
        isEnabled = false
        status = ""
    }

    func reconcile() async {
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
        guard isSelected, var saved = state(), saved.enabled,
              let scope = vault.namespace, let lease = vault.lease else {
            cancel()
            return
        }
        isEnabled = true
        generation += 1
        let revision = generation
#if DEBUG
        workCounts.settingsQueries += 1
#endif
        let settings = await center.notificationSettings()
        guard revision == generation, scope == vault.namespace, vault.canContinue() else { return }
#if DEBUG
        workCounts.pendingQueries += 1
#endif
        let pending = await center.pendingNotificationRequests()
        guard revision == generation, scope == vault.namespace, vault.canContinue() else { return }
        let routineIDs = pending.filter { $0.identifier.hasPrefix(Self.prefix) }.map(\.identifier)
        guard [.authorized, .provisional, .ephemeral].contains(settings.authorizationStatus) else {
            center.removePendingNotificationRequests(withIdentifiers: routineIDs)
            status = "Reminders paused. Allow notifications in iPhone Settings."
            return
        }
        do {
            guard let data = try vault.read("get/supporter/schedule") else { throw NativeOfflineError.notPrepared }
            let schedule = try JSONDecoder().decode(NativeSupporterSchedule.self, from: data)
            guard schedule.status == "linked", schedule.linkId == lease.linkId else { throw NativeOfflineError.locked }
            let now = Date()
            for reminder in saved.planned where reminder.fire <= now {
                saved.consumed[reminder.id] = reminder.expires
            }
            saved.consumed = saved.consumed.filter { $0.value > now }
            let prepared = Set(vault.preparedEvents)
            let events = schedule.events.filter {
                guard prepared.contains($0.shareToken), ["game", "practice"].contains($0.type),
                      !["completed", "cancelled", "canceled", "final"].contains($0.status) else { return false }
#if DEBUG
                workCounts.workspaceReads += 1
#endif
                return (try? vault.read("workspace/" + $0.shareToken)) != nil
            }.map {
                NativeLocalReminderPlan.Event(id: $0.eventId, date: $0.date,
                    start: NativeLocalReminderPlan.localInstant(date: $0.date, time: $0.time,
                        timezone: $0.timezone ?? schedule.timezone ?? saved.preferences.timezone),
                    title: $0.title, type: $0.type, timezone: $0.timezone ?? schedule.timezone)
            }
            let foreignCount = pending.filter {
                !$0.identifier.hasPrefix(Self.prefix)
                    && !$0.identifier.hasPrefix(NativeToolAvailabilityReminderCoordinator.prefix)
            }.count
            let reminders = Array(NativeLocalReminderPlan.reminders(events: events, preferences: saved.preferences,
                now: now, notBefore: saved.notBefore,
                leaseEnd: lease.verifiedAt.addingTimeInterval(7 * 24 * 3600),
                consumedIDs: Set(saved.consumed.keys)).prefix(max(0, 48 - foreignCount)))
            saved.planned = reminders
            // Persist intent before handing it to iOS. Interrupted work may skip
            // an alert, but cannot replay one on the next launch.
            try persist(saved)
            center.removePendingNotificationRequests(withIdentifiers: routineIDs)
            for reminder in reminders {
                guard revision == generation, scope == vault.namespace, vault.canContinue() else { return }
                let content = UNMutableNotificationContent()
                content.title = reminder.title
                content.body = reminder.body
                content.sound = .default
                content.threadIdentifier = "pixl-event-reminders"
                // Absolute UTC components do not drift when the phone travels.
                var calendar = Calendar(identifier: .gregorian)
                calendar.timeZone = TimeZone(secondsFromGMT: 0)!
                var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: reminder.fire)
                components.timeZone = calendar.timeZone
#if DEBUG
                workCounts.adds += 1
#endif
                try await center.add(UNNotificationRequest(
                    identifier: Self.prefix + reminder.id, content: content,
                    trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)))
                guard revision == generation, scope == vault.namespace, vault.canContinue() else {
                    center.removePendingNotificationRequests(withIdentifiers: [Self.prefix + reminder.id])
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
            guard revision == generation, scope == vault.namespace else { return }
            cancelRoutineNotifications()
            errorMessage = "Reminders could not be saved: \(error.localizedDescription)"
        }
    }

    private func cancelRoutineNotifications() {
        // Remove known requests synchronously before vault lock, and sweep only
        // this category. Fence late callbacks so a new rebuild cannot be erased.
        let ids = (state()?.planned ?? []).map { Self.prefix + $0.id }
        center.removePendingNotificationRequests(withIdentifiers: ids)
        let revision = generation
        Task { @MainActor in
            let pending = await center.pendingNotificationRequests()
            guard revision == generation else { return }
            center.removePendingNotificationRequests(withIdentifiers:
                pending.filter { $0.identifier.hasPrefix(Self.prefix) }.map(\.identifier))
            let delivered = await center.deliveredNotifications()
            guard revision == generation else { return }
            center.removeDeliveredNotifications(withIdentifiers:
                delivered.map(\.request.identifier).filter { $0.hasPrefix(Self.prefix) })
        }
    }
}
#endif
