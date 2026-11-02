import Foundation

// Run on a Mac from the repository root:
// swiftc -parse-as-library "ios/PIXL Sports/NativeSupporterProfile.swift" \
//   ios/Tests/NativeStarterSetupRecoveryChecks.swift -o /tmp/pixl-starter-recovery-checks
// /tmp/pixl-starter-recovery-checks
@main
struct NativeStarterSetupRecoveryChecks {
    static func main() throws {
        // A fresh decode simulates relaunch: no in-memory failed-save marker.
        let partialSave = """
        {"athleteName":"Relaunch Star","teamName":"Falcons","jerseyNumber":"12",
         "position":"Pitcher","sport":"softball","requiresSetup":true}
        """
        let restored = try decode(partialSave)
        precondition(restored.needsSetup, "Saved details without a committed card must reopen setup.")
        precondition(restored.athleteName == "Relaunch Star", "Recovery must prefill saved details.")
        precondition(restored.sport == "softball", "Recovery must preserve softball.")
        let restoredAgain = try decode(partialSave)
        precondition(restoredAgain.needsSetup, "Another relaunch must still offer Continue.")

        let complete = partialSave.replacingOccurrences(of: "\"requiresSetup\":true", with: "\"requiresSetup\":false")
        let completed = try decode(complete)
        precondition(!completed.needsSetup, "A committed owner card must end setup.")
        let legacyOrSaveResponse = partialSave.replacingOccurrences(of: ",\"requiresSetup\":true", with: "")
        let saved = try decode(legacyOrSaveResponse)
        precondition(!saved.needsSetup, "Successful saves and older servers stay compatible.")
        let newAccount = NativeSupporterProfile(
            athleteName: " \n ", teamName: "", jerseyNumber: "", position: "", requiresSetup: false
        )
        precondition(newAccount.needsSetup, "A missing athlete name must still open initial setup.")
        print("Native starter setup recovery policy checks passed.")
    }

    private static func decode(_ json: String) throws -> NativeSupporterProfile {
        try JSONDecoder().decode(NativeSupporterProfile.self, from: Data(json.utf8))
    }
}
