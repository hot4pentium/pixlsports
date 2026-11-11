import Foundation

/// The adapter alone creates UNNotificationRequests. Fakes record acceptance
/// (or reject it) at this boundary; they never claim to model OS presentation.
struct NativeEventReminderRequest: Equatable {
    let identifier: String
    let title: String
    let body: String
    let fire: Date?
}

@MainActor
protocol NativeEventReminderNotificationCenter: AnyObject {
    func authorizationGranted() async -> Bool
    func pendingRequests() async -> [NativeEventReminderRequest]
    func add(_ request: NativeEventReminderRequest) async throws
    func removePending(_ identifiers: [String])
    func deliveredIdentifiers() async -> [String]
    func removeDelivered(_ identifiers: [String])
}

/// Narrow verified-vault interface. The coordinator, not a fake schedule
/// provider, still checks the lease/link and filters unprepared workspaces.
@MainActor
struct NativeLocalReminderEnvironment {
    struct Lease {
        let linkID: String?
        let verifiedAt: Date
    }
    struct Event {
        let shareToken: String
        let id: String
        let date: String
        let time: String
        let title: String
        let type: String
        let status: String
        let timezone: String?
    }
    struct Schedule {
        let status: String
        let linkID: String?
        let timezone: String?
        let events: [Event]
    }
    let scope: () -> String?
    let canContinue: () -> Bool
    let lease: () -> Lease?
    let readState: () throws -> Data?
    let writeState: (Data) throws -> Void
    let schedule: () throws -> Schedule
    let preparedTokens: () -> Set<String>
    let hasWorkspace: (String) throws -> Bool
    let authorityError: Error
    let now: () -> Date
    let defaults: UserDefaults
    static let toolReminderPrefix = "pixl.native.availability."
}
