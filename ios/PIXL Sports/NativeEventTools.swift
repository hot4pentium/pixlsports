import SwiftUI
import Combine
import ClerkKit

extension Notification.Name {
    static let nativeEventScheduleChanged = Notification.Name("pixl.nativeEventScheduleChanged")
}

#if DEBUG
/// Local UI-test data only. No Clerk identity, network requests, or persistent
/// pending-command storage are used by this workspace.
@MainActor
final class NativeEventWorkspaceUITestFixture: ObservableObject {
    static let shared = NativeEventWorkspaceUITestFixture()
    static var isRequested: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-testing-event-detail")
            && ProcessInfo.processInfo.arguments.contains("--ui-testing-prep-draft")
    }

    let workspace = NativeEventWorkspace(
        linkId: "fictional-prep-draft", prepRevision: 1, trackerRevision: 0,
        sport: "softball",
        prep: .init(items: ProcessInfo.processInfo.arguments.contains("--prep-long-labels") ? [
            .init(id: "water", label: "Pack enough water for warmups and the whole game", completed: false),
            .init(id: "cleats", label: "Bring cleats and spare socks for the muddy field", completed: false),
            .init(id: "uniform", label: "Pack the full uniform with both home and away jerseys", completed: false),
            .init(id: "arrival", label: "Confirm the field entrance and warmup arrival time", completed: false),
            .init(id: "snack", label: "Bring a snack for after the game", completed: false)
        ] : [
            .init(id: "water", label: "Pack water", completed: false),
            .init(id: "cleats", label: "Pack cleats", completed: false)
        ], notes: "Saved fixture note"),
        rules: .init(phaseLabel: "Inning", stats: []), game: nil
    )
    private let launchedAt = Date()
    private var clockOffset: TimeInterval = 0
    @Published private(set) var recommendation = "Waiting for timeline"
    @Published private(set) var timelineTicks = 0
    @Published private(set) var resumes = 0

    private init() {}

    func timelineDate(_ date: Date, eventStart: Date) -> Date {
        if ProcessInfo.processInfo.arguments.contains("--event-detail-unlock") {
            return eventStart.addingTimeInterval(-615 + date.timeIntervalSince(launchedAt) + clockOffset)
        }
        return eventStart.addingTimeInterval(-2 * 60 * 60 + date.timeIntervalSince(launchedAt) + clockOffset)
    }

    func advanceClock() { clockOffset += 2 * 60 * 60 }

    func recordTimeline(_ step: NativeEventDetailStep) {
        recommendation = step.title
        timelineTicks += 1
    }

    func recordResume() { resumes += 1 }
}
#endif

#if DEBUG
@MainActor
final class NativeScheduleRefreshUITestProbe: ObservableObject {
    static let shared = NativeScheduleRefreshUITestProbe()
    static var isRequested: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-testing-schedule-refresh")
    }

    @Published private(set) var dashboardRefreshes = 0
    @Published private(set) var detailRefreshes = 0

    private init() {}

    func recordDashboardRefresh() { dashboardRefreshes += 1 }
    func recordDetailRefresh() { detailRefreshes += 1 }
}
#endif

/// Stat taps update the local display immediately and persist in an account-scoped
/// queue. The server processes each mutation in order with one stable ID per tap.
@MainActor
final class NativeEventToolModel: ObservableObject {
    @Published var workspace: NativeEventWorkspace?
    @Published var busy = false
    @Published var errorMessage: String?
    @Published private(set) var prepRecoveryMessage: String?
    @Published private(set) var pendingQueue: [NativeQueuedEventToolCommand] = []
    @Published private(set) var conflictBlocked = false
    @Published private(set) var trackerRecoveryStatus: NativeTrackerRecoveryStatus?
    @Published private(set) var unreadablePendingData = false {
        didSet { if unreadablePendingData != oldValue { reminderStateChanged() } }
    }
    @Published var reloadGeneration = 0
    private let shareToken: String
    private let storageKey: String
    private var durableQueue: NativeEventDurableQueue<NativeQueuedEventToolCommand>
    private var drainingQueue = false
    private var acknowledgedWorkspace: NativeEventWorkspace?
    private var scheduledDrain: Task<Void, Never>?
#if DEBUG
    private var didApplyUITestTrackerSaveDelay = false
    private var didApplyUITestPrepSaveDelay = false
#endif
    private let offline = NativeOfflineRuntime.shared
    private var scope: String?
    private static let maximumPendingCommands = 1_000

    var pending: NativeEventToolCommand? { pendingQueue.first?.command }
    var pendingCount: Int { pendingQueue.count }
    var pendingStatCount: Int { pendingQueue.filter { $0.command.kind == "stat" }.count }

    var pendingDescription: String {
        let allStats = pendingStatCount == pendingCount
        let noun = allStats
            ? (pendingCount == 1 ? "stat" : "stats")
            : (pendingCount == 1 ? "change" : "changes")
        return busy
            ? "Saving \(pendingCount) \(noun)…"
            : "\(pendingCount) \(noun) \(pendingCount == 1 ? "still needs" : "still need") saving"
    }

    var ownsCurrentScope: Bool { scope == offline.vault.namespace && offline.canContinue }
    private var eventIsFinal: Bool {
        guard let status = workspace?.eventStatus?.lowercased() else { return false }
        return ["final", "complete", "completed"].contains(status)
    }
    var hasPendingPrepCommand: Bool { pendingQueue.contains { $0.command.kind == "prep" } }
    var hasPendingTrackerCommand: Bool { pendingQueue.contains { $0.command.kind != "prep" } }
    var canKeepLocalPrep: Bool {
        conflictBlocked && !unreadablePendingData && ownsCurrentScope
            && pendingQueue.allSatisfy { $0.command.kind == "prep" }
    }
    var canEditLocally: Bool {
#if DEBUG
        if NativeEventWorkspaceUITestFixture.isRequested { return workspace != nil }
#endif
        return workspace != nil && !unreadablePendingData && !conflictBlocked && ownsCurrentScope
    }
    var canEditTrackerLocally: Bool {
#if DEBUG
        if NativeEventWorkspaceUITestFixture.isRequested { return workspace != nil }
#endif
        // A Prep conflict pauses the shared sender, not durable local scoring.
        // Tracker/account/game safety checks still apply independently.
        return workspace != nil && !unreadablePendingData
            && (!conflictBlocked || hasPendingPrepCommand)
            && (trackerRecoveryStatus?.permitsLocalEntry ?? true)
            && !eventIsFinal
            && ownsCurrentScope
    }
    var canQueueStat: Bool { canEditTrackerLocally && workspace?.game?.status == "live" }
    var pendingFinal: Bool { pendingQueue.contains { $0.command.kind == "finish" } }
    var trackerIsComplete: Bool {
        trackerRecoveryStatus == .gameFinished || NativeEventDetailStep.gameIsComplete(
            workspaceStatus: workspace?.eventStatus,
            gameStatus: displayedGame?.status,
            pendingFinal: pendingFinal
        )
    }

    static func shared(shareToken: String, accountID: String) -> NativeEventToolModel {
        NativeOfflineRuntime.shared.eventModel(token: shareToken, accountID: accountID)
    }

    var displayedGame: NativeEventWorkspace.Game? {
        workspace?.game
    }
#if DEBUG
    var uiTestPendingMutationID: String? {
        guard ProcessInfo.processInfo.arguments.contains("--ui-testing-signed-in-prep") else { return nil }
        return pending?.mutationId
    }
#endif

    init(shareToken: String, accountID: String) {
        self.shareToken = shareToken
        let capturedScope = offline.vault.namespace
        scope = capturedScope
        storageKey = "pixl-native-event-pending:\(accountID):\(shareToken)"
        durableQueue = Self.openQueue(storageKey: storageKey, token: shareToken, accountID: accountID, scope: capturedScope)
        pendingQueue = durableQueue.commands
        conflictBlocked = durableQueue.conflictBlocked
        trackerRecoveryStatus = durableQueue.trackerRecoveryStatus
        if conflictBlocked,
           pendingQueue.contains(where: { $0.command.kind != "prep" }),
           !pendingQueue.contains(where: { $0.command.kind == "prep" }) {
            // Older builds persisted tracker revision conflicts in the Prep
            // conflict flag. Migrate them without offering a destructive choice.
            conflictBlocked = false
            trackerRecoveryStatus = trackerRecoveryStatus ?? .revisionConflict
            try? persistPendingQueue()
        }
        if durableQueue.storageError != nil {
            unreadablePendingData = true
            errorMessage = durableQueue.storageError?.localizedDescription
        } else if conflictBlocked || trackerRecoveryStatus != nil {
            errorMessage = "The tracker changed elsewhere. Your pending changes are still saved on this iPhone."
        }
        if let data = try? offline.vault.read("workspace/" + shareToken, subject: accountID),
           let saved = try? JSONDecoder().decode(NativeEventWorkspace.self, from: data) {
            acknowledgedWorkspace = saved
            let acknowledgedIDs = Set(saved.acknowledgedMutationIds ?? [])
            if !acknowledgedIDs.isEmpty {
                let previousQueue = pendingQueue
                pendingQueue.removeAll {
                    $0.attempted && $0.command.kind != "prep"
                        && acknowledgedIDs.contains($0.command.mutationId)
                }
                if pendingQueue.count != previousQueue.count {
                    do { try persistPendingQueue() }
                    catch {
                        pendingQueue = previousQueue
                        try? persistPendingQueue()
                    }
                }
            }
            if !pendingQueue.contains(where: { $0.command.kind != "prep" }),
               trackerRecoveryStatus != nil {
                trackerRecoveryStatus = nil
                try? persistPendingQueue()
            }
            reconcileRestoredStatQueue()
            rebuildProjection()
        }
        offline.register(self, token: shareToken)
    }

    private static func openQueue(storageKey: String, token: String, accountID: String, scope: String?)
        -> NativeEventDurableQueue<NativeQueuedEventToolCommand> {
        let legacyData = UserDefaults.standard.data(forKey: storageKey)
        let single = legacyData.flatMap { try? JSONDecoder().decode(NativeEventToolCommand.self, from: $0) }
        return NativeEventDurableQueue(
            storageKey: storageKey,
            initialCommands: single.map { [.init(command: $0, attempted: true, displayOptimistically: false)] } ?? [],
            protectedRead: {
                guard NativeOfflineVault.shared.namespace == scope else { throw NativeOfflineError.locked }
                return try NativeOfflineVault.shared.read("outbox/" + token, subject: accountID)
            },
            protectedWrite: {
                guard NativeOfflineVault.shared.namespace == scope,
                      NativeOfflineVault.shared.subject == accountID else { throw NativeOfflineError.locked }
                try NativeOfflineVault.shared.write($0, key: "outbox/" + token)
            },
            validateLegacy: { data in
                // Old preferences were subject-scoped only. Adopt them only
                // after this issuer/subject has an authorized matching workspace.
                guard let bytes = try NativeOfflineVault.shared.read("workspace/" + token, subject: accountID),
                      let saved = try? JSONDecoder().decode(NativeEventWorkspace.self, from: bytes) else {
                    throw NativeOfflineError.notPrepared
                }
                if let single {
                    guard single.linkId == saved.linkId else { throw NativeOfflineError.locked }
                } else {
                    struct Legacy: Decodable { let commands: [NativeQueuedEventToolCommand] }
                    let legacy = try JSONDecoder().decode(Legacy.self, from: data)
                    guard legacy.commands.allSatisfy({ $0.command.linkId == saved.linkId }) else {
                        throw NativeOfflineError.locked
                    }
                }
            }
        )
    }

#if DEBUG
    init(uiTestFixture: NativeEventWorkspaceUITestFixture) {
        precondition(NativeEventWorkspaceUITestFixture.isRequested)
        shareToken = "ui-test-event"
        storageKey = "unused-ui-test-prep-draft"
        durableQueue = NativeEventDurableQueue(storageKey: storageKey)
        workspace = uiTestFixture.workspace
        acknowledgedWorkspace = workspace
    }
#endif

    func load(clerk: Clerk) async {
        guard !busy, !drainingQueue else { return }
        busy = true
        defer { busy = false }
        var shouldDrain = false
        do {
            let pendingIDs = pendingQueue
                .filter(\.attempted)
                .map(\.command.mutationId)
            let data = try await NativeAccountLinkClient().postData(
                "supporter/event-workspace",
                body: NativeEventWorkspaceRequest(shareToken: shareToken, pendingMutationIds: pendingIDs),
                clerk: clerk,
                // The cached workspace already supplied our local projection.
                // Only a fresh response may establish a changed/finalized game
                // or acknowledge actions. A failed refresh leaves that copy intact.
                allowCachedWorkspace: false
            )
            guard scope == offline.vault.namespace else { return }
            var next = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
            if (durableQueue.storageError as? NativeOfflineError) == .notPrepared {
                durableQueue = Self.openQueue(storageKey: storageKey, token: shareToken,
                                              accountID: offline.accountID, scope: scope)
                pendingQueue = durableQueue.commands
                conflictBlocked = durableQueue.conflictBlocked
                trackerRecoveryStatus = durableQueue.trackerRecoveryStatus
                unreadablePendingData = durableQueue.storageError != nil
                if conflictBlocked,
                   pendingQueue.contains(where: { $0.command.kind != "prep" }),
                   !pendingQueue.contains(where: { $0.command.kind == "prep" }) {
                    conflictBlocked = false
                    trackerRecoveryStatus = trackerRecoveryStatus ?? .revisionConflict
                }
                let restoredIDs = pendingQueue.filter(\.attempted).map(\.command.mutationId)
                if !restoredIDs.isEmpty, !unreadablePendingData {
                    let restoredData = try await NativeAccountLinkClient().postData(
                        "supporter/event-workspace",
                        body: NativeEventWorkspaceRequest(
                            shareToken: shareToken, pendingMutationIds: restoredIDs
                        ),
                        clerk: clerk, allowCachedWorkspace: false
                    )
                    next = try JSONDecoder().decode(NativeEventWorkspace.self, from: restoredData)
                }
            }

            let previousWorkspace = acknowledgedWorkspace
            let acknowledgedIDs = Set(next.acknowledgedMutationIds ?? [])
            let confirmedStarts = pendingQueue.contains {
                $0.attempted && $0.command.kind == "start"
                    && acknowledgedIDs.contains($0.command.mutationId)
            }
            if pendingQueue.contains(where: {
                $0.command.kind != "prep" && acknowledgedIDs.contains($0.command.mutationId)
            }) {
                let previousQueue = pendingQueue
                pendingQueue.removeAll {
                    $0.attempted && $0.command.kind != "prep"
                        && acknowledgedIDs.contains($0.command.mutationId)
                }
                do {
                    try persistPendingQueue()
                } catch {
                    // Keep the durable command if local acknowledgement storage
                    // fails, but don't project a mutation already present on PIXL.
                    pendingQueue = previousQueue
                    for index in pendingQueue.indices
                    where pendingQueue[index].command.kind != "prep"
                        && acknowledgedIDs.contains(pendingQueue[index].command.mutationId) {
                        pendingQueue[index].displayOptimistically = false
                    }
                    try? persistPendingQueue()
                    errorMessage = "PIXL confirmed a saved tracker action, but this iPhone could not update its sync queue yet."
                }
            }

            let prepQueue = pendingQueue.filter { $0.command.kind == "prep" }
            if NativeOfflineOutboxPolicy.conflicts(prepQueue, with: next) {
                conflictBlocked = true
            }
            let trackerQueue = pendingQueue.filter { $0.command.kind != "prep" }
            let policyBase = confirmedStarts ? next : previousWorkspace
            let trackerProblem = NativeTrackerOutboxPolicy.incompatibility(
                pendingQueue, previous: policyBase, latest: next, shareToken: shareToken,
                acknowledgedMutationIds: acknowledgedIDs
            )
            if let trackerProblem {
                trackerRecoveryStatus = trackerProblem
                if prepQueue.isEmpty, let previousWorkspace {
                    // Keep the last compatible game as the projection base.
                    // Never apply queued actions to a replaced or finalized game.
                    acknowledgedWorkspace = previousWorkspace
                    try? offline.vault.write(
                        JSONEncoder().encode(previousWorkspace), key: "workspace/" + shareToken
                    )
                } else {
                    acknowledgedWorkspace = next
                }
            } else {
                acknowledgedWorkspace = next
                trackerRecoveryStatus = nil
                if !trackerQueue.isEmpty {
                    NativeTrackerOutboxPolicy.rebaseNeverAttempted(&pendingQueue, against: next)
                }
                try offline.vault.write(JSONEncoder().encode(next), key: "workspace/" + shareToken)
            }
            try persistPendingQueue()
            reconcileRestoredStatQueue()
            rebuildProjection()
            await recoverChecklistDraft(clerk: clerk)
            if unreadablePendingData {
                errorMessage = "A saved tracker change could not be read. It has not been removed."
            } else if conflictBlocked {
                errorMessage = "The tracker changed elsewhere. Your pending changes are still saved on this iPhone. Reload before choosing what to keep."
            } else if let trackerRecoveryStatus {
                errorMessage = trackerRecoveryStatus.message
            } else {
                errorMessage = nil
                shouldDrain = !pendingQueue.isEmpty
            }
        } catch { errorMessage = error.localizedDescription }
        busy = false
        if shouldDrain { await drainQueue(clerk: clerk) }
    }

    private func recoverChecklistDraft(clerk: Clerk) async {
        guard ownsCurrentScope, !conflictBlocked, !unreadablePendingData else { return }
        var draft: NativeOfflinePrepDraft
        do {
            guard let data = try offline.vault.read("draft/" + shareToken) else { return }
            draft = try JSONDecoder().decode(NativeOfflinePrepDraft.self, from: data)
        } catch {
            unreadablePendingData = true
            errorMessage = "Saved Prep changes could not be read. They have not been removed."
            return
        }
        if !pendingQueue.contains(where: { $0.command.kind == "prep" }),
           draft.baseRevision != workspace?.prepRevision {
            conflictBlocked = true
            errorMessage = "Prep changed elsewhere. Your on-device draft is retained; review it before choosing the server version."
            try? persistPendingQueue()
            return
        }
        guard draft.checklistDirty else { return }
        if workspace?.prep.items != draft.items {
            await save("prep", clerk: clerk, items: draft.items, notes: workspace?.prep.notes ?? "")
            guard workspace?.prep.items == draft.items else { return }
        }
        draft.checklistDirty = false
        do {
            let retained = draft.notesDirty ? try JSONEncoder().encode(draft) : nil
            try offline.vault.write(retained, key: "draft/" + shareToken)
            offline.storageChanged()
        } catch { errorMessage = "Prep is retained on this iPhone. Reconnect and retry to finish saving." }
    }

    func save(
        _ kind: String, clerk: Clerk, statID: String? = nil,
        athlete: Bool? = nil, opponent: Bool? = nil, yards: Int? = nil,
        delta: Int? = nil, soccerFormat: String? = nil,
        recordScore: Bool? = nil, outcome: String? = nil,
        items: [NativePrepItem]? = nil, notes: String? = nil
    ) async {
        guard !unreadablePendingData, let workspace else { return }
        if kind == "prep" {
            guard !conflictBlocked, canEditLocally else { return }
        } else {
            guard canEditTrackerLocally else { return }
        }
        if kind == "stat" {
            guard canQueueStat else { return }
        }
        if kind == "start", eventIsFinal { return }
        guard pendingQueue.count < Self.maximumPendingCommands else {
            errorMessage = "Sync your saved changes before recording more. The on-device queue is full."
            return
        }
        do {
            var needsBase = pendingQueue.isEmpty
            if !needsBase { needsBase = try offline.vault.read("workspace/" + shareToken) == nil }
            if needsBase, let acknowledgedWorkspace {
                try offline.vault.write(JSONEncoder().encode(acknowledgedWorkspace), key: "workspace/" + shareToken)
            }
        } catch { errorMessage = error.localizedDescription; return }

        var command = NativeEventToolCommand(
            shareToken: shareToken, mutationId: UUID().uuidString,
            linkId: workspace.linkId,
            expectedRevision: kind == "prep" ? workspace.prepRevision : workspace.trackerRevision,
            kind: kind
        )
        command.statId = statID
        command.athlete = athlete
        command.opponent = opponent
        command.yards = yards
        command.delta = delta
        command.soccerFormat = soccerFormat
        command.recordScore = recordScore
        command.outcome = outcome
        command.items = items
        command.notes = notes
        if kind == "stat" { command.scoringVersion = 2 }
        let previousQueue = pendingQueue
        let queued = NativeQueuedEventToolCommand(command: command, attempted: false, displayOptimistically: true)
        if kind == "prep", let last = pendingQueue.last, !last.attempted, last.command.kind == "prep" {
            pendingQueue[pendingQueue.count - 1] = queued
        } else { pendingQueue.append(queued) }
        do {
            try persistPendingQueue()
        } catch {
            pendingQueue = previousQueue
            errorMessage = "The pending change could not be saved on this iPhone. Nothing was sent."
            return
        }
        rebuildProjection()
        errorMessage = nil
        scheduledDrain?.cancel()
        scheduledDrain = Task {
            do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
            scheduledDrain = nil
            await drainQueue(clerk: clerk)
        }
    }

    func retry(clerk: Clerk) async {
        guard !busy, !conflictBlocked, !unreadablePendingData, !pendingQueue.isEmpty else { return }
        await load(clerk: clerk)
    }

    private func drainQueue(clerk: Clerk) async {
        guard !busy, !drainingQueue, !conflictBlocked, !unreadablePendingData,
              !pendingQueue.isEmpty, workspace != nil else { return }
        guard offline.online, clerk.isAuthFlowComplete, scope == offline.vault.namespace,
              offline.vault.canContinue(subject: clerk.user?.id), offline.claim(shareToken) else { return }
        drainingQueue = true
        busy = true
        errorMessage = nil
        var scheduleChange: NativeEventToolCommand?
        defer {
            busy = false
            drainingQueue = false
            offline.release(shareToken)
            if let scheduleChange { postScheduleChange(for: scheduleChange) }
        }

        while !pendingQueue.isEmpty {
            guard !Task.isCancelled, offline.online, scope == offline.vault.namespace,
                  offline.vault.canContinue(subject: clerk.user?.id) else { return }
            if pendingQueue[0].command.kind != "prep", trackerRecoveryStatus != nil { return }
            if !pendingQueue[0].attempted {
                guard let workspace = acknowledgedWorkspace else { return }
                pendingQueue[0].command.expectedRevision =
                    pendingQueue[0].command.kind == "prep" ? workspace.prepRevision : workspace.trackerRevision
                pendingQueue[0].attempted = true
                do { try persistPendingQueue() }
                catch {
                    errorMessage = "The pending change could not be saved on this iPhone. Nothing was sent."
                    return
                }
            }

            let command = pendingQueue[0].command
            do {
#if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--ui-testing-signed-in-prep"),
                   ProcessInfo.processInfo.arguments.contains("--ui-testing-delay-prep-save"),
                   command.kind == "prep", !didApplyUITestPrepSaveDelay {
                    didApplyUITestPrepSaveDelay = true
                    try? await Task.sleep(for: .seconds(3))
                }
                if ProcessInfo.processInfo.arguments.contains("--ui-testing-delay-tracker-save"),
                   command.kind != "prep", !didApplyUITestTrackerSaveDelay {
                    didApplyUITestTrackerSaveDelay = true
                    try? await Task.sleep(for: .seconds(20))
                }
#endif
                let data = try await NativeAccountLinkClient().postData(
                    "supporter/event-workspace-save", body: command, clerk: clerk
                )
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-signed-in-prep"),
                   ProcessInfo.processInfo.arguments.contains("--prep-save-lost-response-once"),
                   clerk.isAuthFlowComplete, command.kind == "prep" {
                    let responseDropKey = "\(storageKey):debug-drop-response:\(command.mutationId)"
                if !UserDefaults.standard.bool(forKey: responseDropKey) {
                    // The authenticated endpoint has committed the command.
                    // Drop its success before the app decodes or acknowledges it.
                    UserDefaults.standard.set(true, forKey: responseDropKey)
                    throw NativeAccountLinkError.message(
                        "Test server committed Prep; response dropped before acknowledgement."
                    )
                }
            }
#endif
                guard scope == offline.vault.namespace else { return }
                let next = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
                guard next.linkId == command.linkId else {
                    throw NativeAccountLinkError.serverStatus(409, "The verified Event Card connection changed.")
                }
                // Persist the acknowledgement before removing its outbox entry.
                try offline.vault.write(data, key: "workspace/" + shareToken)
                let receivedRevision = command.kind == "prep" ? next.prepRevision : next.trackerRevision
                let concurrentChange = receivedRevision != command.expectedRevision + 1
                if command.kind == "prep", !concurrentChange,
                   let data = try offline.vault.read("draft/" + shareToken) {
                    var draft = try JSONDecoder().decode(NativeOfflinePrepDraft.self, from: data)
                    if draft.baseRevision == command.expectedRevision {
                        draft.baseRevision = receivedRevision
                        try offline.vault.write(JSONEncoder().encode(draft), key: "draft/" + shareToken)
                    }
                }
                acknowledgedWorkspace = next
                let acknowledged = pendingQueue.removeFirst()
                if !concurrentChange {
                    // Only our acknowledged operation may advance never-attempted
                    // commands. A fresh remote revision alone must never rebase them.
                    NativeOfflineOutboxPolicy.acknowledge(&pendingQueue, command: command, revision: receivedRevision)
                }
                do { try persistPendingQueue() }
                catch {
                    pendingQueue.insert(acknowledged, at: 0)
                    reconcileRestoredStatQueue()
                    rebuildProjection()
                    errorMessage = "The server saved this change, but the local queue could not be updated. Retrying is safe."
                    return
                }
                if concurrentChange && !pendingQueue.isEmpty {
                    if command.kind == "prep" {
                        conflictBlocked = true
                    } else {
                        trackerRecoveryStatus = .revisionConflict
                        NativeTrackerOutboxPolicy.rebaseNeverAttempted(&pendingQueue, against: next)
                    }
                    try persistPendingQueue()
                    rebuildProjection()
                    errorMessage = command.kind == "prep"
                        ? "This event also changed elsewhere. Remaining Prep changes are saved here for your review."
                        : NativeTrackerRecoveryStatus.revisionConflict.message
                    return
                }
                rebuildProjection()
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-signed-in-prep") {
                    UserDefaults.standard.removeObject(forKey: "\(storageKey):debug-drop-response:\(command.mutationId)")
            }
#endif
                if scheduleChange == nil || ["start", "finish"].contains(command.kind)
                    || !(scheduleChange.map { ["start", "finish"].contains($0.kind) } ?? false) {
                    scheduleChange = command
                }
            } catch {
                if command.kind != "prep",
                   (error as? NativeAccountLinkError)?.statusCode == 409 {
                    await recoverTrackerConflict(clerk: clerk, error: error)
                } else if command.kind == "prep",
                          (error as? NativeAccountLinkError)?.statusCode == 409 {
                    conflictBlocked = true
                    try? persistPendingQueue()
                    errorMessage = "\(error.localizedDescription) Your queued Prep changes are still saved on this iPhone."
                } else {
                    errorMessage = "\(error.localizedDescription) \(pendingCount) pending changes remain saved on this iPhone. Retry when connected."
#if DEBUG
                    if ProcessInfo.processInfo.arguments.contains("--prep-hold-auto-retry") { return }
#endif
                    offline.resume(clerk: clerk, force: true)
                }
                return
            }
        }
    }

    private func recoverTrackerConflict(clerk: Clerk, error: Error) async {
        trackerRecoveryStatus = .revisionConflict
        errorMessage = NativeTrackerRecoveryStatus.revisionConflict.message
        try? persistPendingQueue()

        do {
            let pendingIDs = pendingQueue.filter(\.attempted).map(\.command.mutationId)
            let request = NativeEventWorkspaceRequest(
                shareToken: shareToken, pendingMutationIds: pendingIDs
            )
            let data = try await NativeAccountLinkClient().postData(
                "supporter/event-workspace", body: request, clerk: clerk,
                allowCachedWorkspace: false
            )
            guard scope == offline.vault.namespace else { return }
            let latest = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
            let previousWorkspace = acknowledgedWorkspace
            let acknowledgedIDs = Set(latest.acknowledgedMutationIds ?? [])
            let confirmedStarts = pendingQueue.contains {
                $0.attempted && $0.command.kind == "start"
                    && acknowledgedIDs.contains($0.command.mutationId)
            }
            if pendingQueue.contains(where: {
                $0.command.kind != "prep" && $0.attempted
                    && acknowledgedIDs.contains($0.command.mutationId)
            }) {
                pendingQueue.removeAll {
                    $0.command.kind != "prep" && $0.attempted
                        && acknowledgedIDs.contains($0.command.mutationId)
                }
            }

            guard pendingQueue.contains(where: { $0.command.kind != "prep" }) else {
                trackerRecoveryStatus = nil
                acknowledgedWorkspace = latest
                try offline.vault.write(JSONEncoder().encode(latest), key: "workspace/" + shareToken)
                try persistPendingQueue()
                reconcileRestoredStatQueue()
                rebuildProjection()
                errorMessage = nil
                return
            }

            if let incompatibility = NativeTrackerOutboxPolicy.incompatibility(
                pendingQueue, previous: confirmedStarts ? latest : previousWorkspace,
                latest: latest, shareToken: shareToken, acknowledgedMutationIds: acknowledgedIDs
            ) {
                trackerRecoveryStatus = incompatibility
                if !pendingQueue.contains(where: { $0.command.kind == "prep" }),
                   let previousWorkspace {
                    acknowledgedWorkspace = previousWorkspace
                    try? offline.vault.write(
                        JSONEncoder().encode(previousWorkspace), key: "workspace/" + shareToken
                    )
                } else {
                    acknowledgedWorkspace = latest
                }
            } else {
                let message = error.localizedDescription.lowercased()
                trackerRecoveryStatus = message.contains("changed on another device")
                    || message.contains("reload before making another change")
                    ? .revisionConflict : .serverRejected
                if trackerRecoveryStatus == .revisionConflict {
                    acknowledgedWorkspace = latest
                    NativeTrackerOutboxPolicy.rebaseNeverAttempted(&pendingQueue, against: latest)
                    try offline.vault.write(JSONEncoder().encode(latest), key: "workspace/" + shareToken)
                } else if let previousWorkspace {
                    acknowledgedWorkspace = previousWorkspace
                }
            }
            try persistPendingQueue()
            reconcileRestoredStatQueue()
            rebuildProjection()
            errorMessage = trackerRecoveryStatus?.message
        } catch let refreshError as NativeAccountLinkError {
            if refreshError.statusCode == 404 {
                trackerRecoveryStatus = .gameChanged
            } else if let statusCode = refreshError.statusCode,
                      [401, 403, 409, 410, 423].contains(statusCode) {
                trackerRecoveryStatus = .serverRejected
            } else {
                trackerRecoveryStatus = .revisionConflict
            }
            try? persistPendingQueue()
            errorMessage = trackerRecoveryStatus?.message
        } catch {
            // Keep the attempted command immutable and retain the iPhone copy.
            // A later explicit retry or reconnect will fetch the authoritative state.
            trackerRecoveryStatus = .revisionConflict
            try? persistPendingQueue()
            errorMessage = NativeTrackerRecoveryStatus.revisionConflict.message
        }
    }

    func discardAndReload(clerk: Clerk) async {
        guard !busy, !drainingQueue, offline.online else {
            errorMessage = "Connect to the internet before using the PIXL version. Your changes are still saved on this iPhone."
            return
        }
        guard !pendingQueue.contains(where: { $0.command.kind != "prep" }) else {
            errorMessage = "Tracker actions are still saved on this iPhone and cannot be removed by choosing the saved Prep."
            return
        }
        do {
            let data = try await NativeAccountLinkClient().postData(
                "supporter/event-workspace", body: ["shareToken": shareToken], clerk: clerk, allowCachedWorkspace: false)
            guard ownsCurrentScope else { throw NativeOfflineError.locked }
            let saved = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
            guard saved.linkId == offline.vault.lease?.linkId else { throw NativeOfflineError.locked }
            try offline.vault.write(data, key: "workspace/" + shareToken)
            try offline.vault.write(nil, key: "draft/" + shareToken)
            try durableQueue.removeAll()
            pendingQueue.removeAll()
            conflictBlocked = false
            unreadablePendingData = false
            acknowledgedWorkspace = saved
            rebuildProjection()
            errorMessage = nil
            prepRecoveryMessage = nil
            reloadGeneration += 1
        } catch { errorMessage = error.localizedDescription }
    }

    func keepLocalPrep(
        clerk: Clerk,
        items: [NativePrepItem],
        notes: String,
        notesDirty: Bool
    ) async {
        guard canKeepLocalPrep, !busy, !drainingQueue else { return }
        prepRecoveryMessage = nil
        guard offline.online else {
            prepRecoveryMessage = "Reconnect before keeping this Prep. Your iPhone copy is still here."
            return
        }
        guard let current = acknowledgedWorkspace ?? workspace else {
            prepRecoveryMessage = "Your iPhone copy is still here. Try opening Prep again."
            return
        }

        busy = true
        do {
            let currentNotes = notesDirty ? notes : current.prep.notes
            let localDraft = NativeOfflinePrepDraft(
                items: items, notes: currentNotes, notesDirty: notesDirty,
                checklistDirty: true, baseRevision: current.prepRevision
            )
            try offline.vault.write(
                JSONEncoder().encode(localDraft), key: "draft/" + shareToken
            )
            offline.storageChanged()

            let data = try await NativeAccountLinkClient().postData(
                "supporter/event-workspace", body: ["shareToken": shareToken],
                clerk: clerk, allowCachedWorkspace: false
            )
            guard ownsCurrentScope else { throw NativeOfflineError.locked }
            let latest = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
            guard latest.linkId == current.linkId,
                  latest.linkId == offline.vault.lease?.linkId else {
                throw NativeOfflineError.locked
            }

            let savedNotes = notesDirty ? notes : latest.prep.notes
            let retainedDraft = NativeOfflinePrepDraft(
                items: items, notes: savedNotes, notesDirty: notesDirty,
                checklistDirty: true, baseRevision: latest.prepRevision
            )
            try offline.vault.write(
                JSONEncoder().encode(retainedDraft), key: "draft/" + shareToken
            )
            try offline.vault.write(data, key: "workspace/" + shareToken)

            guard let replacementQueue = NativeOfflineOutboxPolicy.queueForUserConfirmedPrepReplacement(
                pendingQueue, saved: latest, shareToken: shareToken,
                mutationID: UUID().uuidString, items: items, notes: savedNotes
            ) else {
                throw NativeOfflineError.locked
            }
            try durableQueue.save(
                commands: replacementQueue, conflictBlocked: false, trackerRecoveryStatus: nil
            )
            pendingQueue = replacementQueue
            conflictBlocked = false
            trackerRecoveryStatus = nil
            acknowledgedWorkspace = latest
            rebuildProjection()
            errorMessage = nil
            prepRecoveryMessage = nil
            reloadGeneration += 1
            offline.storageChanged()
            busy = false
            await drainQueue(clerk: clerk)
        } catch {
            busy = false
            prepRecoveryMessage = "Couldn't update the saved Prep. Your iPhone copy is still here. Try again."
        }
    }

    private func persistPendingQueue() throws {
        guard scope == offline.vault.namespace else { throw NativeOfflineError.locked }
        try durableQueue.save(
            commands: pendingQueue, conflictBlocked: conflictBlocked,
            trackerRecoveryStatus: trackerRecoveryStatus
        )
        offline.storageChanged()
        reminderStateChanged()
    }

    private func reminderStateChanged() {
        // Includes a durable pending finish before its optimistic projection.
        guard ownsCurrentScope else { return }
        offline.toolReminderStateChanged(token: shareToken, complete: trackerIsComplete,
            unreadable: unreadablePendingData)
    }

    private func reconcileRestoredStatQueue() {
        guard !unreadablePendingData,
              let saved = acknowledgedWorkspace else { return }
        let acknowledgedIDs = Set(saved.acknowledgedMutationIds ?? [])
        for index in pendingQueue.indices
        where pendingQueue[index].attempted {
            if pendingQueue[index].command.kind != "prep" {
                // A receipt can remain queued if local acknowledgement storage
                // failed. Never project it twice over the confirmed server copy.
                pendingQueue[index].displayOptimistically =
                    !acknowledgedIDs.contains(pendingQueue[index].command.mutationId)
                continue
            }
            let revision = pendingQueue[index].command.kind == "prep" ? saved.prepRevision : saved.trackerRevision
            pendingQueue[index].displayOptimistically =
                pendingQueue[index].command.expectedRevision >= revision
        }
        if !pendingQueue.isEmpty { try? persistPendingQueue() }
    }

    private func rebuildProjection() {
        guard var projected = acknowledgedWorkspace else { return }
        for queued in pendingQueue where queued.displayOptimistically {
            projected = NativeEventProjection.apply(queued.command, to: projected)
        }
        workspace = projected
        reminderStateChanged()
    }

    private func postScheduleChange(for command: NativeEventToolCommand) {
        let reason = NativeEventScheduleChangeReason.forToolCommandKind(command.kind)
        guard let reason else { return }
        NotificationCenter.default.post(
            name: .nativeEventScheduleChanged,
            object: nil,
            userInfo: [NativeEventScheduleChangeReason.userInfoKey: reason.rawValue]
        )
    }
}

struct NativeToolSaveNotice: View {
    @ObservedObject var model: NativeEventToolModel
    @ObservedObject private var offline = NativeOfflineRuntime.shared
    let clerk: Clerk
    var hasUnsavedChanges = false
    var savedContentName = "version"
    var showsRoutineActivity = true
    var onKeepLocalPrep: (() async -> Void)? = nil
    private enum RecoveryChoice: Equatable { case keepLocalPrep, useSaved }
    @State private var confirmingRecovery: RecoveryChoice?

    private var canOfferKeepLocalPrep: Bool {
        savedContentName == "Prep" && model.canKeepLocalPrep
            && (hasUnsavedChanges || model.hasPendingPrepCommand)
            && onKeepLocalPrep != nil
    }
    private var canUseSavedPrep: Bool {
        savedContentName == "Prep"
            && !model.pendingQueue.contains(where: { $0.command.kind != "prep" })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !offline.online {
                Label(savedContentName == "Prep"
                      ? "You're offline. Your Prep changes stay on this iPhone."
                      : savedContentName == "Stat Tracker"
                          ? "Offline · tracker actions are saved on this iPhone."
                      : "Offline · changes stay on this iPhone. Live Taps and sharing need a connection.",
                      systemImage: "wifi.slash").font(.caption)
            }
            if showsRoutineActivity && model.busy {
                HStack {
                    ProgressView()
                    Text(model.pendingCount > 0 ? model.pendingDescription : "Loading your event…")
                }
            } else if showsRoutineActivity, model.pendingCount > 0,
                      !model.conflictBlocked,
                      !model.unreadablePendingData,
                      model.errorMessage == nil {
                Label(model.pendingDescription, systemImage: "clock.arrow.circlepath")
                    .font(.caption)
                    .accessibilityIdentifier("native-tool-pending")
            }
            if savedContentName != "Prep", let trackerRecoveryStatus = model.trackerRecoveryStatus {
                Label("Tracker changes are saved on this iPhone", systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .accessibilityIdentifier("native-tool-save-error")
                Text(trackerRecoveryStatus.message)
                    .font(.caption)
                if model.pendingCount > 0 {
                    Button(trackerRecoveryStatus.permitsLocalEntry ? "Try again" : "Check again") {
                        Task { await model.retry(clerk: clerk) }
                    }
                    .accessibilityIdentifier("native-tool-save-retry")
                }
            } else if model.conflictBlocked && savedContentName != "Prep" {
                Label(model.hasPendingPrepCommand
                      ? "A Prep change needs review before queued changes sync."
                      : "A saved tracker change needs a connection check.",
                      systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .accessibilityIdentifier("native-tool-save-error")
                Text(model.errorMessage ?? "Your tracker actions remain saved on this iPhone.")
                    .font(.caption)
            } else if model.conflictBlocked {
                Label("Your Prep update wasn't saved. It's still on this iPhone.",
                      systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .accessibilityIdentifier("native-tool-save-error")
                if let message = model.prepRecoveryMessage {
                    Text(message)
                        .font(.caption)
                        .accessibilityIdentifier("native-tool-prep-recovery-message")
                }
                if canOfferKeepLocalPrep {
                    Button("Keep this Prep") {
                        confirmingRecovery = .keepLocalPrep
                    }
                    .accessibilityIdentifier("native-tool-keep-prep")
                }
                if canUseSavedPrep {
                    Button("Use saved \(savedContentName)") {
                        confirmingRecovery = .useSaved
                    }
                } else {
                    Text("This iPhone queue also contains tracker actions, so using the saved Prep cannot remove it.")
                        .font(.caption)
                }
            } else if let _ = model.errorMessage {
                Label(model.unreadablePendingData
                      ? "We couldn't open your saved change. It hasn't been removed."
                      : model.pendingCount > 0
                          ? "We couldn't confirm that your changes were saved. They're still on this iPhone."
                          : "We couldn't load this event. Try again.",
                      systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .accessibilityIdentifier("native-tool-save-error")
                if model.pendingCount > 0 {
                    Button("Try again") {
                        Task { await model.retry(clerk: clerk) }
                    }
                    .accessibilityIdentifier("native-tool-save-retry")
#if DEBUG
                    .accessibilityValue(model.uiTestPendingMutationID ?? "")
#endif
                    if canUseSavedPrep {
                        Button("Use saved \(savedContentName)") {
                            confirmingRecovery = .useSaved
                        }
                    }
                } else if model.unreadablePendingData {
                    if canUseSavedPrep {
                        Button("Use saved \(savedContentName)") {
                            confirmingRecovery = .useSaved
                        }
                    }
                } else {
                    Button("Try again") { Task { await model.load(clerk: clerk) } }
                }
            } else if model.workspace != nil && !model.busy {
                Label(hasUnsavedChanges ? "Unsaved prep changes" :
                        model.pendingCount > 0 ? "Changes still need saving" :
                        offline.usingSavedContent ? "Saved copy on this iPhone" : "All changes saved",
                      systemImage: hasUnsavedChanges ? "pencil.circle" : "checkmark.shield")
                    .font(.caption)
            }
        }
        .disabled(model.busy)
        .confirmationDialog(
            confirmingRecovery == .keepLocalPrep
                ? "Replace saved Prep?"
                : "Use saved \(savedContentName) instead?",
            isPresented: Binding(
                get: { confirmingRecovery != nil },
                set: { if !$0 { confirmingRecovery = nil } }
            ),
            titleVisibility: .visible
        ) {
            if confirmingRecovery == .keepLocalPrep {
                Button("Replace saved Prep", role: .destructive) {
                    Task { await onKeepLocalPrep?() }
                }
            } else {
                Button("Use saved \(savedContentName)", role: .destructive) {
                    Task { await model.discardAndReload(clerk: clerk) }
                }
            }
        } message: {
            if confirmingRecovery == .keepLocalPrep {
                Text("The saved Prep list will be replaced with the one on this iPhone.")
            } else if model.unreadablePendingData {
                Text("The unreadable copy on this iPhone will be removed. The saved copy will stay.")
            } else {
                Text("Changes not saved yet will be removed from this iPhone. The saved copy will stay.")
            }
        }
    }
}
