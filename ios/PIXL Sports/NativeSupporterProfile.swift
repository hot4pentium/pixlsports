import Foundation

struct NativeSupporterProfile: Codable, Equatable {
    let athleteName: String
    let teamName: String
    let jerseyNumber: String
    let position: String
    var sport: String? = nil
    // Optional for older servers and successful save responses. The server
    // checks card existence on load rather than trusting Clerk metadata alone.
    var requiresSetup: Bool? = nil

    var needsSetup: Bool {
        requiresSetup == true
            || athleteName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var displayDetails: String {
        [
            jerseyNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : "#\(jerseyNumber.trimmingCharacters(in: .whitespacesAndNewlines))",
            position.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : position.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        .compactMap { $0 }
        .joined(separator: " · ")
    }
}
