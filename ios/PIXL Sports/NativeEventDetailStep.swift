import Foundation

/// Guidance for the event the user opened, not dashboard event selection.
enum NativeEventDetailStep: String, CaseIterable {
    case prep
    case trackStats
    case share

    var title: String {
        switch self {
        case .prep: return "Prep"
        case .trackStats: return "Track Stats"
        case .share: return "Share"
        }
    }

    var icon: String {
        switch self {
        case .prep: return "checklist"
        case .trackStats: return "chart.bar.fill"
        case .share: return "square.and.arrow.up"
        }
    }

    static func recommended(
        start: Date?,
        isGame: Bool,
        isLive: Bool = false,
        isComplete: Bool = false,
        now: Date = Date()
    ) -> Self {
        if isGame && isComplete { return .share }
        guard let start else { return .prep }
        let elapsed = now.timeIntervalSince(start)
        if !isGame {
            return elapsed < 2 * 60 * 60 ? .prep : .share
        }
        if isLive, elapsed >= 0, elapsed < 2 * 60 * 60 {
            return .trackStats
        }
        if elapsed < -10 * 60 { return .prep }
        if elapsed < 60 * 60 { return .trackStats }
        // Historical details remain shareable. The dashboard independently
        // advances to the next event after its two-hour active window.
        return .share
    }

    /// Explicit finalization only; elapsed kickoff time is not completion.
    static func gameIsComplete(
        eventStatus: String? = nil,
        workspaceStatus: String? = nil,
        gameStatus: String? = nil,
        pendingFinal: Bool = false
    ) -> Bool {
        pendingFinal || [eventStatus, workspaceStatus, gameStatus].contains { status in
            guard let status else { return false }
            return ["final", "complete", "completed"].contains(
                status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            )
        }
    }

    func permittedSelection(isGame: Bool, isComplete: Bool, trackingAvailable: Bool = true) -> Self {
        guard self == .trackStats else { return self }
        // This destination also contains Record Moments. Timing and completion
        // restrict individual tracking tools, not navigation to the chooser.
        return isGame ? self : .share
    }
}

enum NativeEventTrackingAccess: Equatable {
    case available
    case tooEarly(Date)
    case missingStart
    case complete
    case notGame

    static func resolve(start: Date?, isGame: Bool, isComplete: Bool,
                        now: Date = Date()) -> Self {
        guard isGame else { return .notGame }
        guard !isComplete else { return .complete }
        guard let start else { return .missingStart }
        let opensAt = start.addingTimeInterval(-10 * 60)
        return now >= opensAt ? .available : .tooEarly(opensAt)
    }

    var isAllowed: Bool { self == .available }

    func message(timeZone: TimeZone = .current) -> String {
        switch self {
        case .available: return "Stats and Live Taps are available now. Record Moments is always available."
        case .complete: return "This game is complete. New tracking is closed; Record Moments is still available."
        case .notGame: return "Game-day tracking is available for games, not practices."
        case .missingStart: return "Add a valid game start time for Stats and Live Taps. Record Moments is available now."
        case let .tooEarly(date):
            let formatter = DateFormatter()
            formatter.timeZone = timeZone
            formatter.dateStyle = .medium
            formatter.timeStyle = .short
            let zone = timeZone.abbreviation(for: date) ?? timeZone.identifier
            return "Stats and Live Taps open 10 minutes before game time · \(formatter.string(from: date)) \(zone)."
        }
    }
}
