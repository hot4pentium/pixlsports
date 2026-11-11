import Foundation

enum ReminderCheckError: Error { case download, rejected, unavailable }

extension NativeLocalReminderEnvironment.Event {
    @MainActor
    static func event(_ token: String, status: String = "upcoming") -> Self {
        .init(shareToken: token, id: token, date: "2026-11-12", time: "18:00",
              title: "Private test " + token, type: "game", status: status, timezone: "UTC")
    }
}

/// Gates control task ordering. Assertions never depend on sleeps or the speed
/// of a network, simulator, Keychain, or notification service.
@MainActor
final class ReminderGate {
    private var entered = false
    private var opened = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    private var arrivals: [CheckedContinuation<Void, Never>] = []
    func wait() async {
        entered = true
        arrivals.forEach { $0.resume() }
        arrivals.removeAll()
        if !opened { await withCheckedContinuation { waiters.append($0) } }
    }
    func waitUntilEntered() async {
        if !entered { await withCheckedContinuation { arrivals.append($0) } }
    }
    func open() {
        opened = true
        waiters.forEach { $0.resume() }
        waiters.removeAll()
    }
}

@MainActor
final class ReminderCenterFake: NativeEventReminderNotificationCenter {
    var authorized = true
    var authorizationGate: ReminderGate?
    var pendingGate: ReminderGate?
    var addGate: ReminderGate?
    var rejected = false
    var pending: [String: NativeEventReminderRequest] = [:]
    var submissions: [NativeEventReminderRequest] = []
    var accepted: [NativeEventReminderRequest] = []
    var delivered: [String] = []
    func authorizationGranted() async -> Bool {
        if let gate = authorizationGate { authorizationGate = nil; await gate.wait() }
        return authorized
    }
    func pendingRequests() async -> [NativeEventReminderRequest] {
        let snapshot = Array(pending.values)
        if let gate = pendingGate { pendingGate = nil; await gate.wait() }
        return snapshot
    }
    func add(_ request: NativeEventReminderRequest) async throws {
        submissions.append(request)
        if let gate = addGate { addGate = nil; await gate.wait() }
        // Deliberately may accept after Task.cancel(): this reproduces the
        // important uncertain boundary instead of relying on cooperative IO.
        if rejected { throw ReminderCheckError.rejected }
        pending[request.identifier] = request
        accepted.append(request)
    }
    func removePending(_ identifiers: [String]) {
        identifiers.forEach { pending.removeValue(forKey: $0) }
    }
    func deliveredIdentifiers() async -> [String] { delivered }
    func removeDelivered(_ identifiers: [String]) {
        delivered.removeAll { identifiers.contains($0) }
    }
}

@MainActor
final class ReminderPreparationFixture {
    typealias Event = NativeLocalReminderEnvironment.Event
    var scope: String? = "account-a"
    var authorized = true
    var linkID = "verified-link-a"
    var scheduleLinkID = "verified-link-a"
    var now = ISO8601DateFormatter().date(from: "2026-11-11T12:00:00Z")!
    lazy var verifiedAt = now
    var events: [Event] = []
    var syncAdds: [Event] = []
    var downloaded = Set<String>()
    var readable = Set<String>()
    var removed = Set<String>()
    var failures = Set<String>()
    var unpersisted = Set<String>()
    var downloadGates: [String: ReminderGate] = [:]
    var downloadCalls: [String] = []
    var scheduleReads = 0
    var reconciliations = 0
    var passes = 0
    var cancelledPasses = 0
    var progressWrites = 0
    private var states: [String: Data] = [:]
    private let suite = "pixl-reminder-checks." + UUID().uuidString
    lazy var defaults = UserDefaults(suiteName: suite)!
    let center = ReminderCenterFake()
    let preferences = NativeLocalReminderPreferences(oneHourBefore: true, dayOf: true, timezone: "UTC")

    func cleanup() { defaults.removePersistentDomain(forName: suite) }
    func makeCoordinator() -> NativeLocalEventReminderCoordinator {
        let env = NativeLocalReminderEnvironment(
            scope: { self.scope },
            canContinue: { self.authorized && self.scope != nil },
            lease: { NativeLocalReminderEnvironment.Lease(linkID: self.linkID, verifiedAt: self.verifiedAt) },
            readState: { self.scope.flatMap { self.states[$0] } },
            writeState: {
                guard self.authorized, let scope = self.scope else { throw ReminderCheckError.unavailable }
                self.states[scope] = $0
            },
            schedule: {
                .init(status: "linked", linkID: self.scheduleLinkID, timezone: "UTC", events: self.events)
            },
            preparedTokens: { self.downloaded },
            hasWorkspace: { self.readable.contains($0) },
            authorityError: ReminderCheckError.unavailable,
            now: { self.now },
            defaults: defaults)
        return NativeLocalEventReminderCoordinator(environment: env, center: center)
    }
    func schedule() -> [Event] { scheduleReads += 1; return events }

    /// Same flow and worker the app uses, with only transport/persistence and
    /// account authority supplied by this private in-memory fixture.
    func run(_ coordinator: NativeLocalEventReminderCoordinator) async throws -> NativeEventPreparationFlow.Outcome {
        passes += 1
        let authority = scope
        return try await NativeEventPreparationFlow.run(
            initialPage: schedule(),
            synchronize: {
                guard !self.syncAdds.isEmpty else { return false }
                self.events += self.syncAdds
                self.syncAdds = []
                return true
            },
            refreshSchedule: { self.schedule() },
            isCurrent: { self.authorized && self.scope == authority },
            select: { $0 },
            availability: { event in
                if self.removed.contains(event.shareToken) { return .removed }
                return self.downloaded.contains(event.shareToken) ? .ready : .download
            },
            download: { event in
                let token = event.shareToken
                self.downloadCalls.append(token)
                if let gate = self.downloadGates.removeValue(forKey: token) { await gate.wait() }
                guard !Task.isCancelled, self.scope == authority, self.authorized else { throw CancellationError() }
                if self.failures.contains(token) { throw ReminderCheckError.download }
                // The runtime's live closure checks posted bytes equal the
                // verified vault. A transport success alone is insufficient.
                if self.unpersisted.contains(token) { throw ReminderCheckError.unavailable }
                self.downloaded.insert(token)
                self.readable.insert(token)
            },
            progress: { _ in self.progressWrites += 1 },
            reconcile: {
                self.reconciliations += 1
                await coordinator.reconcile()
            })
    }
    func operation(_ coordinator: NativeLocalEventReminderCoordinator) async {
        do { _ = try await run(coordinator) }
        catch is CancellationError { cancelledPasses += 1 }
        catch { preconditionFailure("Unexpected fixture failure: \(error)") }
    }
}
