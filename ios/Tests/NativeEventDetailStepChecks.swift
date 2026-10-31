import Foundation

@main
struct NativeEventDetailStepChecks {
    static func main() {
        let start = Date(timeIntervalSince1970: 2_000_000_000)
        let cases: [(TimeInterval, NativeEventDetailStep)] = [
            (-7 * 24 * 3600, .prep),
            (-3601, .prep),
            (-3600, .trackStats),
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
            (-3600, .trackStats),
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
        ) == .prep, "A future event remains on Prep even near the UTC date boundary.")
        precondition(NativeEventGuideTiming.gameRecommendation(
            eventDate: "2026-11-14",
            start: nil,
            timeZone: losAngeles,
            now: oneMinuteBefore
        ) == .prep, "A future event without a valid start remains on Prep.")
        print("Native event detail step boundary checks passed.")
    }
}
