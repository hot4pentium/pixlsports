import Foundation
import ClerkKit

struct NativeSupporterProfile: Codable, Equatable {
    let athleteName: String
    let teamName: String
    let jerseyNumber: String
    let position: String

    var displayDetails: String {
        [
            jerseyNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : "#\(jerseyNumber.trimmingCharacters(in: .whitespacesAndNewlines))",
            position.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : position.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        .compactMap { $0 }
        .joined(separator: " · ")
    }
}

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
    let privatePreview: NativePrivateHypeCard?
    let settings: NativeHypeCardSettings?
}

struct NativeHypeCardSettings: Decodable, Equatable {
    let showHypeCard: Bool
    let showStats: Bool
    let showEvents: Bool
    let paused: Bool
    let favoriteMoment: String?
}

struct NativeHypeCardSettingsUpdate: Encodable {
    let showHypeCard: Bool
    let showStats: Bool
    let showEvents: Bool
    let paused: Bool
    let favoriteMoment: String?
    let confirmPublish: Bool

    private enum CodingKeys: String, CodingKey {
        case showHypeCard, showStats, showEvents, paused, favoriteMoment, confirmPublish
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(showHypeCard, forKey: .showHypeCard)
        try container.encode(showStats, forKey: .showStats)
        try container.encode(showEvents, forKey: .showEvents)
        try container.encode(paused, forKey: .paused)
        try container.encode(favoriteMoment, forKey: .favoriteMoment)
        try container.encode(confirmPublish, forKey: .confirmPublish)
    }
}

struct NativePrivateHypeCard: Decodable {
    let athleteName: String
    let teamName: String
    let seasonName: String
    let favoriteMoment: String?
    let hasPhoto: Bool
}

struct NativeSupporterHypeCardPreview {
    let publicCard: NativePublicHypeCard?
    let privateCard: NativePrivateHypeCard?
    let privatePhoto: Data?
    let settings: NativeHypeCardSettings?
}

struct NativePublicHypeCard: Decodable {
    let athleteName: String
    let teamName: String
    let seasonName: String
    let sport: String
    let photoUrl: String?
    let cutoutUrl: String?
    let favoriteMoment: String?
    let showEvents: Bool
    let hypeCard: NativeHypeMedia?
    let videos: [NativeHypeVideo]
    let stats: NativeHypeStats?
    let events: [NativeHypeEvent]
    var shareURL: URL? = nil
    var inviteToken: String? = nil
}

struct NativeHypeMedia: Decodable {
    let shareToken: String
    let title: String
    let mediaName: String
    let mediaType: String
    let posterUrl: String?
    let createdAt: String
}

struct NativeHypeVideo: Decodable, Identifiable {
    let shareToken: String
    let title: String
    let mediaName: String
    let jerseyNumber: String
    let position: String
    let videoUrl: String
    let posterUrl: String?
    let createdAt: String

    var id: String { shareToken }
}

struct NativeHypeStats: Decodable {
    struct Record: Decodable {
        let wins: Int
        let losses: Int
        let ties: Int
        let gamesPlayed: Int
    }

    struct Game: Decodable, Identifiable {
        let date: String
        let opponent: String
        let score: Int
        let opponentScore: Int
        let scoreRecorded: Bool
        let stats: [String: Int]
        let athleteStats: [String: Int]

        var id: String { "\(date)-\(opponent)" }
    }

    let athleteName: String
    let sport: String
    let gamesPlayed: Int
    let score: Int
    let record: Record
    let games: [Game]
    let stats: [String: Int]
    let updatedAt: String
}

struct NativeHypeEvent: Decodable, Identifiable {
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
    let liveTapsOnly: Bool
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

struct NativeEventCardDraft {
    let id: String
    let type: String
    let date: String
    let time: String
    let timezone: String
    let location: String
    let opponent: String
}

private struct NativeEventCardCreateBody: Encodable {
    let title: String
    let teamSeason: String
    let purpose: String
    let events: [Event]

    struct Event: Encodable {
        let id: String
        let type: String
        let status: String
        let date: String
        let time: String
        let timezone: String
        let location: String
        let opponent: String
        let snacks: String
        let drinks: String
        let notes: String
    }
}

private struct NativeEventCardCreateResponse: Decodable {
    let shareToken: String
    let eventId: String
}

private struct NativeEventCardEditBody: Encodable {
    let eventId: String
    let type: String
    let date: String
    let time: String
    let timezone: String
    let location: String
    let opponent: String
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

    static func fetchAthleteProfile(clerk: Clerk) async throws -> NativeSupporterProfile {
        let data = try await NativeAccountLinkClient().getData("supporter/profile", clerk: clerk)
        do {
            return try JSONDecoder().decode(NativeSupporterProfile.self, from: data)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    static func saveAthleteProfile(
        _ profile: NativeSupporterProfile,
        clerk: Clerk
    ) async throws -> NativeSupporterProfile {
        let data = try await NativeAccountLinkClient().postData(
            "supporter/profile",
            body: profile,
            method: "PATCH",
            clerk: clerk
        )
        do {
            return try JSONDecoder().decode(NativeSupporterProfile.self, from: data)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    static func createEventCard(
        draft: NativeEventCardDraft,
        teamName: String?,
        clerk: Clerk
    ) async throws -> String {
        let event = NativeEventCardCreateBody.Event(
            id: draft.id,
            type: draft.type,
            status: "upcoming",
            date: draft.date,
            time: draft.time,
            timezone: draft.timezone,
            location: draft.location,
            opponent: draft.opponent,
            snacks: "",
            drinks: "",
            notes: ""
        )
        let body = NativeEventCardCreateBody(
            title: {
                let trimmed = teamName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return trimmed.isEmpty ? "PIXL Sports" : trimmed
            }(),
            teamSeason: "",
            purpose: "game-on-card",
            events: [event]
        )
        let data = try await NativeAccountLinkClient().postData(
            "supporter/event-cards",
            body: body,
            clerk: clerk
        )
        do {
            let response = try JSONDecoder().decode(NativeEventCardCreateResponse.self, from: data)
            guard response.eventId == draft.id else { throw SupporterHomeAPIError.invalidResponse }
            return response.shareToken
        } catch let error as SupporterHomeAPIError {
            throw error
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    static func updateEventCard(
        shareToken: String,
        draft: NativeEventCardDraft,
        clerk: Clerk
    ) async throws -> String {
        let body = NativeEventCardEditBody(
            eventId: draft.id,
            type: draft.type,
            date: draft.date,
            time: draft.time,
            timezone: draft.timezone,
            location: draft.location,
            opponent: draft.opponent
        )
        let data = try await NativeAccountLinkClient().postData(
            "supporter/event-cards/\(shareToken)",
            body: body,
            method: "PATCH",
            clerk: clerk
        )
        do {
            let response = try JSONDecoder().decode(NativeEventCardCreateResponse.self, from: data)
            guard response.shareToken == shareToken, response.eventId == draft.id else {
                throw SupporterHomeAPIError.invalidResponse
            }
            return response.shareToken
        } catch let error as SupporterHomeAPIError {
            throw error
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    static func confirmEventCard(
        shareToken: String,
        draft: NativeEventCardDraft,
        clerk: Clerk
    ) async throws {
        let schedule = try await fetchPrivateSchedule(clerk: clerk)
        guard schedule.status == "linked",
              let event = schedule.events.first(where: {
                  $0.shareToken == shareToken && $0.eventId == draft.id
              }),
              event.type == draft.type,
              event.date == draft.date,
              event.time == draft.time,
              event.timezone == draft.timezone,
              event.location == draft.location,
              event.opponent == draft.opponent else {
            throw SupporterHomeAPIError.eventSaveNotConfirmed
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

        return try await fetchPublicHypeCard(inviteToken: inviteToken, client: client)
    }

    static func fetchOwnerHypeCardPreview(clerk: Clerk) async throws -> NativeSupporterHypeCardPreview {
        let client = NativeAccountLinkClient()
        let data = try await client.getData("supporter/hype-card", clerk: clerk)
        let reference: NativeHypeCardReference
        do {
            reference = try JSONDecoder().decode(NativeHypeCardReference.self, from: data)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }

        if reference.status == "available" {
            guard let inviteToken = reference.inviteToken,
                  let settings = reference.settings,
                  settings.showHypeCard,
                  !settings.paused,
                  inviteToken.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil else {
                throw SupporterHomeAPIError.invalidResponse
            }
            return NativeSupporterHypeCardPreview(
                publicCard: try await fetchPublicHypeCard(inviteToken: inviteToken, client: client),
                privateCard: nil,
                privatePhoto: nil,
                settings: settings
            )
        }
        if reference.status == "hidden" {
            guard let privateCard = reference.privatePreview,
                  let settings = reference.settings,
                  (!settings.showHypeCard || settings.paused) else {
                throw SupporterHomeAPIError.invalidResponse
            }
            let privatePhoto = privateCard.hasPhoto
                ? try await client.getData("supporter/hype-card/cutout-photo", clerk: clerk)
                : nil
            return NativeSupporterHypeCardPreview(
                publicCard: nil,
                privateCard: privateCard,
                privatePhoto: privatePhoto,
                settings: settings
            )
        }
        guard reference.status == "unlinked" || reference.status == "no-card" else {
            throw SupporterHomeAPIError.invalidResponse
        }
        return NativeSupporterHypeCardPreview(publicCard: nil, privateCard: nil, privatePhoto: nil, settings: nil)
    }

    static func updateNativeHypeCard(
        settings: NativeHypeCardSettingsUpdate,
        clerk: Clerk
    ) async throws -> NativeHypeCardSettings {
        let data = try await NativeAccountLinkClient().postData(
            "supporter/hype-card",
            body: settings,
            method: "PATCH",
            clerk: clerk
        )
        do {
            return try JSONDecoder().decode(NativeHypeCardSettings.self, from: data)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    private static func fetchPublicHypeCard(
        inviteToken: String,
        client: NativeAccountLinkClient
    ) async throws -> NativePublicHypeCard {
        let publicData = try await client.publicRequest("athlete-invites/\(inviteToken)/fan")
        do {
            var card = try JSONDecoder().decode(NativePublicHypeCard.self, from: publicData)
            card.inviteToken = inviteToken
            card.shareURL = try NativeAccountLinkClient.apiOrigin()
                .appendingPathComponent("fan").appendingPathComponent(inviteToken)
            return card
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
    case eventSaveNotConfirmed

    var errorDescription: String? {
        switch self {
        case .invalidResponse:
            return "The PIXL Sports response returned information we couldn’t read. Please try again."
        case .privateScheduleUnavailable:
            return "Reconnect the PIXL account that owns this Event Card to view its details."
        case .eventUnavailable:
            return "This Event Card is no longer available in your verified PIXL schedule."
        case .eventSaveNotConfirmed:
            return "The Event Card was saved, but the refreshed schedule didn’t confirm the change. Check your connection and try again."
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
