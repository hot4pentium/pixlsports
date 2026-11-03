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
        eventStart.addingTimeInterval(-2 * 60 * 60 + date.timeIntervalSince(launchedAt) + clockOffset)
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
    @Published private(set) var pendingQueue: [NativeQueuedEventToolCommand] = []
    @Published private(set) var conflictBlocked = false
    @Published private(set) var unreadablePendingData = false
    @Published var reloadGeneration = 0
    private let shareToken: String
    private let storageKey: String
    private var durableQueue: NativeEventDurableQueue<NativeQueuedEventToolCommand>
    private var drainingQueue = false
    private var acknowledgedWorkspace: NativeEventWorkspace?
    private var scheduledDrain: Task<Void, Never>?
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
            ? "Saving \(pendingCount) \(noun) to PIXL…"
            : "\(pendingCount) \(noun) not yet saved to PIXL"
    }

    var ownsCurrentScope: Bool { scope == offline.vault.namespace && offline.canContinue }
    var canEditLocally: Bool {
#if DEBUG
        if NativeEventWorkspaceUITestFixture.isRequested { return workspace != nil }
#endif
        return workspace != nil && !unreadablePendingData && !conflictBlocked && ownsCurrentScope
    }
    var canQueueStat: Bool { canEditLocally && workspace?.game?.status == "live" }
    var pendingFinal: Bool { pendingQueue.contains { $0.command.kind == "finish" } }

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
        if durableQueue.storageError != nil {
            unreadablePendingData = true
            errorMessage = durableQueue.storageError?.localizedDescription
        } else if conflictBlocked {
            errorMessage = "The tracker changed elsewhere. Your pending changes are still saved on this iPhone."
        } else if !pendingQueue.isEmpty {
            errorMessage = "Checking your saved tracker changes…"
        }
        if let data = try? offline.vault.read("workspace/" + shareToken, subject: accountID),
           let saved = try? JSONDecoder().decode(NativeEventWorkspace.self, from: data) {
            acknowledgedWorkspace = saved
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
            let data = try await NativeAccountLinkClient().postData(
                "supporter/event-workspace", body: ["shareToken": shareToken], clerk: clerk
            )
            guard scope == offline.vault.namespace else { return }
            let next = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
            if (durableQueue.storageError as? NativeOfflineError) == .notPrepared {
                durableQueue = Self.openQueue(storageKey: storageKey, token: shareToken,
                                              accountID: offline.accountID, scope: scope)
                pendingQueue = durableQueue.commands
                conflictBlocked = durableQueue.conflictBlocked
                unreadablePendingData = durableQueue.storageError != nil
            }
            if NativeOfflineOutboxPolicy.conflicts(pendingQueue, with: next) { conflictBlocked = true }
            acknowledgedWorkspace = next
            reconcileRestoredStatQueue()
            rebuildProjection()
            await recoverChecklistDraft(clerk: clerk)
            if unreadablePendingData {
                errorMessage = "A saved tracker change could not be read. It has not been removed."
            } else if conflictBlocked {
                errorMessage = "The tracker changed elsewhere. Your pending changes are still saved on this iPhone. Reload before choosing what to keep."
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
        guard !unreadablePendingData, !conflictBlocked, let workspace else { return }
        guard canEditLocally else { return }
        if kind == "stat" {
            guard canQueueStat else { return }
        }
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
        guard workspace != nil else {
            await load(clerk: clerk)
            return
        }
        await drainQueue(clerk: clerk)
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
                    conflictBlocked = true
                    try persistPendingQueue()
                    rebuildProjection()
                    errorMessage = "This event also changed elsewhere. Remaining changes are saved here for your review."
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
                if (error as? NativeAccountLinkError)?.statusCode == 409 {
                    conflictBlocked = true
                    try? persistPendingQueue()
                    errorMessage = "\(error.localizedDescription) Your queued changes are still saved on this iPhone. Discard them only if you want to use the server version."
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

    func discardAndReload(clerk: Clerk) async {
        guard !busy, !drainingQueue, offline.online else {
            errorMessage = "Connect to the internet before using the PIXL version. Your changes are still saved on this iPhone."
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
            reloadGeneration += 1
        } catch { errorMessage = error.localizedDescription }
    }

    private func persistPendingQueue() throws {
        guard scope == offline.vault.namespace else { throw NativeOfflineError.locked }
        try durableQueue.save(commands: pendingQueue, conflictBlocked: conflictBlocked)
        offline.storageChanged()
    }

    private func reconcileRestoredStatQueue() {
        guard !unreadablePendingData,
              let saved = acknowledgedWorkspace else { return }
        for index in pendingQueue.indices
        where pendingQueue[index].attempted {
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
    @State private var confirmingDiscard = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !offline.online {
                Label("Offline · changes stay on this iPhone. Live Taps and sharing need a connection.",
                      systemImage: "wifi.slash").font(.caption)
            }
            if model.busy {
                HStack { ProgressView(); Text(model.pendingCount > 0 ? model.pendingDescription : "Loading from PIXL…") }
            } else if model.pendingCount > 0 {
                Label(model.pendingDescription, systemImage: "clock.arrow.circlepath")
                    .font(.caption)
                    .accessibilityIdentifier("native-tool-pending")
            }
            if model.conflictBlocked {
                Label(model.pendingCount == 1
                      ? "This change may not be in PIXL yet. It's still saved on this iPhone."
                      : "These changes may not be in PIXL yet. They're still saved on this iPhone.",
                      systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .accessibilityIdentifier("native-tool-save-error")
                Button("Use PIXL version", role: .destructive) {
                    confirmingDiscard = true
                }
            } else if let message = model.errorMessage {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .accessibilityIdentifier("native-tool-save-error")
                if model.pendingCount > 0 {
                    Button("Try saving again") {
                        Task { await model.retry(clerk: clerk) }
                    }
                    .accessibilityIdentifier("native-tool-save-retry")
#if DEBUG
                    .accessibilityValue(model.uiTestPendingMutationID ?? "")
#endif
                    Button("Use PIXL version", role: .destructive) {
                        confirmingDiscard = true
                    }
                } else if model.unreadablePendingData {
                    Button("Use PIXL version", role: .destructive) {
                        confirmingDiscard = true
                    }
                } else {
                    Button("Try again") { Task { await model.load(clerk: clerk) } }
                }
            } else if model.workspace != nil && !model.busy {
                Label(hasUnsavedChanges ? "Unsaved prep changes" :
                        model.pendingCount > 0 ? "Saved here · not yet saved to PIXL" :
                        offline.usingSavedContent ? "Saved copy on this iPhone" : "All changes saved to PIXL",
                      systemImage: hasUnsavedChanges ? "pencil.circle" : "checkmark.shield")
                    .font(.caption)
            }
        }
        .disabled(model.busy)
        .confirmationDialog(
            "Use the PIXL version instead?",
            isPresented: $confirmingDiscard,
            titleVisibility: .visible
        ) {
            Button("Use PIXL version", role: .destructive) {
                Task { await model.discardAndReload(clerk: clerk) }
            }
        } message: {
            if model.unreadablePendingData {
                Text("This removes the saved copy on this iPhone and uses the version in PIXL.")
            } else {
                Text("Anything not saved to PIXL will be removed from this iPhone. Anything already saved to PIXL will stay.")
            }
        }
    }
}
