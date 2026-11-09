import Foundation

struct NativeOfflinePrepDraft: Codable {
    let items: [NativePrepItem]
    let notes: String
    let notesDirty: Bool
    var checklistDirty: Bool
    var baseRevision: Int? = nil
}

struct NativeQueuedEventToolCommand: Codable {
    var command: NativeEventToolCommand
    var attempted: Bool
    var displayOptimistically: Bool
}

enum NativeOfflineOutboxPolicy {
    static func conflicts(_ queue: [NativeQueuedEventToolCommand], with saved: NativeEventWorkspace) -> Bool {
        if queue.contains(where: { $0.command.linkId != saved.linkId }) { return true }
        for isPrep in [true, false] {
            let affected = queue.filter { ($0.command.kind == "prep") == isPrep }
            let revision = isPrep ? saved.prepRevision : saved.trackerRevision
            if !affected.contains(where: \.attempted),
               affected.contains(where: { $0.command.expectedRevision != revision }) { return true }
        }
        return false
    }

    static func queueForUserConfirmedPrepReplacement(
        _ queue: [NativeQueuedEventToolCommand],
        saved: NativeEventWorkspace,
        shareToken: String,
        mutationID: String,
        items: [NativePrepItem],
        notes: String
    ) -> [NativeQueuedEventToolCommand]? {
        guard queue.allSatisfy({ $0.command.kind == "prep" }) else { return nil }
        var command = NativeEventToolCommand(
            shareToken: shareToken,
            mutationId: mutationID,
            linkId: saved.linkId,
            expectedRevision: saved.prepRevision,
            kind: "prep"
        )
        command.items = items
        command.notes = notes
        return [.init(command: command, attempted: false, displayOptimistically: true)]
    }

    static func acknowledge(_ queue: inout [NativeQueuedEventToolCommand],
                            command: NativeEventToolCommand, revision: Int) {
        for index in queue.indices where !queue[index].attempted
            && (queue[index].command.kind == "prep") == (command.kind == "prep") {
            queue[index].command.expectedRevision = revision
        }
    }
}

enum NativeTrackerOutboxPolicy {
    static func incompatibility(
        _ queue: [NativeQueuedEventToolCommand],
        previous: NativeEventWorkspace?,
        latest: NativeEventWorkspace,
        shareToken: String,
        acknowledgedMutationIds: Set<String> = []
    ) -> NativeTrackerRecoveryStatus? {
        let tracker = queue.filter {
            $0.command.kind != "prep" && !acknowledgedMutationIds.contains($0.command.mutationId)
        }
        guard let first = tracker.first else { return nil }
        guard tracker.allSatisfy({
            $0.command.shareToken == shareToken && $0.command.linkId == latest.linkId
        }) else { return .linkChanged }

        let status = latest.eventStatus?.lowercased()
        if status == "final" || status == "complete" || status == "completed"
            || latest.game?.status == "final" {
            return .gameFinished
        }

        if let previousGame = previous?.game {
            guard let latestGame = latest.game, latestGame.id == previousGame.id else {
                return .gameChanged
            }
            guard latestGame.status == "live" || latestGame.status == "paused" else {
                return .gameFinished
            }
            if tracker.contains(where: { $0.command.kind == "start" }) { return .gameChanged }
        } else {
            guard latest.game == nil, first.command.kind == "start" else { return .gameChanged }
        }
        return nil
    }

    /// Only commands that have never been sent may receive a new revision.
    /// Once an attempted command is in the queue, later tracker commands wait
    /// behind it and are rebased after its exact retry is acknowledged.
    static func rebaseNeverAttempted(
        _ queue: inout [NativeQueuedEventToolCommand],
        against workspace: NativeEventWorkspace
    ) {
        var revision = workspace.trackerRevision
        var mayRebase = true
        for index in queue.indices where queue[index].command.kind != "prep" {
            if queue[index].attempted {
                mayRebase = false
                continue
            }
            guard mayRebase else { continue }
            queue[index].command.expectedRevision = revision
            revision += 1
        }
    }
}

struct NativeEventWorkspace: Codable {
    struct Prep: Codable {
        var items: [NativePrepItem]
        var notes: String
    }
    struct Rules: Codable {
        struct Stat: Codable, Identifiable {
            let id: String
            let label: String
            let points: Int
        }
        let phaseLabel: String
        let stats: [Stat]
    }
    struct Game: Codable {
        struct Play: Codable, Identifiable {
            let id: String
            let statId: String
            let attribution: String?
            let possessionSide: String?
            let period: Int
            let yards: Int?
            var playId: String? = nil
            var scoreDelta: Int? = nil
        }
        let id: String
        let sport: String
        var status: String
        var period: Int
        let soccerPeriodFormat: String?
        var score: Int
        var opponentScore: Int
        var scoreRecorded: Bool?
        var outcome: String?
        var stats: [String: Int]
        var opponentStats: [String: Int]?
        var events: [Play]
        var date: String? = nil
        var opponent: String? = nil
        var sourceEventId: String? = nil
        var liveTapsOnly: Bool? = nil
        var hasRecordedScore: Bool { scoreRecorded ?? (score != 0 || opponentScore != 0) }
    }
    let linkId: String
    let prepRevision: Int
    let trackerRevision: Int
    let sport: String
    var prep: Prep
    let rules: Rules
    var game: Game?
    var eventStatus: String? = nil
    var acknowledgedMutationIds: [String]? = nil
    var trackerProjectId: String? = nil
}

struct NativeEventWorkspaceRequest: Encodable {
    let shareToken: String
    let pendingMutationIds: [String]
}

/// Pure local projection. Revisions remain the last SERVER revisions; a local
/// final is explicitly pending until its immutable mutation has been acknowledged.
enum NativeEventProjection {
    static func apply(_ command: NativeEventToolCommand, to saved: NativeEventWorkspace) -> NativeEventWorkspace {
        var result = saved
        guard command.linkId == saved.linkId else { return result }
        if command.kind == "prep" {
            if let items = command.items { result.prep.items = items }
            if let notes = command.notes { result.prep.notes = notes }
            return result
        }
        if command.kind == "start", result.game == nil {
            result.game = .init(id: "local-" + command.mutationId, sport: saved.sport,
                                status: "live", period: 1, soccerPeriodFormat: command.soccerFormat,
                                score: 0, opponentScore: 0, scoreRecorded: false, outcome: nil,
                                stats: [:], opponentStats: [:], events: [])
            return result
        }
        guard var game = result.game, game.status != "final" else { return result }
        if command.kind == "finish" {
            game.status = "final"
            game.scoreRecorded = command.recordScore
            game.outcome = command.recordScore == true
                ? (game.score > game.opponentScore ? "win" : game.score < game.opponentScore ? "loss" : "tie")
                : command.outcome
        } else if command.kind == "resume" {
            game.status = "live"
        } else if game.status == "live" {
            switch command.kind {
            case "pause": game.status = "paused"
            case "period": game.period += 1
            case "score":
                if command.opponent == true { game.opponentScore = max(0, game.opponentScore + (command.delta ?? 0)) }
                else { game.score = max(0, game.score + (command.delta ?? 0)) }
                game.scoreRecorded = true
            case "stat":
                guard let stat = saved.rules.stats.first(where: { $0.id == command.statId }) else { return result }
                let other = game.sport == "football" && command.opponent == true
                if other {
                    var stats = game.opponentStats ?? [:]
                    stats[stat.id, default: 0] += 1
                    game.opponentStats = stats
                } else { game.stats[stat.id, default: 0] += 1 }
                let points = command.scoringVersion == 2 || other || command.athlete != true ? stat.points : 0
                if other { game.opponentScore += points } else { game.score += points }
                game.scoreRecorded = game.scoreRecorded == true || points > 0
                game.events.append(.init(id: command.mutationId, statId: stat.id,
                                        attribution: other || command.athlete != true ? "team" : "athlete",
                                        possessionSide: game.sport == "football" ? (other ? "opponent" : "athlete") : nil,
                                        period: game.period, yards: game.sport == "football" ? command.yards ?? 0 : nil,
                                        scoreDelta: points))
            case "undo":
                if let last = game.events.last {
                    let removed = game.events.filter { play in
                        last.playId.map { group in play.playId == group } ?? (play.id == last.id)
                    }
                    let removedIDs = Set(removed.map(\.id))
                    game.events.removeAll { removedIDs.contains($0.id) }
                    for play in removed {
                    let other = game.sport == "football" && play.possessionSide == "opponent"
                    if other {
                        var stats = game.opponentStats ?? [:]
                        stats[play.statId] = max(0, (stats[play.statId] ?? 0) - 1)
                        game.opponentStats = stats
                    } else { game.stats[play.statId] = max(0, (game.stats[play.statId] ?? 0) - 1) }
                    let points = play.scoreDelta ?? (play.attribution == "athlete" && !other ? 0 :
                        (saved.rules.stats.first { $0.id == play.statId }?.points ?? 0))
                    if other { game.opponentScore = max(0, game.opponentScore - points) }
                    else { game.score = max(0, game.score - points) }
                    }
                }
            default: break
            }
        }
        result.game = game
        return result
    }
}
