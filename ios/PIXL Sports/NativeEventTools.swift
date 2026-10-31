import SwiftUI
import Combine
import ClerkKit

extension Notification.Name {
    static let nativeEventScheduleChanged = Notification.Name("pixl.nativeEventScheduleChanged")
}

enum NativeEventScheduleChangeReason: String {
    case gameStarted
    case gameFinished
    case liveTapsStarted
    case eventCardEdited

    static let userInfoKey = "reason"

    var refreshesEventDetail: Bool { self != .eventCardEdited }
}

struct NativeEventWorkspace: Decodable {
    struct Prep: Decodable {
        let items: [NativePrepItem]
        let notes: String
    }
    struct Rules: Decodable {
        struct Stat: Decodable, Identifiable {
            let id: String
            let label: String
            let points: Int
        }
        let phaseLabel: String
        let stats: [Stat]
    }
    struct Game: Decodable {
        struct Play: Decodable, Identifiable {
            let id: String
            let statId: String
            let attribution: String?
            let possessionSide: String?
            let period: Int
            let yards: Int?
        }
        let id: String
        let sport: String
        let status: String
        let period: Int
        let soccerPeriodFormat: String?
        var score: Int
        var opponentScore: Int
        var scoreRecorded: Bool?
        let outcome: String?
        var stats: [String: Int]
        var opponentStats: [String: Int]?
        var events: [Play]
        var hasRecordedScore: Bool { scoreRecorded ?? (score != 0 || opponentScore != 0) }
    }
    let linkId: String
    let prepRevision: Int
    let trackerRevision: Int
    let sport: String
    let prep: Prep
    let rules: Rules
    let game: Game?
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

struct NativeQueuedEventToolCommand: Codable {
    var command: NativeEventToolCommand
    var attempted: Bool
    var displayOptimistically: Bool
}

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
    private let durableQueue: NativeEventDurableQueue<NativeQueuedEventToolCommand>
    private var drainingQueue = false
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
            ? "Syncing \(pendingCount) \(noun) with PIXL…"
            : "\(pendingCount) \(noun) waiting to sync"
    }

    var canQueueStat: Bool {
        guard !unreadablePendingData, !conflictBlocked,
              workspace?.game?.status == "live",
              !pendingQueue.contains(where: { $0.command.kind != "stat" }) else { return false }
        return !busy || !pendingQueue.isEmpty
    }

    var displayedGame: NativeEventWorkspace.Game? {
        guard var game = workspace?.game else { return nil }
        for queued in pendingQueue where queued.displayOptimistically && queued.command.kind == "stat" {
            let command = queued.command
            guard let statID = command.statId,
                  let stat = workspace?.rules.stats.first(where: { $0.id == statID }) else { continue }
            let opponentTeam = game.sport == "football" && command.opponent == true
            if opponentTeam {
                var stats = game.opponentStats ?? [:]
                stats[statID, default: 0] += 1
                game.opponentStats = stats
            } else {
                game.stats[statID, default: 0] += 1
            }
            let points = opponentTeam || command.athlete != true ? stat.points : 0
            if opponentTeam {
                game.opponentScore += points
            } else {
                game.score += points
            }
            game.scoreRecorded = game.scoreRecorded == true || points > 0
            game.events.append(.init(
                id: command.mutationId,
                statId: statID,
                attribution: opponentTeam ? "team" : command.athlete == true ? "athlete" : "team",
                possessionSide: game.sport == "football" ? (opponentTeam ? "opponent" : "athlete") : nil,
                period: game.period,
                yards: game.sport == "football" ? command.yards ?? 0 : nil
            ))
        }
        return game
    }
#if DEBUG
    var uiTestPendingMutationID: String? {
        guard ProcessInfo.processInfo.arguments.contains("--ui-testing-signed-in-prep") else { return nil }
        return pending?.mutationId
    }
#endif

    init(shareToken: String, accountID: String) {
        self.shareToken = shareToken
        storageKey = "pixl-native-event-pending:\(accountID):\(shareToken)"
        let legacyCommand = UserDefaults.standard.data(forKey: storageKey)
            .flatMap { try? JSONDecoder().decode(NativeEventToolCommand.self, from: $0) }
        let legacyQueue = legacyCommand.map {
            [NativeQueuedEventToolCommand(command: $0, attempted: true, displayOptimistically: false)]
        } ?? []
        durableQueue = NativeEventDurableQueue(
            storageKey: storageKey,
            initialCommands: legacyQueue
        )
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
        for index in pendingQueue.indices where pendingQueue[index].attempted {
            pendingQueue[index].displayOptimistically = false
        }
    }

#if DEBUG
    init(uiTestFixture: NativeEventWorkspaceUITestFixture) {
        precondition(NativeEventWorkspaceUITestFixture.isRequested)
        shareToken = "ui-test-event"
        storageKey = "unused-ui-test-prep-draft"
        durableQueue = NativeEventDurableQueue(storageKey: storageKey)
        workspace = uiTestFixture.workspace
    }
#endif

    func load(clerk: Clerk) async {
        guard !busy else { return }
        busy = true
        var shouldDrain = false
        do {
            let data = try await NativeAccountLinkClient().postData(
                "supporter/event-workspace", body: ["shareToken": shareToken], clerk: clerk
            )
            workspace = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
            reconcileRestoredStatQueue()
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

    func save(
        _ kind: String, clerk: Clerk, statID: String? = nil,
        athlete: Bool? = nil, opponent: Bool? = nil, yards: Int? = nil,
        delta: Int? = nil, soccerFormat: String? = nil,
        recordScore: Bool? = nil, outcome: String? = nil,
        items: [NativePrepItem]? = nil, notes: String? = nil
    ) async {
        guard !unreadablePendingData, !conflictBlocked, let workspace else { return }
        if kind == "stat" {
            guard canQueueStat else { return }
            guard pendingQueue.count < Self.maximumPendingCommands else {
                errorMessage = "Sync the pending stats before recording more. The on-device queue is full."
                return
            }
        } else {
            guard !busy, pendingQueue.isEmpty else { return }
        }

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
        pendingQueue.append(.init(
            command: command,
            attempted: false,
            displayOptimistically: kind == "stat"
        ))
        do {
            try persistPendingQueue()
        } catch {
            pendingQueue.removeLast()
            errorMessage = "The pending change could not be saved on this iPhone. Nothing was sent."
            return
        }
        errorMessage = nil
        await drainQueue(clerk: clerk)
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
        drainingQueue = true
        busy = true
        errorMessage = nil
        defer {
            busy = false
            drainingQueue = false
        }

        while !pendingQueue.isEmpty {
            if !pendingQueue[0].attempted {
                guard let workspace else { return }
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
                self.workspace = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
                pendingQueue.removeFirst()
                do { try persistPendingQueue() }
                catch {
                    errorMessage = "The server saved this change, but the local queue could not be updated. Retrying is safe."
                    return
                }
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-signed-in-prep") {
                    UserDefaults.standard.removeObject(forKey: "\(storageKey):debug-drop-response:\(command.mutationId)")
            }
#endif
                postScheduleChange(for: command)
            } catch {
                if (error as? NativeAccountLinkError)?.statusCode == 409 {
                    conflictBlocked = true
                    try? persistPendingQueue()
                    errorMessage = "\(error.localizedDescription) Your queued changes are still saved on this iPhone. Discard them only if you want to use the server version."
                } else {
                    errorMessage = "\(error.localizedDescription) \(pendingCount) pending changes remain saved on this iPhone. Retry when connected."
                }
                return
            }
        }
    }

    func discardAndReload(clerk: Clerk) async {
        guard !busy else { return }
        pendingQueue.removeAll()
        conflictBlocked = false
        unreadablePendingData = false
        durableQueue.removeAll()
        errorMessage = nil
        await load(clerk: clerk)
        reloadGeneration += 1
    }

    private func persistPendingQueue() throws {
        try durableQueue.save(commands: pendingQueue, conflictBlocked: conflictBlocked)
    }

    private func reconcileRestoredStatQueue() {
        guard !unreadablePendingData,
              let trackerRevision = workspace?.trackerRevision else { return }
        for index in pendingQueue.indices
        where pendingQueue[index].attempted && pendingQueue[index].command.kind == "stat" {
            pendingQueue[index].displayOptimistically =
                pendingQueue[index].command.expectedRevision >= trackerRevision
        }
        if !pendingQueue.isEmpty { try? persistPendingQueue() }
    }

    private func postScheduleChange(for command: NativeEventToolCommand) {
        let reason: NativeEventScheduleChangeReason?
        switch command.kind {
        case "start": reason = .gameStarted
        case "finish": reason = .gameFinished
        default: reason = nil
        }
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
    let clerk: Clerk
    var hasUnsavedChanges = false
    @State private var confirmingDiscard = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.busy {
                HStack { ProgressView(); Text(model.pendingCount > 0 ? model.pendingDescription : "Loading from PIXL…") }
            } else if model.pendingCount > 0 {
                Label(model.pendingDescription, systemImage: "clock.arrow.circlepath")
                    .font(.caption)
            }
            if let message = model.errorMessage {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .accessibilityIdentifier("native-tool-save-error")
                if model.pendingCount > 0 {
                    if !model.conflictBlocked {
                        Button(model.pendingCount == 1 ? "Retry pending save" : "Retry pending saves") {
                            Task { await model.retry(clerk: clerk) }
                        }
                        .accessibilityIdentifier("native-tool-save-retry")
#if DEBUG
                        .accessibilityValue(model.uiTestPendingMutationID ?? "")
#endif
                    }
                    Button(model.pendingCount == 1 ? "Discard pending change and reload" : "Discard pending changes and reload",
                           role: .destructive) {
                        confirmingDiscard = true
                    }
                } else if model.unreadablePendingData {
                    Button("Discard unreadable save and reload", role: .destructive) {
                        confirmingDiscard = true
                    }
                } else {
                    Button("Try again") { Task { await model.load(clerk: clerk) } }
                }
            } else if model.workspace != nil && !model.busy {
                Label(hasUnsavedChanges ? "Unsaved prep changes" : "Connected to your PIXL account",
                      systemImage: hasUnsavedChanges ? "pencil.circle" : "checkmark.shield")
                    .font(.caption)
            }
        }
        .disabled(model.busy)
        .confirmationDialog(
            model.pendingCount == 1 ? "Discard this pending change?" : "Discard these pending changes?",
            isPresented: $confirmingDiscard,
            titleVisibility: .visible
        ) {
            Button("Discard and reload", role: .destructive) {
                Task { await model.discardAndReload(clerk: clerk) }
            }
        } message: {
            if model.unreadablePendingData {
                Text("This removes the unreadable on-device save and reloads the server version.")
            } else if model.pendingCount == 1 {
                Text("The server may already have saved it. Reloading checks the latest saved data; an unsent change will not be applied.")
            } else {
                Text("The server may already have saved some actions. Reloading checks the latest data; any unsent actions will not be applied.")
            }
        }
    }
}
