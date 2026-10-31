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
        print("Native event detail step boundary checks passed.")
    }
}
