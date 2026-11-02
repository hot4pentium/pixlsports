import Foundation

/// Eligibility is explicitly recorded during initial athlete setup.
/// A missing preference must never enroll an established account.
struct NativeWeeklyWelcomeProgress {
    let storageKey: String
    private let defaults: UserDefaults

    init(instance: String, userID: String, defaults: UserDefaults = .standard) {
        self.storageKey = "pixl.native.weekly-welcome.\(instance).\(userID)"
        self.defaults = defaults
    }

    var isPending: Bool {
        defaults.string(forKey: storageKey) == "pending"
    }

    func beginInitialSetup() {
        guard defaults.object(forKey: storageKey) == nil else { return }
        defaults.set("pending", forKey: storageKey)
    }

    func acknowledge() {
        guard isPending else { return }
        defaults.set("done", forKey: storageKey)
    }
}
