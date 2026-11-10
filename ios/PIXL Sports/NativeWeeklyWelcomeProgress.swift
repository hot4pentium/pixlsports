import Foundation

/// Eligibility is explicitly recorded during initial athlete setup.
/// A missing preference must never enroll an established account.
struct NativeWeeklyWelcomeProgress {
    let storageKey: String
    private let defaults: UserDefaults
    private var notificationSetupKey: String { storageKey + ".event-card-alerts" }

    init(instance: String, userID: String, defaults: UserDefaults = .standard) {
        self.storageKey = "pixl.native.weekly-welcome.\(instance).\(userID)"
        self.defaults = defaults
    }

    var isPending: Bool {
        defaults.string(forKey: storageKey) == "pending"
    }

    var isNotificationSetupPending: Bool {
        defaults.string(forKey: notificationSetupKey) == "pending"
    }

    func beginInitialSetup() {
        if defaults.object(forKey: storageKey) == nil {
            defaults.set("pending", forKey: storageKey)
        }
        if defaults.string(forKey: storageKey) == "pending",
           defaults.object(forKey: notificationSetupKey) == nil {
            defaults.set("pending", forKey: notificationSetupKey)
        }
    }

    func acknowledgeNotificationSetup() {
        guard isNotificationSetupPending else { return }
        defaults.set("done", forKey: notificationSetupKey)
    }

    func acknowledge() {
        guard isPending else { return }
        defaults.set("done", forKey: storageKey)
    }
}
