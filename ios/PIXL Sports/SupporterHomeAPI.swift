import Foundation
import ClerkKit

struct NativeSupporterSchedule: Decodable {
    let status: String
    let athleteName: String?
    let teamName: String?
    let seasonName: String?
    let timezone: String?
    let events: [AthleteFanEvent]
}

struct AthleteFanEvent: Decodable, Identifiable {
    let shareToken: String
    let eventId: String
    let title: String
    let date: String
    let time: String
    let type: String
    let status: String
    let opponent: String
    let location: String
    let timezone: String?

    var id: String { shareToken }
}

enum SupporterHomeAPI {
    static func fetchPrivateSchedule(clerk: Clerk) async throws -> NativeSupporterSchedule {
        let data = try await NativeAccountLinkClient().getData("supporter/schedule", clerk: clerk)
        do {
            let schedule = try JSONDecoder().decode(NativeSupporterSchedule.self, from: data)
            guard schedule.status == "linked" || schedule.status == "unlinked" else {
                throw SupporterHomeAPIError.invalidResponse
            }
            return schedule
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    static func fetchPrivateEvent(
        shareToken: String,
        clerk: Clerk
    ) async throws -> (schedule: NativeSupporterSchedule, event: AthleteFanEvent) {
        let schedule = try await fetchPrivateSchedule(clerk: clerk)
        guard schedule.status == "linked" else {
            throw SupporterHomeAPIError.privateScheduleUnavailable
        }
        guard let event = schedule.events.first(where: { $0.shareToken == shareToken }) else {
            throw SupporterHomeAPIError.eventUnavailable
        }
        return (schedule, event)
    }
}

enum SupporterHomeAPIError: LocalizedError {
    case invalidResponse
    case privateScheduleUnavailable
    case eventUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The PIXL Sports schedule returned information we couldn’t read. Please try again."
        case .privateScheduleUnavailable:
            return "Reconnect the PIXL account that owns this Event Card to view its details."
        case .eventUnavailable:
            return "This Event Card is no longer available in your verified PIXL schedule."
        }
    }
}

extension AthleteFanEvent {
    func formattedDate(timezone: String?) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timezone ?? "") ?? .current
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: self.date) else { return self.date }
        formatter.dateFormat = "EEEE, MMMM d"
        return formatter.string(from: date)
    }

    func formattedFullDate(timezone: String?) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timezone ?? "") ?? .current
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: self.date) else { return self.date }
        formatter.dateFormat = "EEEE, MMMM d, yyyy"
        return formatter.string(from: date)
    }

    func formattedTime(timezone: String?) -> String {
        guard let start = parsedStart(timezone: timezone) else {
            return time.isEmpty ? "Time to be announced" : time
        }
        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.timeZone = TimeZone(identifier: timezone ?? "") ?? .current
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: start)
    }

    func parsedStart(timezone: String?) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timezone ?? "") ?? .current
        formatter.isLenient = false

        for pattern in ["yyyy-MM-dd HH:mm", "yyyy-MM-dd H:mm", "yyyy-MM-dd h:mm a"] {
            formatter.dateFormat = pattern
            if let date = formatter.date(from: "\(self.date) \(time)") {
                return date
            }
        }
        return nil
    }
}
