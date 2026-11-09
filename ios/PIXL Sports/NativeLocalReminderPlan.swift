import Foundation

struct NativeLocalReminderPreferences: Codable {
    var oneHourBefore: Bool
    var dayOf: Bool
    var timezone: String?
}

/// Independent of event-day/one-hour consent and APNs handoff. A remembered
/// attempt at a past instant is consumed even if delivery was uncertain.
enum NativeToolAvailabilityReminderPlan {
    static let limit = 16

    struct Selection: Codable, Equatable {
        let eventID: String
        let shareToken: String
        var attemptedFire: Date?
        var consumed = false
    }

    static func opening(start: Date?, now: Date, leaseEnd: Date,
                        selection: Selection) -> Date? {
        guard !selection.consumed,
              selection.attemptedFire.map({ $0 > now }) ?? true,
              let start, start <= leaseEnd else { return nil }
        let fire = start.addingTimeInterval(-600)
        return fire > now && fire <= leaseEnd ? fire : nil
    }

    static func requestID(scope: String, token: String) -> String {
        "pixl.native.availability." + scope + "." + token
    }

    static func capacity(otherCategoryCount: Int) -> Int {
        max(0, limit - max(0, otherCategoryCount))
    }
}

/// Pure timing policy, shared by device scheduling and command-line checks.
enum NativeLocalReminderPlan {
    struct Event {
        let id: String
        let date: String
        let start: Date?
        let title: String
        let type: String
        var timezone: String? = nil
    }
    struct Reminder: Codable, Equatable {
        let id: String
        let fire: Date
        let expires: Date
        let title: String
        let body: String
    }

    static func reminders(events: [Event], preferences: NativeLocalReminderPreferences,
                          now: Date, notBefore: Date, leaseEnd: Date,
                          consumedIDs: Set<String> = []) -> [Reminder] {
        var result: [Reminder] = []
        for event in events {
            // Unknown starts cannot be bounded to the verified access window.
            guard let start = event.start, start > now, start <= leaseEnd else { continue }
            let label = event.type == "practice" ? "Practice" : "Game"
            let prefix = event.id + "|" + event.date + "|"
            if preferences.oneHourBefore {
                result.append(.init(id: prefix + "one_hour", fire: start.addingTimeInterval(-3600),
                                    expires: start, title: "\(label) · One hour before", body: event.title))
            }
            if preferences.dayOf,
               let morning = localInstant(date: event.date, time: "07:00",
                    timezone: preferences.timezone ?? event.timezone),
               morning < start {
                result.append(.init(id: prefix + "day_of", fire: morning, expires: start,
                                    title: "\(label) · Event day", body: event.title))
            }
        }
        // iOS permits only 64 pending local notifications per app. Leave room
        // for other app features and schedule earliest first, deterministically.
        var ids = Set<String>()
        return Array(result.filter {
            $0.fire > now && $0.fire > notBefore && $0.fire <= leaseEnd && !consumedIDs.contains($0.id)
        }
            .sorted { $0.fire == $1.fire ? $0.id < $1.id : $0.fire < $1.fire }
            .filter { ids.insert($0.id).inserted }.prefix(48))
    }

    /// Match the server: nonexistent DST times are skipped and repeated clock
    /// times use the first occurrence. The phone's current zone is never used.
    static func localInstant(date: String, time: String, timezone: String?) -> Date? {
        guard let timezone, let zone = TimeZone(identifier: timezone) else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.isLenient = false
        var wall: Date?
        for pattern in ["yyyy-MM-dd HH:mm", "yyyy-MM-dd H:mm", "yyyy-MM-dd h:mm a"] {
            formatter.dateFormat = pattern
            if let parsed = formatter.date(from: date + " " + time) { wall = parsed; break }
        }
        guard let wall else { return nil }
        let candidates = [-86400.0, 0, 86400.0].map {
            wall.addingTimeInterval(-Double(zone.secondsFromGMT(for: wall.addingTimeInterval($0))))
        }
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(secondsFromGMT: 0)!
        var local = utc
        local.timeZone = zone
        let fields: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute]
        let expected = utc.dateComponents(fields, from: wall)
        return candidates.sorted().first { local.dateComponents(fields, from: $0) == expected }
    }
}
