#if os(iOS)
import Foundation
import UserNotifications

@MainActor
final class NativeSystemEventReminderNotificationCenter: NativeEventReminderNotificationCenter {
    private let center: UNUserNotificationCenter
    init(center: UNUserNotificationCenter = .current()) { self.center = center }

    func authorizationGranted() async -> Bool {
        let status = await center.notificationSettings().authorizationStatus
        return [.authorized, .provisional, .ephemeral].contains(status)
    }
    func pendingRequests() async -> [NativeEventReminderRequest] {
        await center.pendingNotificationRequests().map { request in
            let trigger = request.trigger as? UNCalendarNotificationTrigger
            return .init(identifier: request.identifier, title: request.content.title,
                         body: request.content.body,
                         fire: trigger?.repeats == false ? trigger?.nextTriggerDate() : nil)
        }
    }
    func add(_ request: NativeEventReminderRequest) async throws {
        guard let fire = request.fire else { throw NativeOfflineError.notPrepared }
        let content = UNMutableNotificationContent()
        content.title = request.title
        content.body = request.body
        content.sound = .default
        content.threadIdentifier = "pixl-event-reminders"
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        var components = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: fire)
        components.timeZone = calendar.timeZone
        try await center.add(UNNotificationRequest(
            identifier: request.identifier, content: content,
            trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)))
    }
    func removePending(_ identifiers: [String]) {
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
    }
    func deliveredIdentifiers() async -> [String] {
        await center.deliveredNotifications().map(\.request.identifier)
    }
    func removeDelivered(_ identifiers: [String]) {
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }
}

extension NativeLocalReminderEnvironment {
    static var live: Self {
        let vault = NativeOfflineVault.shared
        return .init(
            scope: { vault.namespace },
            canContinue: { vault.canContinue() },
            lease: { vault.lease.map { .init(linkID: $0.linkId, verifiedAt: $0.verifiedAt) } },
            readState: { try vault.read("local-event-reminders") },
            writeState: { try vault.write($0, key: "local-event-reminders") },
            schedule: {
                guard let data = try vault.read("get/supporter/schedule") else {
                    throw NativeOfflineError.notPrepared
                }
                let schedule = try JSONDecoder().decode(NativeSupporterSchedule.self, from: data)
                return .init(status: schedule.status, linkID: schedule.linkId, timezone: schedule.timezone,
                             events: schedule.events.map {
                    .init(shareToken: $0.shareToken, id: $0.eventId, date: $0.date, time: $0.time,
                          title: $0.title, type: $0.type, status: $0.status, timezone: $0.timezone)
                })
            },
            preparedTokens: { Set(vault.preparedEvents) },
            hasWorkspace: { try vault.read("workspace/" + $0) != nil },
            authorityError: NativeOfflineError.locked,
            now: { Date() },
            defaults: .standard)
    }
}
#endif
