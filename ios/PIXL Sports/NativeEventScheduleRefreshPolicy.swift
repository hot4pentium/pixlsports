import Foundation

enum NativeEventScheduleChangeReason: String, CaseIterable {
    case gameStarted
    case gameFinished
    case liveTapsStarted
    case eventCardEdited

    static let userInfoKey = "reason"

    var refreshesEventDetail: Bool { self != .eventCardEdited }
    var refreshesDashboard: Bool { true }

    static func forToolCommandKind(_ kind: String) -> Self? {
        switch kind {
        case "start": return .gameStarted
        case "finish": return .gameFinished
        default: return nil
        }
    }
}
