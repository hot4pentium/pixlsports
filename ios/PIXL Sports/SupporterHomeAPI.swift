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

struct NativeHypeCardReference: Decodable {
    let status: String
    let inviteToken: String?
}

struct NativePublicHypeCard: Decodable {
    let athleteName: String
    let teamName: String
    let seasonName: String
    let sport: String
    let photoUrl: String?
    let cutoutUrl: String?
    let favoriteMoment: String?
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
    let liveTapsActive: Bool
    let liveTapsInviteToken: String?
    let liveTapsSport: String?

    var id: String { shareToken }
}

struct LiveTapCheer: Decodable, Identifiable {
    let key: String
    let label: String
    let emoji: String
    let count: Int

    var id: String { key }
}

struct LiveTapSummary: Decodable {
    let active: Bool
    let gameId: String?
    let cheers: [LiveTapCheer]
}

private struct SupporterFanCardResponse: Decodable {
    let sport: String
    let liveTaps: LiveTapSummary
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

    static func fetchPublicHypeCard(clerk: Clerk) async throws -> NativePublicHypeCard? {
        let client = NativeAccountLinkClient()
        let data = try await client.getData("supporter/hype-card", clerk: clerk)
        let reference: NativeHypeCardReference
        do {
            reference = try JSONDecoder().decode(NativeHypeCardReference.self, from: data)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
        guard reference.status == "available" else { return nil }
        guard let inviteToken = reference.inviteToken,
              inviteToken.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
            throw SupporterHomeAPIError.invalidResponse
        }

        let publicData = try await client.publicRequest("athlete-invites/\(inviteToken)/fan")
        do {
            return try JSONDecoder().decode(NativePublicHypeCard.self, from: publicData)
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

    static func fetchLiveTapSummary(inviteToken: String) async throws -> (sport: String, summary: LiveTapSummary) {
        let data = try await NativeAccountLinkClient().publicRequest(
            "athlete-invites/\(inviteToken)/fan"
        )
        do {
            let card = try JSONDecoder().decode(SupporterFanCardResponse.self, from: data)
            return (card.sport, card.liveTaps)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    static func sendLiveTap(
        inviteToken: String,
        accessToken: String,
        cheerKey: String
    ) async throws -> LiveTapSummary {
        let data = try await NativeAccountLinkClient().publicRequest(
            "athlete-invites/\(inviteToken)/live-taps",
            method: "POST",
            body: ["accessToken": accessToken, "cheerKey": cheerKey]
        )
        do {
            return try JSONDecoder().decode(LiveTapSummary.self, from: data)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }
}

enum SupporterHomeAPIError: LocalizedError {
    case invalidResponse
    case privateScheduleUnavailable
    case eventUnavailable

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The PIXL Sports response returned information we couldn’t read. Please try again."
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
