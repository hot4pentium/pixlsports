import Foundation
import ClerkKit

struct NativeSupporterSchedule: Codable {
    let status: String
    let athleteName: String?
    let teamName: String?
    let seasonName: String?
    let timezone: String?
    let events: [AthleteFanEvent]
    var record: NativeSeasonRecord? = nil
    var linkId: String? = nil
}

struct NativeSeasonRecord: Codable {
    let wins: Int
    let losses: Int
    let ties: Int
    let gamesPlayed: Int
    let sport: String?
    let seasonName: String?
}

struct NativeSupporterFanBase: Decodable {
    let totalFollows: Int
    let namedFans: [String]
    let anonymousFollows: Int
}

struct NativeHypeCardReference: Decodable {
    let status: String
    let inviteToken: String?
    let correctionId: String?
    let privatePreview: NativePrivateHypeCard?
    let settings: NativeHypeCardSettings?
    var ownerLiveTaps: NativeOwnerLiveTapsContext? = nil
}

struct NativeOwnerLiveTapsContext: Decodable {
    let status: String
    let sport: String
    let inviteToken: String?
    var ownerOnly: Bool? = nil
}

struct NativeHypeCardSettings: Codable, Equatable {
    let revision: String?
    let showHypeCard: Bool
    let showStats: Bool
    let showEvents: Bool
    let paused: Bool
    let favoriteMoment: String?
    static func == (lhs: NativeHypeCardSettings, rhs: NativeHypeCardSettings) -> Bool {
        lhs.hasSameSettings(as: rhs)
    }

    func hasSameSettings(as other: NativeHypeCardSettings) -> Bool {
        showHypeCard == other.showHypeCard
            && showStats == other.showStats
            && showEvents == other.showEvents
            && paused == other.paused
            && favoriteMoment == other.favoriteMoment
    }
}

struct NativeHypeCardSettingsSaveIntent: Codable {
    let base: NativeHypeCardSettings
    let desired: NativeHypeCardSettings
    let confirmPublish: Bool
}

struct NativeHypeCardSettingsUpdate: Encodable {
    let showHypeCard: Bool
    let showStats: Bool
    let showEvents: Bool
    let paused: Bool
    let favoriteMoment: String?
    let expectedRevision: String
    let confirmPublish: Bool

    private enum CodingKeys: String, CodingKey {
        case showHypeCard, showStats, showEvents, paused, favoriteMoment, expectedRevision, confirmPublish
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(showHypeCard, forKey: .showHypeCard)
        try container.encode(showStats, forKey: .showStats)
        try container.encode(showEvents, forKey: .showEvents)
        try container.encode(paused, forKey: .paused)
        try container.encode(favoriteMoment, forKey: .favoriteMoment)
        try container.encode(expectedRevision, forKey: .expectedRevision)
        try container.encode(confirmPublish, forKey: .confirmPublish)
    }
}

private struct NativeHypeCardIdentityCorrectionBody: Encodable {
    let correctionId: String
    let confirm: Bool
}

struct NativeHypeCardIdentityCorrectionResult: Decodable {
    let athleteName: String
    let teamName: String
}

struct NativePrivateHypeCard: Codable {
    var athleteName: String
    var teamName: String
    let seasonName: String
    let favoriteMoment: String?
    let hasPhoto: Bool
    var liveTaps: LiveTapSummary? = nil
}

struct NativeSupporterHypeCardPreview: Codable {
    let publicCard: NativePublicHypeCard?
    let privateCard: NativePrivateHypeCard?
    let privatePhoto: Data?
    let settings: NativeHypeCardSettings?
    let identityMismatch: Bool
    let correctionId: String?

    /// Owner-only presentation follows the saved Settings profile, including
    /// queued edits. Never apply this to a public recipient or authored export.
    func followingProfile(_ profile: NativeSupporterProfile) -> Self {
        guard !profile.athleteName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return self
        }
        var publicPreview = publicCard
        var privatePreview = privateCard
        publicPreview?.athleteName = profile.athleteName
        privatePreview?.athleteName = profile.athleteName
        if !profile.teamName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            publicPreview?.teamName = profile.teamName
            privatePreview?.teamName = profile.teamName
        }
        return Self(publicCard: publicPreview, privateCard: privatePreview,
                    privatePhoto: privatePhoto, settings: settings,
                    identityMismatch: false, correctionId: nil)
    }
}

struct NativePublicHypeCard: Codable {
    var athleteName: String
    var teamName: String
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
    var liveTaps: LiveTapSummary? = nil
}

struct NativeHypeMedia: Codable {
    let shareToken: String
    let title: String
    let mediaName: String
    let mediaType: String
    let posterUrl: String?
    let createdAt: String
}

struct NativeHypeVideo: Codable, Identifiable {
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

struct NativeHypeStats: Codable {
    struct Record: Codable {
        let wins: Int
        let losses: Int
        let ties: Int
        let gamesPlayed: Int
    }

    struct Game: Codable, Identifiable {
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

/// Display a saved wall-clock time without converting it to the viewer's zone.
func nativeEventTimeDisplay(_ value: String) -> String {
    guard !value.isEmpty else { return value }
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.timeZone = TimeZone(secondsFromGMT: 0)
    formatter.isLenient = false
    for pattern in ["HH:mm", "H:mm", "h:mm a"] {
        formatter.dateFormat = pattern
        if let date = formatter.date(from: value.trimmingCharacters(in: .whitespacesAndNewlines)) {
            formatter.dateFormat = "h:mm a"
            return formatter.string(from: date)
        }
    }
    return value
}

struct NativeHypeEvent: Codable, Identifiable {
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

struct AthleteFanEvent: Codable, Identifiable {
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

private struct SupporterFanCardResponse: Decodable {
    let sport: String
    let liveTaps: LiveTapSummary
}

struct NativeEventCardDraft: Codable, Equatable {
    let id: String
    let type: String
    let date: String
    let time: String
    let timezone: String
    let location: String
    let opponent: String

    func matches(_ event: AthleteFanEvent) -> Bool {
        id == event.eventId
            && type == event.type
            && date == event.date
            && time == event.time
            && timezone == (event.timezone ?? "")
            && location == event.location
            && opponent == event.opponent
    }

    static func from(_ event: AthleteFanEvent) -> NativeEventCardDraft {
        NativeEventCardDraft(
            id: event.eventId,
            type: event.type,
            date: event.date,
            time: event.time,
            timezone: event.timezone ?? "",
            location: event.location,
            opponent: event.opponent
        )
    }
}

enum NativePendingEventCardOperation: String, Codable, Equatable {
    case create
    case update
    case delete
}

struct NativePendingEventCardChange: Codable, Identifiable, Equatable {
    var id: String { draft.id }
    var operation: NativePendingEventCardOperation
    var draft: NativeEventCardDraft
    var teamName: String?
    var athleteName: String
    var seasonName: String?
    var shareToken: String?
    var baseDraft: NativeEventCardDraft?
    var attemptedDraft: NativeEventCardDraft?
    var conflictDraft: NativeEventCardDraft?
    var conflictMessage: String?
    var lastError: String?
    var createdAt: Date

    var isConflicted: Bool { conflictMessage != nil }
}

#if DEBUG
@MainActor
enum NativeEventCardCreateRetryUITestFixture {
    static var isRequested: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-testing-event-card-create-retry")
    }

    private(set) static var isOnline = false
    private(set) static var savedDrafts: [String: NativeEventCardDraft] = [:]
    private(set) static var serverDrafts: [String: NativeEventCardDraft] = [:]
    private(set) static var confirmedEventIDs = Set<String>()
    private static var interruptedFirstResponse = false

    static func setOnline(_ online: Bool) {
        isOnline = online
    }

    static func saveLocally(_ draft: NativeEventCardDraft) {
        savedDrafts[draft.id] = draft
    }

    static func create(_ draft: NativeEventCardDraft) throws -> String {
        guard isOnline else { throw NativeOfflineError.onlineOnly }
        if let existing = serverDrafts[draft.id] {
            return shareToken(for: existing)
        }

        serverDrafts[draft.id] = draft
        if !interruptedFirstResponse {
            interruptedFirstResponse = true
            throw NativeAccountLinkError.message("The first save response was interrupted.")
        }
        return shareToken(for: draft)
    }

    static func confirm(token: String, draft: NativeEventCardDraft) throws {
        guard isOnline else { throw NativeOfflineError.onlineOnly }
        guard serverDrafts[draft.id] != nil, token == shareToken(for: draft) else {
            throw SupporterHomeAPIError.invalidResponse
        }
        confirmedEventIDs.insert(draft.id)
        savedDrafts.removeValue(forKey: draft.id)
    }

    private static func shareToken(for draft: NativeEventCardDraft) -> String {
        "ui-test-event-card-\(draft.id)"
    }
}

@MainActor
enum NativeEventCardConflictUITestFixture {
    static let isRequested = ProcessInfo.processInfo.arguments.contains("--ui-testing-event-card-conflict")
    static let shareToken = "ui-test-event-card-conflict"
    static let initialDraft = NativeEventCardDraft(
        id: "37400000-0000-4000-8000-000000000001",
        type: "game",
        date: "2099-04-01",
        time: "18:00",
        timezone: "America/Los_Angeles",
        location: "",
        opponent: "Tigers"
    )
    static var initialEvent: AthleteFanEvent {
        AthleteFanEvent(
            shareToken: shareToken,
            eventId: initialDraft.id,
            title: "PIXL Test Team",
            date: initialDraft.date,
            time: initialDraft.time,
            type: initialDraft.type,
            status: "upcoming",
            opponent: initialDraft.opponent,
            location: initialDraft.location,
            timezone: initialDraft.timezone,
            liveTapsActive: false,
            liveTapsOnly: false,
            liveTapsInviteToken: nil,
            liveTapsSport: nil
        )
    }

    private(set) static var isOnline = false
    private(set) static var serverCards: [String: NativeEventCardDraft] = [
        initialDraft.id: initialDraft
    ]
    private(set) static var queuedDraft: NativeEventCardDraft?
    private(set) static var isConflicted = false

    static var serverDraft: NativeEventCardDraft {
        serverCards[initialDraft.id] ?? initialDraft
    }
    static var serverCardCount: Int { serverCards.count }
    static var pendingCardCount: Int { queuedDraft == nil ? 0 : 1 }

    static var pendingChange: NativePendingEventCardChange? {
        guard let queuedDraft else { return nil }
        return NativePendingEventCardChange(
            operation: .update,
            draft: queuedDraft,
            teamName: "PIXL Test Team",
            athleteName: "Jordan Example",
            seasonName: "Fall 2026",
            shareToken: shareToken,
            baseDraft: initialDraft,
            attemptedDraft: nil,
            conflictDraft: isConflicted ? serverDraft : nil,
            conflictMessage: isConflicted
                ? "This Event Card changed on another device. Choose whether to keep your iPhone edits or use the server version."
                : nil,
            lastError: nil,
            createdAt: Date(timeIntervalSince1970: 0)
        )
    }

    static func saveOffline(_ draft: NativeEventCardDraft) {
        queuedDraft = draft
        isConflicted = false
    }

    static func editOnAnotherDevice() {
        serverCards[initialDraft.id] = NativeEventCardDraft(
            id: initialDraft.id,
            type: initialDraft.type,
            date: initialDraft.date,
            time: initialDraft.time,
            timezone: initialDraft.timezone,
            location: "Away Field",
            opponent: "Cougars"
        )
    }

    static func reconnect() {
        isOnline = true
    }

    static func retrySync() {
        guard isOnline, let queuedDraft else { return }
        if serverDraft == initialDraft {
            serverCards[queuedDraft.id] = queuedDraft
            self.queuedDraft = nil
        } else if serverDraft == queuedDraft {
            self.queuedDraft = nil
        } else {
            isConflicted = true
        }
    }

    static func keepLocalEdits() {
        guard isConflicted, let queuedDraft else { return }
        serverCards[queuedDraft.id] = queuedDraft
        self.queuedDraft = nil
        isConflicted = false
    }

    static func useServerVersion() {
        queuedDraft = nil
        isConflicted = false
    }
}
#endif

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
    let expected: Expected

    struct Expected: Encodable {
        let type: String
        let date: String
        let time: String
        let timezone: String
        let location: String
        let opponent: String
    }
}

private struct NativeEventCardDeletionReceipt: Decodable {
    let calendarEventDeleted: Bool
    let calendarEventStatus: String
}

private struct NativeAthleteProfileUpdate: Encodable {
    let athleteName: String
    let teamName: String
    let jerseyNumber: String
    let position: String
    let sport: String?
    let completeSetup: Bool
    var expectedProfile: NativeAthleteProfileVersion?
}

private struct NativeAthleteProfileVersion: Encodable {
    let athleteName: String
    let teamName: String
    let jerseyNumber: String
    let position: String
    let sport: String?

    init(_ profile: NativeSupporterProfile) {
        athleteName = profile.athleteName
        teamName = profile.teamName
        jerseyNumber = profile.jerseyNumber
        position = profile.position
        sport = profile.sport
    }
}

enum SupporterHomeAPI {
    private struct AccountPreparation: Decodable {
        let status: String
    }

    static func prepareAccount(clerk: Clerk) async throws -> Bool {
        let data = try await NativeAccountLinkClient().postData(
            "supporter/account", body: [String: String](), clerk: clerk
        )
        let result = try JSONDecoder().decode(AccountPreparation.self, from: data)
        guard result.status == "ready" || result.status == "link_required" else {
            throw SupporterHomeAPIError.invalidResponse
        }
        return result.status == "ready"
    }

    static func fetchPrivateSchedule(clerk: Clerk) async throws -> NativeSupporterSchedule {
        let data = try await NativeAccountLinkClient().getData("supporter/schedule", clerk: clerk)
        return try decodePrivateSchedule(data)
    }

    static func fetchAuthoritativePrivateSchedule(clerk: Clerk) async throws -> NativeSupporterSchedule {
        let data = try await NativeAccountLinkClient().getAuthoritativeData("supporter/schedule", clerk: clerk)
        return try decodePrivateSchedule(data)
    }

    private static func decodePrivateSchedule(_ data: Data) throws -> NativeSupporterSchedule {
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

    static func fetchOwnerFanBase(clerk: Clerk) async throws -> NativeSupporterFanBase {
        guard NativeOfflineRuntime.shared.online else {
            throw NativeOfflineError.onlineOnly
        }
        let data = try await NativeAccountLinkClient().getAuthoritativeData(
            "supporter/fan-base",
            clerk: clerk
        )
        do {
            let fanBase = try JSONDecoder().decode(NativeSupporterFanBase.self, from: data)
            guard fanBase.totalFollows >= 0,
                  fanBase.anonymousFollows >= 0,
                  fanBase.totalFollows == fanBase.anonymousFollows + fanBase.namedFans.count,
                  fanBase.namedFans.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
                throw SupporterHomeAPIError.invalidResponse
            }
            return fanBase
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    static func fetchAthleteProfile(clerk: Clerk) async throws -> NativeSupporterProfile {
        let subjectAtStart = clerk.user?.id
        let scopeAtStart = NativeOfflineRuntime.shared.vault.namespace
        let client = NativeAccountLinkClient()
        if let subject = clerk.user?.id,
           let pending = try client.pendingAthleteProfileChange(subject: subject) {
            return pending.desired
        }
        let data = try await NativeAccountLinkClient().getData("supporter/profile", clerk: clerk)
        guard clerk.user?.id == subjectAtStart,
              NativeOfflineRuntime.shared.vault.namespace == scopeAtStart else {
            throw NativeOfflineError.locked
        }
        if let subject = clerk.user?.id,
           let pending = try client.pendingAthleteProfileChange(subject: subject) {
            return pending.desired
        }
        do {
            return try JSONDecoder().decode(NativeSupporterProfile.self, from: data)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    @MainActor
    static func saveAthleteProfile(
        _ profile: NativeSupporterProfile,
        completeSetup: Bool = false,
        baseProfile: NativeSupporterProfile? = nil,
        clerk: Clerk
    ) async throws -> NativeSupporterProfile {
        let offline = NativeOfflineRuntime.shared
        let requestScope = offline.vault.namespace
        let requestSubject = clerk.user?.id
        if !completeSetup {
            guard let subject = requestSubject,
                  offline.vault.canContinue(subject: subject),
                  let requestScope else { throw NativeOfflineError.locked }
            let client = NativeAccountLinkClient()
            let cachedBase = try? offline.vault.read("get/supporter/profile", subject: subject)
                .flatMap { try? JSONDecoder().decode(NativeSupporterProfile.self, from: $0) }
            _ = try client.queueAthleteProfileChange(
                profile, base: baseProfile ?? cachedBase ?? profile, subject: subject
            )
            // Queue first so a dropped response or an offline transition never
            // loses the family's edits. The sync routine re-confirms the link
            // and checks the server's current profile before sending a PATCH.
            guard offline.online else { return profile }
            do {
                _ = try await syncQueuedAthleteProfile(clerk: clerk)
            } catch {
                // The encrypted queue remains authoritative and will be retried
                // only after a later authenticated, linked-schedule check.
            }
            guard requestScope == offline.vault.namespace,
                  requestSubject == clerk.user?.id else { throw NativeOfflineError.locked }
            if try client.pendingAthleteProfileChange(subject: subject) == nil,
               let data = try? offline.vault.read("get/supporter/profile", subject: subject),
               let saved = try? JSONDecoder().decode(NativeSupporterProfile.self, from: data) {
                return saved
            }
            return profile
        }
        let data = try await NativeAccountLinkClient().postData(
            "supporter/profile",
            body: NativeAthleteProfileUpdate(
                athleteName: profile.athleteName, teamName: profile.teamName,
                jerseyNumber: profile.jerseyNumber, position: profile.position,
                sport: profile.sport, completeSetup: completeSetup, expectedProfile: nil
            ),
            method: "PATCH",
            clerk: clerk
        )
        guard requestScope == offline.vault.namespace, requestSubject == clerk.user?.id else {
            throw NativeOfflineError.locked
        }
        do {
            let saved = try JSONDecoder().decode(NativeSupporterProfile.self, from: data)
            NativeOfflineRuntime.shared.cacheSavedAthleteProfile(data)
            return saved
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    @MainActor
    static func syncQueuedAthleteProfile(clerk: Clerk) async throws -> NativeSupporterProfile? {
        let offline = NativeOfflineRuntime.shared
        guard offline.online, clerk.isAuthFlowComplete,
              let subject = clerk.user?.id,
              offline.vault.canContinue(subject: subject),
              let scope = offline.vault.namespace else { return nil }
        let client = NativeAccountLinkClient()
        guard let pending = try client.pendingAthleteProfileChange(subject: subject) else { return nil }

        // A reachable network is not sufficient: require a fresh, authenticated
        // linked schedule before reading or mutating the private profile.
        let schedule = try await fetchAuthoritativePrivateSchedule(clerk: clerk)
        guard schedule.status == "linked",
              clerk.user?.id == subject,
              offline.vault.namespace == scope,
              offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }

        let remoteData = try await client.getAuthoritativeData("supporter/profile", clerk: clerk)
        let remote: NativeSupporterProfile
        do { remote = try JSONDecoder().decode(NativeSupporterProfile.self, from: remoteData) }
        catch { throw SupporterHomeAPIError.invalidResponse }
        guard clerk.user?.id == subject,
              offline.vault.namespace == scope,
              offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }

        guard var current = try client.pendingAthleteProfileChange(subject: subject) else { return remote }
        guard !current.isConflicted else { return current.desired }
        // Re-submit an already matching profile too: an earlier interrupted
        // rename may have left its live card stale. The owner PATCH reconciles
        // both identities without requiring the separate repair confirmation.
        let remoteMatchesDesired = remote.hasSameAthleteDetails(as: current.desired)
        guard remoteMatchesDesired || remote.hasSameAthleteDetails(as: current.base) else {
            current.conflictProfile = remote
            current.conflictMessage = "Your iPhone edits and the saved PIXL profile are different. Choose which version to keep."
            current.lastError = nil
            try client.updateAthleteProfileChange(current, subject: subject)
            offline.cacheSavedAthleteProfile(try JSONEncoder().encode(current.desired))
            return current.desired
        }

        let submitted = current.desired
        do {
            let response = try await client.postData(
                "supporter/profile",
                body: NativeAthleteProfileUpdate(
                    athleteName: submitted.athleteName,
                    teamName: submitted.teamName,
                    jerseyNumber: submitted.jerseyNumber,
                    position: submitted.position,
                    sport: submitted.sport,
                    completeSetup: false,
                    expectedProfile: NativeAthleteProfileVersion(remoteMatchesDesired ? remote : current.base)
                ),
                method: "PATCH",
                clerk: clerk
            )
            let saved: NativeSupporterProfile
            do { saved = try JSONDecoder().decode(NativeSupporterProfile.self, from: response) }
            catch { throw SupporterHomeAPIError.invalidResponse }
            guard clerk.user?.id == subject,
                  offline.vault.namespace == scope,
                  offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
            if let latest = try client.pendingAthleteProfileChange(subject: subject) {
                if latest.desired.hasSameAthleteDetails(as: submitted) {
                    try client.clearAthleteProfileChange(subject: subject)
                } else {
                    var rebased = latest
                    rebased.base = saved
                    rebased.conflictProfile = nil
                    rebased.conflictMessage = nil
                    rebased.lastError = nil
                    try client.updateAthleteProfileChange(rebased, subject: subject)
                }
            }
            offline.cacheSavedAthleteProfile(response)
            // A newer local edit, if any, remains the visible working copy.
            if let latest = try client.pendingAthleteProfileChange(subject: subject) {
                offline.cacheSavedAthleteProfile(try JSONEncoder().encode(latest.desired))
                return latest.desired
            }
            return saved
        } catch {
            if (error as? NativeAccountLinkError)?.statusCode == 409 {
                do {
                    let latestSchedule = try await fetchAuthoritativePrivateSchedule(clerk: clerk)
                    guard latestSchedule.status == "linked",
                          clerk.user?.id == subject,
                          offline.vault.namespace == scope,
                          offline.vault.canContinue(subject: subject) else {
                        throw NativeOfflineError.locked
                    }
                    let latestData = try await client.getAuthoritativeData("supporter/profile", clerk: clerk)
                    let latestRemote = try JSONDecoder().decode(NativeSupporterProfile.self, from: latestData)
                    guard var latest = try client.pendingAthleteProfileChange(subject: subject),
                          latest.desired.hasSameAthleteDetails(as: submitted),
                          !latestRemote.hasSameAthleteDetails(as: latest.base),
                          clerk.user?.id == subject,
                          offline.vault.namespace == scope,
                          offline.vault.canContinue(subject: subject) else { throw error }
                    latest.conflictProfile = latestRemote
                    latest.conflictMessage = "Your iPhone edits and the saved PIXL profile are different. Choose which version to keep."
                    latest.lastError = nil
                    try client.updateAthleteProfileChange(latest, subject: subject)
                    offline.cacheSavedAthleteProfile(try JSONEncoder().encode(latest.desired))
                    return latest.desired
                } catch {
                    // A revoked link or unavailable profile read is not a
                    // profile conflict. Keep the queued edit without showing
                    // data from an account that is no longer confirmed.
                }
            }
            if var latest = try? client.pendingAthleteProfileChange(subject: subject), latest != pending {
                latest.lastError = "PIXL could not confirm the latest profile change. It remains saved on this iPhone."
                try? client.updateAthleteProfileChange(latest, subject: subject)
            } else {
                current.lastError = "PIXL could not confirm the profile change. It remains saved on this iPhone."
                try? client.updateAthleteProfileChange(current, subject: subject)
            }
            if let latest = try? client.pendingAthleteProfileChange(subject: subject),
               clerk.user?.id == subject, offline.vault.namespace == scope {
                offline.cacheSavedAthleteProfile(try JSONEncoder().encode(latest.desired))
            }
            throw error
        }
    }

    @MainActor
    static func resolveQueuedAthleteProfileConflict(
        keepIPhoneVersion: Bool,
        clerk: Clerk
    ) async throws -> NativeSupporterProfile {
        let offline = NativeOfflineRuntime.shared
        guard let subject = clerk.user?.id,
              offline.vault.canContinue(subject: subject),
              let scope = offline.vault.namespace else { throw NativeOfflineError.locked }
        let client = NativeAccountLinkClient()
        guard var change = try client.pendingAthleteProfileChange(subject: subject),
              change.isConflicted,
              let remote = change.conflictProfile else { throw NativeOfflineError.corrupt }

        if !keepIPhoneVersion {
            let data = try JSONEncoder().encode(remote)
            try client.clearAthleteProfileChange(subject: subject)
            offline.cacheSavedAthleteProfile(data)
            guard clerk.user?.id == subject, offline.vault.namespace == scope else {
                throw NativeOfflineError.locked
            }
            return remote
        }

        change.base = remote
        change.conflictProfile = nil
        change.conflictMessage = nil
        change.lastError = nil
        try client.updateAthleteProfileChange(change, subject: subject)
        guard offline.online else { return change.desired }
        _ = try await syncQueuedAthleteProfile(clerk: clerk)
        guard clerk.user?.id == subject, offline.vault.namespace == scope,
              offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        if let remaining = try client.pendingAthleteProfileChange(subject: subject) {
            return remaining.desired
        }
        if let bytes = try offline.vault.read("get/supporter/profile", subject: subject) {
            return try JSONDecoder().decode(NativeSupporterProfile.self, from: bytes)
        }
        return change.desired
    }

    static func createEventCard(
        draft: NativeEventCardDraft,
        teamName: String?,
        athleteName: String,
        seasonName: String?,
        clerk: Clerk?,
        forceNetworkAttempt: Bool = false
    ) async throws -> String {
#if DEBUG
        if NativeEventCardCreateRetryUITestFixture.isRequested {
            return try NativeEventCardCreateRetryUITestFixture.create(draft)
        }
#endif
        guard let clerk else { throw SupporterHomeAPIError.invalidResponse }
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
                if !trimmed.isEmpty { return trimmed }
                let identity = [
                    athleteName.trimmingCharacters(in: .whitespacesAndNewlines),
                    seasonName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                ].filter { !$0.isEmpty }
                return identity.isEmpty ? "PIXL Sports" : identity.joined(separator: " · ")
            }(),
            teamSeason: "",
            purpose: "game-on-card",
            events: [event]
        )
        let data = try await NativeAccountLinkClient().postData(
            "supporter/event-cards",
            body: body,
            clerk: clerk,
            forceNetworkAttempt: forceNetworkAttempt
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
        expected: NativeEventCardDraft,
        clerk: Clerk,
        forceNetworkAttempt: Bool = false
    ) async throws -> String {
        let body = NativeEventCardEditBody(
            eventId: draft.id,
            type: draft.type,
            date: draft.date,
            time: draft.time,
            timezone: draft.timezone,
            location: draft.location,
            opponent: draft.opponent,
            expected: .init(
                type: expected.type,
                date: expected.date,
                time: expected.time,
                timezone: expected.timezone,
                location: expected.location,
                opponent: expected.opponent
            )
        )
        let data = try await NativeAccountLinkClient().postData(
            "supporter/event-cards/\(shareToken)",
            body: body,
            method: "PATCH",
            clerk: clerk,
            forceNetworkAttempt: forceNetworkAttempt
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

    static func deleteEventCard(shareToken: String, clerk: Clerk) async throws {
        let data = try await NativeAccountLinkClient().postData(
            "supporter/event-cards/\(shareToken)",
            body: [String: String](),
            method: "DELETE",
            clerk: clerk,
            forceNetworkAttempt: true
        )
        do {
            let receipt = try JSONDecoder().decode(NativeEventCardDeletionReceipt.self, from: data)
            guard ["deleted", "not-linked", "unverified", "not-found", "ambiguous"]
                    .contains(receipt.calendarEventStatus),
                  receipt.calendarEventDeleted == (receipt.calendarEventStatus == "deleted") else {
                throw SupporterHomeAPIError.invalidResponse
            }
        } catch let error as SupporterHomeAPIError {
            throw error
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    static func confirmEventCard(
        shareToken: String,
        draft: NativeEventCardDraft,
        clerk: Clerk?
    ) async throws {
#if DEBUG
        if NativeEventCardCreateRetryUITestFixture.isRequested {
            try NativeEventCardCreateRetryUITestFixture.confirm(token: shareToken, draft: draft)
            return
        }
#endif
        guard let clerk else { throw SupporterHomeAPIError.invalidResponse }
        let schedule = try await fetchAuthoritativePrivateSchedule(clerk: clerk)
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

    static func fetchOwnerLiveTapsContext(clerk: Clerk) async throws -> NativeOwnerLiveTapsContext {
        let data = try await NativeAccountLinkClient().getAuthoritativeData("supporter/hype-card", clerk: clerk)
        let reference = try JSONDecoder().decode(NativeHypeCardReference.self, from: data)
        guard let context = reference.ownerLiveTaps else {
            switch reference.status {
            case "unlinked":
                throw NativeAccountLinkError.message("Sign in again to reconnect your athlete.")
            case "mismatch":
                throw NativeAccountLinkError.message("The saved athlete doesn’t match this profile. Review the athlete details in Settings.")
            case "no-card":
                throw NativeAccountLinkError.message("Your athlete setup needs attention. Review the athlete details in Settings.")
            default:
                throw NativeAccountLinkError.message("We couldn’t check Live Taps access. Try again with a connection.")
            }
        }
        switch context.status {
        case "paused":
            throw NativeAccountLinkError.liveTapsPaused
        case "expired":
            throw NativeAccountLinkError.message("This HYPE Card’s access has expired.")
        case "ready":
            guard let token = context.inviteToken,
                  token.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil else {
                throw SupporterHomeAPIError.invalidResponse
            }
            return context
        default:
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

        return try await fetchPublicHypeCard(inviteToken: inviteToken, client: client)
    }

    static func fetchPublicHypeCard(inviteToken: String) async throws -> NativePublicHypeCard {
        guard inviteToken.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil else {
            throw SupporterHomeAPIError.invalidResponse
        }
        return try await fetchPublicHypeCard(
            inviteToken: inviteToken,
            client: NativeAccountLinkClient()
        )
    }

    static func fetchOwnerHypeCardPreview(clerk: Clerk) async throws -> NativeSupporterHypeCardPreview {
        let subjectAtStart = clerk.user?.id
        let scopeAtStart = NativeOfflineRuntime.shared.vault.namespace
        let preview = try await fetchStoredOwnerHypeCardPreview(clerk: clerk)
        let offline = NativeOfflineRuntime.shared
        guard clerk.user?.id == subjectAtStart, offline.vault.namespace == scopeAtStart else {
            throw NativeOfflineError.locked
        }
        guard let subject = clerk.user?.id,
              offline.vault.canContinue(subject: subject),
              let data = try? offline.vault.read("get/supporter/profile", subject: subject),
              let profile = try? JSONDecoder().decode(NativeSupporterProfile.self, from: data) else {
            return preview
        }
        return preview.followingProfile(profile)
    }

    private static func fetchStoredOwnerHypeCardPreview(clerk: Clerk) async throws -> NativeSupporterHypeCardPreview {
        let offline = NativeOfflineRuntime.shared
        if !offline.online || !clerk.isLoaded,
           let data = try offline.vault.read("dashboard-preview", subject: clerk.user?.id),
           let saved = try? JSONDecoder().decode(NativeSupporterHypeCardPreview.self, from: data) { return saved }
        do { return try await fetchOnlineOwnerHypeCardPreview(clerk: clerk) }
        catch {
            let status = (error as? NativeAccountLinkError)?.statusCode
            if error is URLError || (status.map { $0 >= 500 } ?? false),
               let data = try? offline.vault.read("dashboard-preview", subject: clerk.user?.id),
               let saved = try? JSONDecoder().decode(NativeSupporterHypeCardPreview.self, from: data) { return saved }
            throw error
        }
    }

    private static func fetchOnlineOwnerHypeCardPreview(clerk: Clerk) async throws -> NativeSupporterHypeCardPreview {
        let offline = NativeOfflineRuntime.shared
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
            let card = try await fetchPublicHypeCard(inviteToken: inviteToken, client: client)
            // The same owner-authenticated small photo endpoint also works for
            // published cards; never download video as part of offline warmup.
            let photo = card.photoUrl != nil || card.cutoutUrl != nil
                ? try? await client.getData("supporter/hype-card/cutout-photo", clerk: clerk) : nil
            return NativeSupporterHypeCardPreview(
                publicCard: card,
                privateCard: nil,
                privatePhoto: photo,
                settings: settings,
                identityMismatch: false,
                correctionId: nil
            )
        }
        if reference.status == "hidden" || reference.status == "mismatch" {
            guard let privateCard = reference.privatePreview,
                  let settings = reference.settings else {
                throw SupporterHomeAPIError.invalidResponse
            }
            if reference.status == "mismatch" {
                guard let correctionId = reference.correctionId,
                      UUID(uuidString: correctionId) != nil else {
                    throw SupporterHomeAPIError.invalidResponse
                }
            }
            guard reference.status == "mismatch" || !settings.showHypeCard || settings.paused else {
                throw SupporterHomeAPIError.invalidResponse
            }
            let privatePhoto = reference.status == "hidden" && privateCard.hasPhoto
                ? try await client.getData("supporter/hype-card/cutout-photo", clerk: clerk)
                : nil
            return NativeSupporterHypeCardPreview(
                publicCard: nil,
                privateCard: privateCard,
                privatePhoto: privatePhoto,
                settings: settings,
                identityMismatch: reference.status == "mismatch",
                correctionId: reference.correctionId
            )
        }
        if reference.status == "unlinked" {
            // A successful owner-authenticated response is authoritative. The
            // continuation lease and its private card/photo/settings must not
            // survive a server-side account-link revocation.
            try offline.clear()
            return NativeSupporterHypeCardPreview(
                publicCard: nil,
                privateCard: nil,
                privatePhoto: nil,
                settings: nil,
                identityMismatch: false,
                correctionId: nil
            )
        }
        guard reference.status == "no-card" else {
            throw SupporterHomeAPIError.invalidResponse
        }
        return NativeSupporterHypeCardPreview(
            publicCard: nil,
            privateCard: nil,
            privatePhoto: nil,
            settings: nil,
            identityMismatch: false,
            correctionId: nil
        )
    }

    static func correctNativeHypeCardIdentity(
        correctionId: String,
        clerk: Clerk
    ) async throws -> NativeHypeCardIdentityCorrectionResult {
        let data = try await NativeAccountLinkClient().postData(
            "supporter/hype-card/identity",
            body: NativeHypeCardIdentityCorrectionBody(correctionId: correctionId, confirm: true),
            method: "POST",
            clerk: clerk
        )
        do {
            return try JSONDecoder().decode(NativeHypeCardIdentityCorrectionResult.self, from: data)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    static func updateNativeHypeCard(
        settings: NativeHypeCardSettingsUpdate,
        clerk: Clerk
    ) async throws -> NativeHypeCardSettings {
        guard let subject = clerk.user?.id else {
            throw NativeAccountLinkError.message("Sign in to the iPhone app again.")
        }
        let client = NativeAccountLinkClient()
        // Record uncertainty before sending the mutation. If the process ends
        // while the request is in flight, the next editor visit must check PIXL.
        try client.markHypeCardSettingsConfirmationPending(
            NativeHypeCardSettings(
                revision: settings.expectedRevision,
                showHypeCard: settings.showHypeCard,
                showStats: settings.showStats,
                showEvents: settings.showEvents,
                paused: settings.paused,
                favoriteMoment: settings.favoriteMoment
            ),
            subject: subject
        )
        let data = try await client.postData(
            "supporter/hype-card",
            body: settings,
            method: "PATCH",
            clerk: clerk
        )
        let saved: NativeHypeCardSettings
        do {
            saved = try JSONDecoder().decode(NativeHypeCardSettings.self, from: data)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
        try client.clearHypeCardSettingsConfirmation(subject: subject)
        return saved
    }

#if DEBUG
    static func applyNativeHypeCardConflictEditForUITest(
        clerk: Clerk
    ) async throws -> NativeHypeCardSettings {
        let latest = try await fetchAuthoritativeNativeHypeCardSettings(clerk: clerk)
        guard let revision = latest.revision, !revision.isEmpty else {
            throw SupporterHomeAPIError.invalidResponse
        }
        return try await updateNativeHypeCard(
            settings: NativeHypeCardSettingsUpdate(
                showHypeCard: latest.showHypeCard,
                showStats: latest.showStats,
                showEvents: !latest.showEvents,
                paused: latest.paused,
                favoriteMoment: latest.favoriteMoment,
                expectedRevision: revision,
                confirmPublish: false
            ),
            clerk: clerk
        )
    }
#endif

    /// Sync only a save intent written by the owner's explicit Save action.
    /// Drafts by themselves are never eligible for automatic publication.
    @MainActor
    static func syncQueuedNativeHypeCardSettings(clerk: Clerk) async throws -> NativeHypeCardSettings? {
        guard let subject = clerk.user?.id else { return nil }
        let client = NativeAccountLinkClient()
        guard var intent = try client.loadHypeCardSettingsSaveIntent(subject: subject) else {
            return nil
        }
        let initialNamespace = NativeOfflineRuntime.shared.vault.namespace
        guard let initialNamespace,
              NativeOfflineRuntime.shared.vault.canContinue(subject: subject) else {
            throw NativeOfflineError.locked
        }

        for attempt in 0..<3 {
            let latest = try await fetchAuthoritativeNativeHypeCardSettings(clerk: clerk)
            guard clerk.user?.id == subject,
                  NativeOfflineRuntime.shared.vault.namespace == initialNamespace,
                  NativeOfflineRuntime.shared.vault.canContinue(subject: subject) else {
                throw NativeOfflineError.locked
            }

            if latest.hasSameSettings(as: intent.desired) {
                try finishQueuedNativeHypeCardSettings(
                    subject: subject,
                    saved: latest,
                    intent: intent,
                    client: client
                )
                return latest
            }

            guard let revision = latest.revision, !revision.isEmpty else {
                throw SupporterHomeAPIError.invalidResponse
            }
            let merged = mergeQueuedHypeCardSettings(
                base: intent.base,
                local: intent.desired,
                latest: latest
            )
            let rebasedIntent = NativeHypeCardSettingsSaveIntent(
                base: latest,
                desired: merged,
                confirmPublish: intent.confirmPublish
            )
            try client.saveHypeCardSettingsSaveIntent(rebasedIntent, subject: subject)
            let currentDraft = try client.loadHypeCardSettingsDraft(subject: subject)
            if currentDraft.map({ $0.hasSameSettings(as: intent.desired) }) ?? true {
                try client.saveHypeCardSettingsDraft(merged, subject: subject)
            }
            intent = rebasedIntent

            let favorite = merged.favoriteMoment?.trimmingCharacters(in: .whitespacesAndNewlines)
            let update = NativeHypeCardSettingsUpdate(
                showHypeCard: merged.showHypeCard,
                showStats: merged.showStats,
                showEvents: merged.showEvents,
                paused: merged.paused,
                favoriteMoment: favorite?.isEmpty == true ? nil : favorite,
                expectedRevision: revision,
                confirmPublish: intent.confirmPublish
            )
            do {
                let saved = try await updateNativeHypeCard(settings: update, clerk: clerk)
                guard clerk.user?.id == subject,
                      NativeOfflineRuntime.shared.vault.namespace == initialNamespace else {
                    throw NativeOfflineError.locked
                }
                guard saved.hasSameSettings(as: merged) else { return nil }
                try finishQueuedNativeHypeCardSettings(
                    subject: subject,
                    saved: saved,
                    intent: intent,
                    client: client
                )
                return saved
            } catch let error as NativeAccountLinkError where error.statusCode == 409 {
                try client.clearHypeCardSettingsConfirmation(subject: subject)
                if attempt == 2 { return nil }
            }
        }
        return nil
    }

    private static func finishQueuedNativeHypeCardSettings(
        subject: String,
        saved: NativeHypeCardSettings,
        intent: NativeHypeCardSettingsSaveIntent,
        client: NativeAccountLinkClient
    ) throws {
        let localDraft = try client.loadHypeCardSettingsDraft(subject: subject)
        try client.clearHypeCardSettingsConfirmation(subject: subject)
        if let localDraft, !localDraft.hasSameSettings(as: intent.desired) {
            let base = localDraft.revision == intent.base.revision ? intent.base : saved
            let preserved = mergeQueuedHypeCardSettings(base: base, local: localDraft, latest: saved)
            if preserved.hasSameSettings(as: saved) {
                try client.clearHypeCardSettingsDraft(subject: subject)
            } else {
                try client.saveHypeCardSettingsDraft(preserved, subject: subject)
            }
        } else {
            try client.clearHypeCardSettingsDraft(subject: subject)
        }
        try client.clearHypeCardSettingsSaveIntent(subject: subject)
    }

    private static func mergeQueuedHypeCardSettings(
        base: NativeHypeCardSettings,
        local: NativeHypeCardSettings,
        latest: NativeHypeCardSettings
    ) -> NativeHypeCardSettings {
        let localHasKnownBase = base.revision != nil
            && local.revision != nil
            && local.revision == base.revision
        return NativeHypeCardSettings(
            revision: latest.revision,
            showHypeCard: !localHasKnownBase || local.showHypeCard != base.showHypeCard
                ? local.showHypeCard : latest.showHypeCard,
            showStats: !localHasKnownBase || local.showStats != base.showStats
                ? local.showStats : latest.showStats,
            showEvents: !localHasKnownBase || local.showEvents != base.showEvents
                ? local.showEvents : latest.showEvents,
            paused: !localHasKnownBase || local.paused != base.paused
                ? local.paused : latest.paused,
            favoriteMoment: !localHasKnownBase || local.favoriteMoment != base.favoriteMoment
                ? local.favoriteMoment : latest.favoriteMoment
        )
    }

    static func fetchAuthoritativeNativeHypeCardSettings(clerk: Clerk) async throws -> NativeHypeCardSettings {
        let client = NativeAccountLinkClient()
        // A fresh linked schedule response renews the offline vault lease so
        // account-scoped recovery markers can be read and cleared after a long
        // interval between app launches.
        _ = try await client.getAuthoritativeData("supporter/schedule", clerk: clerk)
        let data = try await client.getAuthoritativeData("supporter/hype-card", clerk: clerk)
        let reference: NativeHypeCardReference
        do {
            reference = try JSONDecoder().decode(NativeHypeCardReference.self, from: data)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
        guard let settings = reference.settings, settings.revision?.isEmpty == false else {
            throw SupporterHomeAPIError.invalidResponse
        }
        return settings
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

    static func fetchLiveTapSummary(inviteToken: String, ownerClerk: Clerk? = nil) async throws -> (sport: String, summary: LiveTapSummary) {
        try Task.checkCancellation()
        let data: Data
        if let ownerClerk {
            data = try await NativeAccountLinkClient().getAuthoritativeData(
                "athlete-invites/\(inviteToken)/live-taps", apiRoot: true, clerk: ownerClerk
            )
        } else {
            data = try await NativeAccountLinkClient().publicRequest("athlete-invites/\(inviteToken)/fan")
        }
        try Task.checkCancellation()
        do {
            struct SummaryResponse: Decodable { let sport: String; let liveTaps: LiveTapSummary }
            let summary = try JSONDecoder().decode(SummaryResponse.self, from: data)
            return (summary.sport, summary.liveTaps)
        } catch {
            throw SupporterHomeAPIError.invalidResponse
        }
    }

    static func sendLiveTap(
        inviteToken: String,
        accessToken: String?,
        cheerKey: String,
        clerk: Clerk? = nil,
        gameId: String? = nil,
        clientMutationId: String? = nil,
        expectedEventId: String? = nil
    ) async throws -> LiveTapSummary {
        let path = "athlete-invites/\(inviteToken)/live-taps"
        var body = ["cheerKey": cheerKey]
        if let gameId { body["gameId"] = gameId }
        if let clientMutationId { body["clientMutationId"] = clientMutationId }
        if let expectedEventId { body["expectedEventId"] = expectedEventId }
        let data: Data
        if let clerk {
            // The server verifies the native identity's account link. Parent
            // access must never depend on creating a visitor QR for this phone.
            data = try await NativeAccountLinkClient().postData(
                path, body: body, apiRoot: true, clerk: clerk
            )
        } else {
            guard let accessToken else { throw SupporterHomeAPIError.privateScheduleUnavailable }
            body["accessToken"] = accessToken
            data = try await NativeAccountLinkClient().publicRequest(
                path, method: "POST", body: body
            )
        }
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
        time.isEmpty ? "Time to be announced" : nativeEventTimeDisplay(time)
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
