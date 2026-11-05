import Foundation

/// Footage and intro have independent allowances. No time scaling or frame rounding.
struct NativeMomentPlan {
    static let introSeconds = 2.0
    static let maximumFootage = 15.0
    static let introRange = 1.0...3.0
    let start: Double
    let footage: Double
    let intro: Double
    var total: Double { intro + footage }

    init(sourceDuration: Double, start: Double, footage: Double, intro: Double = NativeMomentPlan.introSeconds) throws {
        guard sourceDuration.isFinite, start.isFinite, footage.isFinite,
              sourceDuration > 0, start >= 0, start < sourceDuration, footage > 0,
              footage <= Self.maximumFootage, intro.isFinite, Self.introRange.contains(intro),
              start + footage <= sourceDuration + 0.001 else {
            throw NativeMomentError.message("Select a valid segment of up to 15 seconds.")
        }
        self.start = start
        self.footage = min(footage, sourceDuration - start)
        self.intro = intro
    }
}

enum NativeMomentError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let text): return text }
    }
}

enum NativeMomentShoutout: String, CaseIterable, Identifiable {
    case clutch, domination, gamechanger, highlight, hustle
    case lockedin, milestone, nextlevel, unstoppable, victory
    var id: String { rawValue }
    var asset: String { "Moment-\(rawValue)" }
    var title: String {
        switch self {
        case .clutch: return "Clutch"
        case .domination: return "Domination"
        case .gamechanger: return "Game Changer"
        case .highlight: return "Highlight"
        case .hustle: return "Hustle"
        case .lockedin: return "Locked In"
        case .milestone: return "Milestone"
        case .nextlevel: return "Next Level"
        case .unstoppable: return "Unstoppable"
        case .victory: return "Victory"
        }
    }
}
