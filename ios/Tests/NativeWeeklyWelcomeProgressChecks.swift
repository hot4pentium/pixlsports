import Foundation

// On macOS:
// swiftc -parse-as-library "ios/PIXL Sports/NativeWeeklyWelcomeProgress.swift" \
//   ios/Tests/NativeWeeklyWelcomeProgressChecks.swift -o /tmp/pixl-weekly-welcome-checks
// /tmp/pixl-weekly-welcome-checks
@main
struct NativeWeeklyWelcomeProgressChecks {
    static func main() {
        let suite = "pixl-weekly-welcome-checks-\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suite) else {
            preconditionFailure("Could not create isolated preferences.")
        }
        defer { defaults.removePersistentDomain(forName: suite) }

        let first = NativeWeeklyWelcomeProgress(instance: "development", userID: "first", defaults: defaults)
        precondition(!first.isPending, "An absent preference must not enroll an established account.")
        first.beginInitialSetup()
        precondition(first.isPending, "Initial setup should explicitly enroll the new account.")
        precondition(first.isNotificationSetupPending, "Initial setup should enroll event-alert choices too.")
        first.beginInitialSetup()
        precondition(first.isPending && first.isNotificationSetupPending,
                     "Retrying setup must preserve pending guidance and alert choices.")

        let restored = NativeWeeklyWelcomeProgress(instance: "development", userID: "first", defaults: defaults)
        precondition(restored.isPending && restored.isNotificationSetupPending,
                     "Unacknowledged guidance and alert choices must survive a relaunch.")
        let second = NativeWeeklyWelcomeProgress(instance: "development", userID: "second", defaults: defaults)
        let otherInstance = NativeWeeklyWelcomeProgress(instance: "production", userID: "first", defaults: defaults)
        precondition(!second.isPending && !second.isNotificationSetupPending,
                     "Accounts must not inherit another account's pending setup.")
        precondition(!otherInstance.isPending && !otherInstance.isNotificationSetupPending,
                     "Clerk instances must have separate setup preferences.")

        restored.acknowledge()
        precondition(!first.isPending, "Acknowledgement should persist for the original account.")
        precondition(first.isNotificationSetupPending,
                     "Acknowledging the weekly welcome must not skip alert setup.")
        restored.acknowledgeNotificationSetup()
        precondition(!first.isNotificationSetupPending, "Alert setup acknowledgement should persist.")
        first.beginInitialSetup()
        precondition(!first.isPending && !first.isNotificationSetupPending,
                     "Setup retries must not re-enroll an acknowledged account.")
        second.beginInitialSetup()
        precondition(second.isPending && second.isNotificationSetupPending && !first.isPending,
                     "Another new account should have its own setup.")
        print("Native weekly welcome progress checks passed.")
    }
}
