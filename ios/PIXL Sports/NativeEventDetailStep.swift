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

    var number: Int {
        switch self {
        case .prep: return 1
        case .trackStats: return 2
        case .share: return 3
        }
    }

    var icon: String {
        switch self {
        case .prep: return "checklist"
        case .trackStats: return "chart.bar.fill"
        case .share: return "square.and.arrow.up"
        }
    }

    static func recommended(start: Date?, isGame: Bool, now: Date = Date()) -> Self {
        guard let start else { return .prep }
        let elapsed = now.timeIntervalSince(start)
        if !isGame {
            return elapsed < 2 * 60 * 60 ? .prep : .share
        }
        if elapsed < -60 * 60 { return .prep }
        if elapsed < 60 * 60 { return .trackStats }
        // Historical details remain shareable. The dashboard independently
        // advances to the next event after its two-hour active window.
        return .share
    }
}
