import Foundation

@main
struct NativeOfflineProjectionChecks {
    enum Failure: Error { case storage, ownership }

    static func command(_ kind: String, revision: Int = 0) -> NativeEventToolCommand {
        NativeEventToolCommand(shareToken: "event", mutationId: UUID().uuidString,
                               linkId: "verified-link", expectedRevision: revision, kind: kind)
    }
    static func workspace(revision: Int = 0) -> NativeEventWorkspace {
        .init(linkId: "verified-link", prepRevision: 0, trackerRevision: revision, sport: "soccer",
              prep: .init(items: [], notes: ""), rules: .init(phaseLabel: "Half", stats: [
                .init(id: "goal", label: "Goal", points: 1)
              ]), game: nil)
    }
    static func main() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let decoder = JSONDecoder()
        var start = command("start")
        start.soccerFormat = "quarters"
        var saved = NativeEventProjection.apply(start, to: workspace())
        precondition(saved.game?.soccerPeriodFormat == "quarters")
        precondition(saved.game?.status == "live")
        var goal = command("stat")
        goal.statId = "goal"
        goal.athlete = true
        saved = NativeEventProjection.apply(goal, to: saved)
        precondition(saved.game?.stats["goal"] == 1 && saved.game?.score == 0)
        goal = command("stat")
        goal.statId = "goal"
        goal.athlete = false
        saved = NativeEventProjection.apply(goal, to: saved)
        precondition(saved.game?.score == 1)
        saved = NativeEventProjection.apply(command("undo"), to: saved)
        precondition(saved.game?.score == 0 && saved.game?.stats["goal"] == 1)
        var score = command("score")
        score.delta = 2
        saved = NativeEventProjection.apply(score, to: saved)
        score.opponent = true
        score.delta = 1
        saved = NativeEventProjection.apply(score, to: saved)
        saved = NativeEventProjection.apply(command("period"), to: saved)
        precondition(saved.game?.period == 2 && saved.game?.opponentScore == 1)
        saved = NativeEventProjection.apply(command("pause"), to: saved)
        precondition(saved.game?.status == "paused")
        saved = NativeEventProjection.apply(command("resume"), to: saved)
        var finish = command("finish")
        finish.recordScore = true
        saved = NativeEventProjection.apply(finish, to: saved)
        precondition(saved.game?.outcome == "win" && saved.game?.status == "final")
        precondition(saved.trackerRevision == 0, "Local projection must not invent server revisions.")
        let roundTrip = try decoder.decode(NativeEventWorkspace.self, from: encoder.encode(saved))
        precondition(roundTrip.game?.score == 2 && roundTrip.game?.events.count == 1)
        finish.recordScore = false
        finish.outcome = nil
        let unscored = NativeEventProjection.apply(finish, to: NativeEventProjection.apply(start, to: workspace()))
        precondition(unscored.game?.outcome == nil && unscored.game?.scoreRecorded == false)
        finish.outcome = "loss"
        let intentional = NativeEventProjection.apply(finish, to: NativeEventProjection.apply(start, to: workspace()))
        precondition(intentional.game?.outcome == "loss")
        var grouped = NativeEventProjection.apply(start, to: workspace())
        grouped = NativeEventProjection.apply(goal, to: grouped)
        var another = command("stat")
        another.statId = "goal"
        another.athlete = true
        grouped = NativeEventProjection.apply(another, to: grouped)
        var groupedGame = grouped.game!
        for index in groupedGame.events.indices { groupedGame.events[index].playId = "one-play" }
        grouped.game = groupedGame
        grouped = NativeEventProjection.apply(command("undo"), to: grouped)
        precondition(grouped.game?.events.isEmpty == true && grouped.game?.score == 0,
                     "Legacy grouped plays must undo together, just as they do on the server.")

        let now = Date(timeIntervalSince1970: 1_800_000_000)
        var lease = NativeOfflineLease(version: 1, issuer: "native-issuer", subject: "user-A",
                                       origin: "https://native.example", verifiedAt: now,
                                       locked: false, key: Data(repeating: 1, count: 32))
        lease.linkId = "verified-link"
        precondition(lease.permits(now: now, origin: lease.origin, subject: nil))
        precondition(!lease.permits(now: now, origin: lease.origin, subject: "user-B"))
        precondition(!lease.permits(now: now, origin: "https://other.example", subject: "user-A"))
        precondition(!lease.permits(now: now.addingTimeInterval(7 * 86400 + 1), origin: lease.origin, subject: "user-A"))
        precondition(!lease.permits(now: now.addingTimeInterval(-301), origin: lease.origin, subject: "user-A"))
        lease.locked = true
        precondition(!lease.permits(now: now, origin: lease.origin, subject: "user-A"))

        var queue = [
            NativeQueuedEventToolCommand(command: goal, attempted: true, displayOptimistically: true),
            NativeQueuedEventToolCommand(command: score, attempted: false, displayOptimistically: true),
            NativeQueuedEventToolCommand(command: command("prep"), attempted: false, displayOptimistically: true)
        ]
        let attemptedBytes = try encoder.encode(queue[0])
        NativeOfflineOutboxPolicy.acknowledge(&queue, command: goal, revision: 1)
        let unchangedAttempt = try encoder.encode(queue[0])
        precondition(unchangedAttempt == attemptedBytes, "An attempted payload/ID must stay byte-for-byte stable.")
        precondition(queue[1].command.expectedRevision == 1 && queue[2].command.expectedRevision == 0)
        precondition(NativeOfflineOutboxPolicy.conflicts([queue[1]], with: workspace(revision: 2)))
        precondition(!NativeOfflineOutboxPolicy.conflicts([queue[1]], with: workspace(revision: 1)))

        let suite = "pixl-offline-checks-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var protectedBytes: Data?
        var failWrites = false
        let outbox = NativeEventDurableQueue<NativeQueuedEventToolCommand>(
            storageKey: "outbox", defaults: defaults,
            protectedRead: { protectedBytes },
            protectedWrite: { if failWrites { throw Failure.storage }; protectedBytes = $0 })
        try outbox.save(commands: queue, conflictBlocked: false)
        let committedBytes = protectedBytes
        failWrites = true
        do { try outbox.save(commands: [], conflictBlocked: false); preconditionFailure("A failed write must throw.") }
        catch Failure.storage {}
        precondition(outbox.commands.count == 3 && protectedBytes == committedBytes)
        failWrites = false
        let restored = NativeEventDurableQueue<NativeQueuedEventToolCommand>(
            storageKey: "outbox", defaults: defaults,
            protectedRead: { protectedBytes }, protectedWrite: { protectedBytes = $0 })
        precondition(restored.commands.count == 3)
        let restoredAttempt = try encoder.encode(restored.commands[0])
        precondition(restoredAttempt == attemptedBytes)
        protectedBytes = Data("corrupt".utf8)
        let corrupt = NativeEventDurableQueue<NativeQueuedEventToolCommand>(
            storageKey: "outbox", defaults: defaults, initialCommands: queue,
            protectedRead: { protectedBytes }, protectedWrite: { protectedBytes = $0 })
        precondition(corrupt.storageError != nil && protectedBytes == Data("corrupt".utf8))
        print("Offline projection, lease, conflict, immutable retry, and interrupted-write checks passed.")
    }
}
