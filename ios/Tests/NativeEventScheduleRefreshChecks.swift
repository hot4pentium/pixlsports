import Foundation

@main
struct NativeEventScheduleRefreshChecks {
    static func main() {
        for kind in ["stat", "prep", "prep-checkoff", "reload"] {
            precondition(
                NativeEventScheduleChangeReason.forToolCommandKind(kind) == nil,
                "\(kind) must not trigger a schedule refresh."
            )
        }

        precondition(
            NativeEventScheduleChangeReason.forToolCommandKind("start") == .gameStarted,
            "Starting a game must announce a schedule change."
        )
        precondition(
            NativeEventScheduleChangeReason.forToolCommandKind("finish") == .gameFinished,
            "Finishing a game must announce a schedule change."
        )

        for reason in [
            NativeEventScheduleChangeReason.gameStarted,
            .gameFinished,
            .liveTapsStarted,
            .liveTapsEnded
        ] {
            precondition(reason.refreshesEventDetail, "\(reason) must refresh Event Details.")
            precondition(reason.refreshesDashboard, "\(reason) must refresh the dashboard.")
        }

        precondition(
            NativeEventScheduleChangeReason.eventCardEdited.refreshesDashboard,
            "Editing an Event Card must refresh the dashboard."
        )
        precondition(
            !NativeEventScheduleChangeReason.eventCardEdited.refreshesEventDetail,
            "The editor refreshes its own Event Card; the notification must not duplicate it."
        )

        print("Native Event Card schedule-refresh policy checks passed.")
    }
}
