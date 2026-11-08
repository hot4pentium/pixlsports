import Foundation

@main
struct NativeSeasonStatsChecks {
    static func main() throws {
        func game(_ id: String, date: String, scoreRecorded: Bool = true,
                  athlete: [String: Int] = [:]) -> NativeSeasonStatGame {
            .init(id: id, sourceEventId: nil, date: date, opponent: "Bears",
                  score: 4, opponentScore: 1, scoreRecorded: scoreRecorded,
                  stats: ["goal": 4], athleteStats: athlete)
        }
        let games = [
            game("later", date: "2026-11-08", athlete: ["goal": 2]),
            game("earlier", date: "2026-11-01", scoreRecorded: false, athlete: ["goal": 0]),
            game("no-athlete", date: "2026-11-02"),
        ]
        let athlete = NativeSeasonAnalysis.eligible(games, metric: "goal", scope: .athlete)
        precondition(athlete.count == 2, "Missing attribution is not an athlete zero.")
        precondition(athlete.last?.id == "later")
        precondition(NativeSeasonAnalysis.average(athlete, metric: "goal", scope: .athlete) == 1)
        precondition(NativeSeasonAnalysis.average([], metric: "goal", scope: .athlete) == nil)
        precondition(NativeSeasonAnalysis.metrics(games, scope: .athlete) == ["goal"])
        let scored = NativeSeasonAnalysis.eligible(games, metric: NativeSeasonAnalysis.teamScore, scope: .team)
        precondition(scored.count == 2, "An unentered scoreboard must not count as zero.")
        precondition(NativeSeasonAnalysis.value(games[0], metric: NativeSeasonAnalysis.teamScore, scope: .athlete) == 0)
        precondition(NativeSeasonAnalysis.metrics([], scope: .team).isEmpty)
        let decoded = try JSONDecoder().decode(NativeSeasonStatGame.self, from: JSONEncoder().encode(games[0]))
        precondition(!decoded.pending, "A UI-only pending marker is reconstructed from the durable queue.")
        precondition(game("bad", date: "invalid").parsedDate == nil)
        precondition(Set(games.map(\.id)).count == 3)
        precondition(NativeSeasonAnalysis.canMerge(project: "current", workspaceProject: "current",
                                                  pending: true, verifiedCurrentEvent: true))
        precondition(!NativeSeasonAnalysis.canMerge(project: "current", workspaceProject: "other",
                                                   pending: true, verifiedCurrentEvent: true))
        precondition(NativeSeasonAnalysis.canMerge(project: nil, workspaceProject: nil,
                                                  pending: true, verifiedCurrentEvent: true))
        precondition(!NativeSeasonAnalysis.canMerge(project: nil, workspaceProject: nil,
                                                   pending: false, verifiedCurrentEvent: true))
        precondition(!NativeSeasonAnalysis.canMerge(project: nil, workspaceProject: nil,
                                                   pending: true, verifiedCurrentEvent: false))
        print("Native season stats policy checks passed.")
    }
}
