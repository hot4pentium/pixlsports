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
    @Published private(set) var isEnabled = UserDefaults.standard.bool(forKey: Self.enabledKey)
    @Published private(set) var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @Published var errorMessage: String?

    private static let enabledKey = "pixl.native-push.enabled"
    private static let deviceIdKey = "pixl.native-push.device-id"
    private static let tokenKey = "pixl.native-push.token"
    private static let environmentKey = "pixl.native-push.environment"

    private let client = NativeAccountLinkClient()
    private var clerk: Clerk?
    private var tokenObserver: AnyCancellable?
    private var failureObserver: AnyCancellable?

    init() {
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

    /// Removes the current device token before signing out. A failed removal
    /// keeps the account signed in so the user can retry rather than leave an
    /// alert destination registered on the old account.
    func disable(clerk: Clerk) async -> Bool {
        self.clerk = clerk
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
            errorMessage = error.localizedDescription
            return false
        }

        UserDefaults.standard.set(false, forKey: Self.enabledKey)
        isEnabled = false
        UIApplication.shared.unregisterForRemoteNotifications()
        errorMessage = nil
        return true
    }

    func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
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
        guard isEnabled, let clerk else { return }
        await register(token, environment: environment, clerk: clerk)
    }

    private func register(_ token: String, environment: String, clerk: Clerk) async {
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
