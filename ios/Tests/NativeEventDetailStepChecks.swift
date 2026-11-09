import Foundation

@main
struct NativeEventDetailStepChecks {
    static func main() {
        let start = Date(timeIntervalSince1970: 2_000_000_000)
        let cases: [(TimeInterval, NativeEventDetailStep)] = [
            (-7 * 24 * 3600, .prep),
            (-3601, .prep),
            (-3600, .prep),
            (-601, .prep),
            (-600, .trackStats),
            (-599, .trackStats),
            (0, .trackStats),
            (3599, .trackStats),
            (3600, .share),
            (7199, .share),
            (7200, .share),
            (7 * 24 * 3600, .share),
        ]
        for (offset, expected) in cases {
            let actual = NativeEventDetailStep.recommended(
                start: start, isGame: true, now: start.addingTimeInterval(offset)
            )
            precondition(actual == expected, "Incorrect game recommendation at \(offset)")
        }
        for offset: TimeInterval in [0, 3600, 7199] {
            precondition(NativeEventDetailStep.recommended(
                start: start,
                isGame: true,
                isLive: true,
                now: start.addingTimeInterval(offset)
            ) == .trackStats, "An active live game stays on Track Stats at \(offset).")
        }
        precondition(NativeEventDetailStep.recommended(
            start: start, isGame: true, isLive: true, now: start.addingTimeInterval(-1)
        ) == .trackStats, "A future event inside the ten-minute window can open game-day tools.")
        precondition(NativeEventDetailStep.recommended(
            start: start, isGame: true, isLive: true, now: start.addingTimeInterval(7200)
        ) == .share, "An event outside the active window returns to Share.")
        precondition(NativeEventDetailStep.recommended(start: nil, isGame: true) == .prep)
        precondition(NativeEventDetailStep.recommended(start: start, isGame: false, now: start) == .prep)
        precondition(NativeEventDetailStep.recommended(
            start: start, isGame: false, now: start.addingTimeInterval(7200)
        ) == .share)

        let losAngeles = TimeZone(identifier: "America/Los_Angeles")!
        let timedStart = ISO8601DateFormatter().date(from: "2026-11-14T02:30:00Z")!
        let eventDate = "2026-11-13"
        let guideCases: [(TimeInterval, NativeEventDetailStep?)] = [
            (-3601, .prep),
            (-3600, .prep),
            (-601, .prep),
            (-600, .trackStats),
            (-599, .trackStats),
            (0, .trackStats),
            (3599, .trackStats),
            (3600, .share),
            (7199, .share),
            (7200, nil),
        ]
        for (offset, expected) in guideCases {
            let actual = NativeEventGuideTiming.gameRecommendation(
                eventDate: eventDate,
                start: timedStart,
                timeZone: losAngeles,
                now: timedStart.addingTimeInterval(offset)
            )
            precondition(actual == expected, "Incorrect Message Board recommendation at \(offset)")
        }
        let oneMinuteBefore = timedStart.addingTimeInterval(-60)
        precondition(NativeEventGuideTiming.gameRecommendation(
            eventDate: eventDate,
            start: timedStart,
            timeZone: losAngeles,
            now: oneMinuteBefore
        ) == .trackStats, "The ten-minute window also applies near the UTC date boundary.")
        precondition(NativeEventGuideTiming.gameRecommendation(
            eventDate: "2026-11-14",
            start: nil,
            timeZone: losAngeles,
            now: oneMinuteBefore
        ) == .prep, "A future event without a valid start remains on Prep.")
        for status in ["final", "complete", "completed", " FINAL "] {
            precondition(NativeEventDetailStep.gameIsComplete(eventStatus: status))
            precondition(NativeEventDetailStep.gameIsComplete(workspaceStatus: status))
            precondition(NativeEventDetailStep.gameIsComplete(gameStatus: status))
        }
        for status in [nil, "live", "paused", "scheduled", "upcoming"] as [String?] {
            precondition(!NativeEventDetailStep.gameIsComplete(eventStatus: status))
        }
        precondition(NativeEventDetailStep.gameIsComplete(pendingFinal: true),
                     "An offline finish is complete before the server acknowledges it.")
        for kickoff: Date? in [nil, start, start.addingTimeInterval(7 * 24 * 3600)] {
            precondition(NativeEventDetailStep.recommended(
                start: kickoff, isGame: true, isLive: true, isComplete: true, now: start
            ) == .share, "Finalization overrides timing, missing dates, and stale live flags.")
        }
        precondition(NativeEventDetailStep.trackStats.permittedSelection(isGame: true, isComplete: true) == .trackStats)
        precondition(NativeEventDetailStep.trackStats.permittedSelection(isGame: false, isComplete: false) == .share)
        precondition(NativeEventDetailStep.prep.permittedSelection(isGame: true, isComplete: true) == .prep)
        precondition(NativeEventDetailStep.share.permittedSelection(isGame: true, isComplete: true) == .share)
        // Even when timing recommends Share, an unfinalized game stays trackable.
        precondition(NativeEventDetailStep.trackStats.permittedSelection(isGame: true, isComplete: false) == .trackStats)
        for offset: TimeInterval in [-1800, -601, -600.001] {
            let access = NativeEventTrackingAccess.resolve(
                start: start, isGame: true, isComplete: false, now: start.addingTimeInterval(offset))
            precondition(!access.isAllowed)
            precondition(NativeEventDetailStep.trackStats.permittedSelection(
                isGame: true, isComplete: false, trackingAvailable: access.isAllowed) == .trackStats)
        }
        for offset: TimeInterval in [-600, -599, 0, 7200] {
            precondition(NativeEventTrackingAccess.resolve(
                start: start, isGame: true, isComplete: false, now: start.addingTimeInterval(offset)).isAllowed)
        }
        precondition(NativeEventTrackingAccess.resolve(start: nil, isGame: true, isComplete: false) == .missingStart)
        precondition(NativeEventTrackingAccess.resolve(start: nil, isGame: true, isComplete: true) == .complete)
        precondition(NativeEventTrackingAccess.resolve(start: start, isGame: false, isComplete: false) == .notGame)
        // Absolute instants keep the opening boundary stable across the repeated
        // fall-back hour, spring-forward gap, and a date boundary in Los Angeles.
        for instant in ["2026-11-01T05:05:00Z", "2026-11-01T06:05:00Z",
                        "2026-03-08T07:05:00Z", "2026-11-14T07:05:00Z"] {
            let kickoff = ISO8601DateFormatter().date(from: instant)!
            precondition(!NativeEventTrackingAccess.resolve(start: kickoff, isGame: true, isComplete: false,
                now: kickoff.addingTimeInterval(-601)).isAllowed)
            precondition(NativeEventTrackingAccess.resolve(start: kickoff, isGame: true, isComplete: false,
                now: kickoff.addingTimeInterval(-600)).isAllowed)
        }
        let closed = NativeEventTrackingAccess.tooEarly(start.addingTimeInterval(-600))
        precondition(closed.message(timeZone: losAngeles).contains("10 minutes"))
        precondition(closed.message(timeZone: losAngeles).contains(
            losAngeles.abbreviation(for: start.addingTimeInterval(-600))!))
        precondition(NativeEventTrackingAccess.missingStart.message().contains("Record Moments"))
        precondition(NativeEventTrackingAccess.complete.message().contains("Record Moments"))
        print("Native Event Card completion and Message Board timing checks passed.")
    }
}
