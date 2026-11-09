import Foundation

// Pure Foundation regression executable. Compile with NativeEventDurableQueue.swift
// and NativeEventWorkspaceSnapshot.swift on a Mac; see native-athlete-scoring-checks.md.
@main
struct NativeAthleteScoringChecks {
    static func command(_ kind: String, stat: String? = nil, athlete: Bool? = nil,
                        opponent: Bool? = nil, version: Int? = 2) -> NativeEventToolCommand {
        var result = NativeEventToolCommand(shareToken: "event", mutationId: UUID().uuidString,
                                           linkId: "link", expectedRevision: 0, kind: kind)
        result.statId = stat
        result.athlete = athlete
        result.opponent = opponent
        if kind == "stat" { result.scoringVersion = version }
        return result
    }

    static func workspace(sport: String = "football", stat: String = "touchdown",
                          points: Int = 6) -> NativeEventWorkspace {
        NativeEventWorkspace(
            linkId: "link", prepRevision: 0, trackerRevision: 0, sport: sport,
            prep: .init(items: [], notes: ""),
            rules: .init(phaseLabel: "Quarter", stats: [.init(id: stat, label: stat, points: points)]),
            game: .init(id: "same-game", sport: sport, status: "live", period: 1,
                        soccerPeriodFormat: nil, score: 0, opponentScore: 0, scoreRecorded: false,
                        outcome: nil, stats: [:], opponentStats: [:], events: [])
        )
    }

    static func main() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let decoder = JSONDecoder()
        let samples: [(String, String, Int)] = [
            ("football", "touchdown", 6), ("football", "field-goal", 3),
            ("football", "extra-point", 1), ("football", "two-point-conversion", 2),
            ("football", "reception", 0), ("basketball", "one-point", 1),
            ("basketball", "two-point", 2), ("basketball", "three-point", 3),
            ("soccer", "goal", 1), ("soccer", "assist", 0),
            ("volleyball", "kill", 1), ("volleyball", "dig", 0),
            ("baseball", "run", 1), ("baseball", "home-run", 4),
            ("softball", "run", 1), ("softball", "home-run", 4),
        ]
        for (sport, stat, points) in samples {
            for athlete in [true, false] {
                let base = workspace(sport: sport, stat: stat, points: points)
                let scored = NativeEventProjection.apply(command("stat", stat: stat, athlete: athlete), to: base)
                precondition(scored.game?.score == points && scored.game?.stats[stat] == 1)
                precondition(scored.game?.events.count == 1 && scored.game?.opponentScore == 0)
                precondition(scored.game?.events[0].attribution == (athlete ? "athlete" : "team"))
                precondition(scored.game?.events[0].scoreDelta == points)
                precondition(scored.game?.scoreRecorded == (points > 0))
                let restored = try decoder.decode(NativeEventWorkspace.self, from: encoder.encode(scored))
                precondition(restored.game?.events[0].scoreDelta == points)
                let undone = NativeEventProjection.apply(command("undo"), to: restored)
                precondition(undone.game?.score == 0 && undone.game?.events.isEmpty == true)
            }
        }

        var mixed = NativeEventProjection.apply(command("stat", stat: "touchdown", athlete: true), to: workspace())
        mixed = NativeEventProjection.apply(command("stat", stat: "touchdown", athlete: false), to: mixed)
        precondition(mixed.game?.score == 12 && mixed.game?.stats["touchdown"] == 2)
        precondition(mixed.game?.events.filter { $0.attribution == "athlete" }.count == 1)
        mixed = NativeEventProjection.apply(command("stat", stat: "touchdown", athlete: true, opponent: true), to: mixed)
        precondition(mixed.game?.score == 12 && mixed.game?.opponentScore == 6)
        precondition(mixed.game?.opponentStats?["touchdown"] == 1)
        precondition(mixed.game?.events.last?.attribution == "team")
        mixed = NativeEventProjection.apply(command("undo"), to: mixed)
        precondition(mixed.game?.score == 12 && mixed.game?.opponentScore == 0)
        var adjustment = command("score")
        adjustment.delta = 1
        mixed = NativeEventProjection.apply(adjustment, to: mixed)
        mixed = NativeEventProjection.apply(command("undo"), to: mixed)
        mixed = NativeEventProjection.apply(command("undo"), to: mixed)
        precondition(mixed.game?.score == 1, "Stat undo must preserve independent score adjustments.")

        // Historical athlete plays did not contribute points. Do not change
        // existing totals or guess their contribution when undoing them.
        var historical = workspace()
        historical.game!.score = 12
        historical.game!.stats = ["touchdown": 1]
        historical.game!.events = [.init(id: "old", statId: "touchdown", attribution: "athlete",
                                          possessionSide: nil, period: 1, yards: nil)]
        let oldBytes = try encoder.encode(historical)
        historical = try decoder.decode(NativeEventWorkspace.self, from: oldBytes)
        precondition(historical.game?.events[0].scoreDelta == nil)
        historical = NativeEventProjection.apply(command("stat", stat: "touchdown", athlete: true), to: historical)
        precondition(historical.game?.score == 18)
        historical = NativeEventProjection.apply(command("undo"), to: historical)
        historical = NativeEventProjection.apply(command("undo"), to: historical)
        precondition(historical.game?.score == 12)
        var explicitZero = workspace()
        explicitZero.game!.score = 12
        explicitZero.game!.stats = ["touchdown": 1]
        explicitZero.game!.events = [.init(id: "zero", statId: "touchdown", attribution: "team",
                                           possessionSide: nil, period: 1, yards: nil, scoreDelta: 0)]
        precondition(NativeEventProjection.apply(command("undo"), to: explicitZero).game?.score == 12)

        var grouped = workspace()
        grouped.game!.score = 14 // Two scored touchdowns plus a manual +2.
        grouped.game!.stats = ["touchdown": 3]
        grouped.game!.events = [
            .init(id: "old-athlete", statId: "touchdown", attribution: "athlete", possessionSide: nil,
                  period: 1, yards: nil, playId: "group"),
            .init(id: "old-team", statId: "touchdown", attribution: "team", possessionSide: nil,
                  period: 1, yards: nil, playId: "group"),
            .init(id: "new-athlete", statId: "touchdown", attribution: "athlete", possessionSide: nil,
                  period: 1, yards: nil, playId: "group", scoreDelta: 6),
        ]
        grouped = NativeEventProjection.apply(command("undo"), to: grouped)
        precondition(grouped.game?.events.isEmpty == true && grouped.game?.score == 2)

        // Save and reopen an outbox containing both old and new actions. An
        // upgrade must not change the payload of an uncertain legacy request.
        let legacy = command("stat", stat: "touchdown", athlete: true, version: nil)
        let modern = command("stat", stat: "touchdown", athlete: true)
        let legacyBytes = try encoder.encode(legacy)
        let legacyObject = try JSONSerialization.jsonObject(with: legacyBytes) as! [String: Any]
        precondition(legacyObject["scoringVersion"] == nil)
        precondition(NativeEventProjection.apply(legacy, to: workspace()).game?.score == 0)
        let suite = "pixl-scoring-" + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var bytes: Data?
        let queue = NativeEventDurableQueue<NativeQueuedEventToolCommand>(
            storageKey: "outbox", defaults: defaults, protectedRead: { bytes }, protectedWrite: { bytes = $0 })
        try queue.save(commands: [
            .init(command: legacy, attempted: true, displayOptimistically: true),
            .init(command: modern, attempted: false, displayOptimistically: true),
        ], conflictBlocked: false)
        let restored = NativeEventDurableQueue<NativeQueuedEventToolCommand>(
            storageKey: "outbox", defaults: defaults, protectedRead: { bytes }, protectedWrite: { bytes = $0 })
        let restoredBytes = try encoder.encode(restored.commands[0].command)
        precondition(restoredBytes == legacyBytes)
        precondition(restored.commands[1].command.scoringVersion == 2)
        let projection = restored.commands.reduce(workspace()) { NativeEventProjection.apply($1.command, to: $0) }
        precondition(projection.game?.score == 6 && projection.game?.events.count == 2)
        // An acknowledged mutation is removed before rebuilding against the
        // confirmed snapshot; it must not be applied over its confirmed points.
        let confirmed = NativeEventProjection.apply(legacy, to: workspace())
        let remaining = restored.commands.filter { $0.command.mutationId != legacy.mutationId }
        let afterAcknowledgement = remaining.reduce(confirmed) { NativeEventProjection.apply($1.command, to: $0) }
        precondition(afterAcknowledgement.game?.score == 6 && afterAcknowledgement.game?.events.count == 2)
        let allAcknowledged = Set([legacy.mutationId, modern.mutationId])
        let cleared = restored.commands.filter { !allAcknowledged.contains($0.command.mutationId) }
        let afterModernAcknowledgement = cleared.reduce(afterAcknowledgement) {
            NativeEventProjection.apply($1.command, to: $0)
        }
        precondition(afterModernAcknowledgement.game?.score == 6
                     && afterModernAcknowledgement.game?.events.count == 2,
                     "Acknowledging the new athlete touchdown must not add six points again.")
        print("Athlete/team scoring, opponent isolation, legacy undo and durable mixed-version outbox checks passed.")
    }
}
