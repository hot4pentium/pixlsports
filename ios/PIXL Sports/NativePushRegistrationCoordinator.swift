#if os(iOS)
import ClerkKit
import Combine
import SwiftUI
import UIKit
import UserNotifications

extension Notification.Name {
    static let nativePushTokenRegistered = Notification.Name("nativePushTokenRegistered")
    static let nativePushRegistrationFailed = Notification.Name("nativePushRegistrationFailed")
}

@MainActor
final class NativePushAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        NotificationCenter.default.post(
            name: .nativePushTokenRegistered,
            object: nil,
            userInfo: ["token": token, "environment": Self.apnsEnvironment]
        )
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        // Do not expose device tokens or provider details in user-visible errors.
        NotificationCenter.default.post(name: .nativePushRegistrationFailed, object: nil)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound, .badge])
    }

    private static var apnsEnvironment: String {
#if DEBUG
        "sandbox"
#else
        "production"
#endif
    }
}

@MainActor
final class NativePushRegistrationCoordinator: ObservableObject {
    @Published private(set) var isEnabled: Bool
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published var errorMessage: String?
    @Published private(set) var isUpdating = false

    private static let enabledKey = "pixl.native-push.enabled"
    private static let deviceIdKey = "pixl.native-push.device-id"
    private static let tokenKey = "pixl.native-push.token"
    private static let environmentKey = "pixl.native-push.environment"
    private static let registeredSubjectKey = "pixl.native-push.registered-subject"

    private let client = NativeAccountLinkClient()
    private var clerk: Clerk?
    private var tokenObserver: AnyCancellable?
    private var failureObserver: AnyCancellable?
    private var registering = false
    private var removing = false

    init() {
        isEnabled = UserDefaults.standard.bool(forKey: Self.enabledKey)
        tokenObserver = NotificationCenter.default.publisher(for: .nativePushTokenRegistered)
            .sink { [weak self] notification in
                guard let token = notification.userInfo?["token"] as? String,
                      let environment = notification.userInfo?["environment"] as? String else { return }
                Task { @MainActor [weak self] in
                    await self?.acceptToken(token, environment: environment)
                }
            }
        failureObserver = NotificationCenter.default.publisher(for: .nativePushRegistrationFailed)
            .sink { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.errorMessage = "Apple could not register this iPhone for alerts. Try again."
                }
            }
    }

    func configure(clerk: Clerk) async {
        self.clerk = clerk
        await refreshAuthorizationStatus()
        let local = NativeLocalEventReminderCoordinator.shared
        local.restore()
        if local.isSelected {
            guard authorizationIsGranted else {
                local.cancel()
                errorMessage = "Allow PIXL Sports alerts in iPhone Settings to resume saved reminders."
                return
            }
            await refreshLocalReminders(clerk: clerk)
            return
        }
        guard isEnabled else { return }
        guard authorizationIsGranted else {
            _ = await disable(clerk: clerk)
            return
        }
        UIApplication.shared.registerForRemoteNotifications()
        if let token = UserDefaults.standard.string(forKey: Self.tokenKey),
           let environment = UserDefaults.standard.string(forKey: Self.environmentKey) {
            await register(token, environment: environment, clerk: clerk)
        }
    }

    func enable(clerk: Clerk) async -> Bool {
        self.clerk = clerk
        if let scope = NativeOfflineVault.shared.namespace,
           let resume = UserDefaults.standard.object(forKey: NativeLocalEventReminderCoordinator.resumePushKey(scope: scope)) as? Date,
           resume > Date() {
            errorMessage = "To avoid repeating a saved reminder, push alerts can resume after \(resume.formatted(date: .abbreviated, time: .shortened)). You can use saved reminders again now."
            return false
        }
        guard await requestPermission() else { return false }
        errorMessage = nil
        UserDefaults.standard.set(true, forKey: Self.enabledKey)
        isEnabled = true
        UIApplication.shared.registerForRemoteNotifications()
        if let token = UserDefaults.standard.string(forKey: Self.tokenKey),
           let environment = UserDefaults.standard.string(forKey: Self.environmentKey) {
            await register(token, environment: environment, clerk: clerk)
        }
        return true
    }

    private func requestPermission() async -> Bool {
        await refreshAuthorizationStatus()
        if authorizationStatus == .notDetermined {
            do {
                _ = try await UNUserNotificationCenter.current().requestAuthorization(
                    options: [.alert, .sound, .badge]
                )
            } catch {
                errorMessage = "Notification permission could not be requested. Try again."
                return false
            }
            await refreshAuthorizationStatus()
        }
        guard authorizationIsGranted else {
            errorMessage = "Allow PIXL Sports alerts in iPhone Settings to turn them on."
            return false
        }

        return true
    }

    func setLocalReminders(_ enabled: Bool, clerk: Clerk) async {
        guard !isUpdating else { return }
        isUpdating = true
        defer { isUpdating = false }
        let local = NativeLocalEventReminderCoordinator.shared
        if !enabled {
            local.cancel(disable: true)
            errorMessage = nil
            return
        }
        guard NativeOfflineRuntime.shared.online else {
            errorMessage = "Connect once to verify your events and prepare saved reminders."
            return
        }
        guard await requestPermission() else { return }
        let subject = clerk.user?.id
        do {
            if let registered = UserDefaults.standard.string(forKey: Self.registeredSubjectKey),
               registered != subject {
                throw NativeAccountLinkError.message(
                    "Turn off alerts in the previous iPhone account before preparing saved reminders for this account."
                )
            }
            _ = try await client.getData("supporter/schedule", clerk: clerk)
            let scope = NativeOfflineVault.shared.namespace
            let data = try await client.getData("notifications/preferences", clerk: clerk)
            let preferences = try JSONDecoder().decode(NativeLocalReminderPreferences.self, from: data)
            guard subject != nil, subject == clerk.user?.id,
                  scope == NativeOfflineVault.shared.namespace,
                  NativeOfflineVault.shared.canContinue(subject: subject) else { throw NativeOfflineError.locked }
            // DELETE is account-authenticated and idempotent, even when APNs is
            // not configured. Never schedule on an uncertain server handoff.
            guard await disable(clerk: clerk) else { return }
            guard subject == clerk.user?.id, scope == NativeOfflineVault.shared.namespace,
                  NativeOfflineVault.shared.canContinue(subject: subject) else { throw NativeOfflineError.locked }
            try await local.activate(preferences: preferences)
            NativeOfflineRuntime.shared.resume(clerk: clerk, force: true)
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    private func refreshLocalReminders(clerk: Clerk) async {
        let subject = clerk.user?.id
        do {
            _ = try await client.getData("supporter/schedule", clerk: clerk)
            let scope = NativeOfflineVault.shared.namespace
            let data = try await client.getData("notifications/preferences", clerk: clerk)
            guard subject != nil, subject == clerk.user?.id,
                  scope == NativeOfflineVault.shared.namespace,
                  NativeOfflineVault.shared.canContinue(subject: subject) else { return }
            try await NativeLocalEventReminderCoordinator.shared.updatePreferences(
                JSONDecoder().decode(NativeLocalReminderPreferences.self, from: data))
            errorMessage = nil
        } catch {
            // A transient outage does not revoke the verified seven-day lease.
            await NativeLocalEventReminderCoordinator.shared.reconcile()
            errorMessage = "Using the last verified reminder settings. Reconnect to refresh them."
        }
    }

    /// Removes the current device token before signing out. A failed removal
    /// keeps the account signed in so the user can retry rather than leave an
    /// alert destination registered on the old account.
    func disable(clerk: Clerk) async -> Bool {
        self.clerk = clerk
        removing = true
        defer { removing = false }
        NativeLocalEventReminderCoordinator.shared.cancel(disable: true)
        // Drain a token refresh already in flight before DELETE. Otherwise its
        // late upsert could silently restore server push after the handoff.
        while registering {
            do { try await Task.sleep(for: .milliseconds(50)) }
            catch { return false }
        }
        do {
            let body = NativePushDeviceRemovalBody(
                deviceId: deviceId,
                environment: Self.apnsEnvironment
            )
            _ = try await client.postData(
                "notifications/subscriptions",
                body: body,
                method: "DELETE",
                clerk: clerk
            )
        } catch {
            if let failure = error as? NativeAccountLinkError,
               case let .serverStatus(status, _) = failure,
               status == 423 {
                // An already revoked/deletion-pending session cannot keep this
                // device registered again. Allow local sign-out recovery.
                clearAfterAccountRemoval()
                return true
            }
            errorMessage = error.localizedDescription
            return false
        }

        UserDefaults.standard.set(false, forKey: Self.enabledKey)
        UserDefaults.standard.removeObject(forKey: Self.registeredSubjectKey)
        isEnabled = false
        UIApplication.shared.unregisterForRemoteNotifications()
        errorMessage = nil
        return true
    }

    func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    /// The server already removed every delivery target for this identity.
    /// Do not attempt another authenticated unregister after session revocation.
    func clearAfterAccountRemoval() {
        NativeLocalEventReminderCoordinator.shared.cancel(disable: true, resetSelection: true)
        UserDefaults.standard.set(false, forKey: Self.enabledKey)
        UserDefaults.standard.removeObject(forKey: Self.tokenKey)
        UserDefaults.standard.removeObject(forKey: Self.environmentKey)
        UserDefaults.standard.removeObject(forKey: Self.registeredSubjectKey)
        isEnabled = false
        clerk = nil
        UIApplication.shared.unregisterForRemoteNotifications()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        errorMessage = nil
    }

    private var authorizationIsGranted: Bool {
        authorizationStatus == .authorized
            || authorizationStatus == .provisional
            || authorizationStatus == .ephemeral
    }

    private func refreshAuthorizationStatus() async {
        authorizationStatus = await UNUserNotificationCenter.current()
            .notificationSettings().authorizationStatus
    }

    private var deviceId: String {
        if let existing = UserDefaults.standard.string(forKey: Self.deviceIdKey) {
            return existing
        }
        let created = UUID().uuidString.lowercased()
        UserDefaults.standard.set(created, forKey: Self.deviceIdKey)
        return created
    }

    private static var apnsEnvironment: String {
#if DEBUG
        "sandbox"
#else
        "production"
#endif
    }

    private func acceptToken(_ token: String, environment: String) async {
        UserDefaults.standard.set(token, forKey: Self.tokenKey)
        UserDefaults.standard.set(environment, forKey: Self.environmentKey)
        guard isEnabled, !NativeLocalEventReminderCoordinator.shared.isSelected, let clerk else { return }
        await register(token, environment: environment, clerk: clerk)
    }

    private func register(_ token: String, environment: String, clerk: Clerk) async {
        guard isEnabled, !registering, !removing, !isUpdating,
              !NativeLocalEventReminderCoordinator.shared.isSelected else { return }
        registering = true
        defer { registering = false }
        let subject = clerk.user?.id
        do {
            let body = NativePushDeviceRegistrationBody(
                deviceId: deviceId,
                deviceToken: token,
                environment: environment
            )
            _ = try await client.postData(
                "notifications/subscriptions",
                body: body,
                clerk: clerk
            )
            guard subject == clerk.user?.id else { return }
            UserDefaults.standard.set(subject, forKey: Self.registeredSubjectKey)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct NativePushDeviceRegistrationBody: Encodable {
    let deviceId: String
    let deviceToken: String
    let environment: String
}

struct NativePushDeviceRemovalBody: Encodable {
    let deviceId: String
    let environment: String
}
#endif
