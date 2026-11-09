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

    func hasSameAthleteDetails(as other: NativeSupporterProfile) -> Bool {
        athleteName == other.athleteName
            && teamName == other.teamName
            && jerseyNumber == other.jerseyNumber
            && position == other.position
            && sport == other.sport
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

struct NativePendingAthleteProfileChange: Codable, Equatable {
    var base: NativeSupporterProfile
    var desired: NativeSupporterProfile
    var conflictProfile: NativeSupporterProfile?
    var conflictMessage: String?
    var lastError: String?
    var createdAt: Date

    var isConflicted: Bool { conflictMessage != nil }
}
