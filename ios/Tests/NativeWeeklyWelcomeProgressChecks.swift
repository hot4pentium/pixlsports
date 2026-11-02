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
        first.beginInitialSetup()
        precondition(first.isPending, "Retrying setup must preserve pending guidance.")

        let restored = NativeWeeklyWelcomeProgress(instance: "development", userID: "first", defaults: defaults)
        precondition(restored.isPending, "Unacknowledged guidance must survive a relaunch.")
        let second = NativeWeeklyWelcomeProgress(instance: "development", userID: "second", defaults: defaults)
        let otherInstance = NativeWeeklyWelcomeProgress(instance: "production", userID: "first", defaults: defaults)
        precondition(!second.isPending, "Accounts must not inherit another account's pending guide.")
        precondition(!otherInstance.isPending, "Clerk instances must have separate guide preferences.")

        restored.acknowledge()
        precondition(!first.isPending, "Acknowledgement should persist for the original account.")
        first.beginInitialSetup()
        precondition(!first.isPending, "Setup retries must not re-enroll an acknowledged account.")
        second.beginInitialSetup()
        precondition(second.isPending && !first.isPending, "Another new account should have its own guide.")
        print("Native weekly welcome progress checks passed.")
    }
}
