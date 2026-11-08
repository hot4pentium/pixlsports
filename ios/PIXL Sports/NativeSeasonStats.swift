import Foundation

struct NativeSeasonStats: Codable {
    let athleteName: String
    let teamName: String
    let seasonName: String
    var sport: String?
    var trackerProjectId: String?
    var games: [NativeSeasonStatGame]
}

struct NativeSeasonStatGame: Codable, Identifiable {
    let id: String
    let sourceEventId: String?
    let date: String
    let opponent: String
    let score: Int
    let opponentScore: Int
    let scoreRecorded: Bool
    let stats: [String: Int]
    let athleteStats: [String: Int]
    var pending = false

    enum CodingKeys: String, CodingKey {
        case id, sourceEventId, date, opponent, score, opponentScore, scoreRecorded, stats, athleteStats
    }

    var parsedDate: Date? {
        if let value = ISO8601DateFormatter().date(from: date) { return value }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .current
        formatter.dateFormat = "yyyy-MM-dd"
        formatter.isLenient = false
        return formatter.date(from: String(date.prefix(10)))
    }

    var dateLabel: String {
        parsedDate?.formatted(date: .abbreviated, time: .omitted) ?? "Date unavailable"
    }

    var scoreLabel: String {
        scoreRecorded ? "\(score)–\(opponentScore)" : "Score not recorded"
    }
}

enum NativeSeasonStatScope: String, CaseIterable, Identifiable {
    case athlete = "Athlete", team = "Team"
    var id: String { rawValue }
}

enum NativeSeasonAnalysis {
    static let teamScore = "_team-score"

    static func canMerge(project: String?, workspaceProject: String?, pending: Bool, verifiedCurrentEvent: Bool) -> Bool {
        if let project { return project == workspaceProject }
        return workspaceProject == nil && pending && verifiedCurrentEvent
    }

    static func label(_ metric: String) -> String {
        if metric == teamScore { return "Team score" }
        let labels = ["rbi": "RBI", "pass-yard": "Passing yards", "rush-yard": "Rushing yards",
                      "one-point": "Free throws", "two-point": "Two-pointers", "three-point": "Three-pointers"]
        if let label = labels[metric] { return label }
        return metric.split(separator: "-").map { $0.capitalized }.joined(separator: " ")
    }

    static func sorted(_ games: [NativeSeasonStatGame]) -> [NativeSeasonStatGame] {
        games.sorted {
            if let lhs = $0.parsedDate, let rhs = $1.parsedDate, lhs != rhs { return lhs < rhs }
            if ($0.parsedDate != nil) != ($1.parsedDate != nil) { return $0.parsedDate == nil }
            return $0.id < $1.id
        }
    }

    static func metrics(_ games: [NativeSeasonStatGame], scope: NativeSeasonStatScope) -> [String] {
        let keys = Set(games.flatMap { Array((scope == .athlete ? $0.athleteStats : $0.stats).keys) }).sorted()
        return scope == .team && games.contains(where: \.scoreRecorded) ? [teamScore] + keys : keys
    }

    static func eligible(_ games: [NativeSeasonStatGame], metric: String, scope: NativeSeasonStatScope) -> [NativeSeasonStatGame] {
        sorted(games.filter {
            metric == teamScore ? (scope == .team && $0.scoreRecorded)
                : scope == .team || !$0.athleteStats.isEmpty
        })
    }

    static func value(_ game: NativeSeasonStatGame, metric: String, scope: NativeSeasonStatScope) -> Int {
        if metric == teamScore { return scope == .team && game.scoreRecorded ? game.score : 0 }
        return (scope == .athlete ? game.athleteStats : game.stats)[metric] ?? 0
    }

    static func average(_ games: [NativeSeasonStatGame], metric: String, scope: NativeSeasonStatScope) -> Double? {
        guard !games.isEmpty else { return nil }
        return Double(games.reduce(0) { $0 + value($1, metric: metric, scope: scope) }) / Double(games.count)
    }
}
