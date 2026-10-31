import Foundation

/// Schedule-derived home Message Board timing for game cards.
enum NativeEventGuideTiming {
    static func gameRecommendation(
        eventDate: String,
        start: Date?,
        timeZone: TimeZone,
        now: Date = Date()
    ) -> NativeEventDetailStep? {
        guard let start else {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = timeZone
            formatter.dateFormat = "yyyy-MM-dd"
            return eventDate >= formatter.string(from: now) ? .prep : nil
        }

        // Event status can lag behind the schedule. Keep the card in its
        // scheduled phase and hand off at two hours rather than showing a
        // stale Live/Final card all day.
        guard now.timeIntervalSince(start) < 2 * 60 * 60 else { return nil }
        return NativeEventDetailStep.recommended(start: start, isGame: true, now: now)
    }
}
