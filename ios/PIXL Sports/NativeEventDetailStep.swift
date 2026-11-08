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
        if elapsed < -60 * 60 { return .prep }
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

    func permittedSelection(isGame: Bool, isComplete: Bool) -> Self {
        self == .trackStats && (!isGame || isComplete) ? .share : self
    }
}
