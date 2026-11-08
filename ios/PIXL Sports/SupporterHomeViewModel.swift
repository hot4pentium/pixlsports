import Foundation
import Combine
import ClerkKit
import UIKit

enum SupporterEventTiming: Equatable {
    case upcoming
    case live
    case complete
}

@MainActor
final class SupporterHomeViewModel: ObservableObject {
    enum State {
        case notConnected
        case loading
        case schedule(
            page: NativeSupporterSchedule,
            events: [SupporterScheduleItem],
            pastEvents: [SupporterScheduleItem]
        )
        case failed(String)
    }

    @Published private(set) var state: State = .loading
    @Published private(set) var fanBase: NativeSupporterFanBase?
    @Published private(set) var fanBaseIsLoading = false
    @Published private(set) var fanBaseError: String?
    @Published private(set) var hypeCardPreview: NativeSupporterHypeCardPreview?
    @Published private(set) var hypeCardPrivatePhoto: UIImage?
    @Published private(set) var hypeCardPreviewError: String?
    private var hypePreviewRequestID = UUID()
    @Published private(set) var athleteProfile: NativeSupporterProfile?
    @Published private(set) var athleteProfileError: String?
    @Published private(set) var hasResolvedAthleteProfile = false
    @Published private(set) var hasResolvedInitialSchedule = false
    private var hasLoadedAthleteProfile = false
    private var cachedPreviewSubject: String?

    var needsAthleteProfileSetup: Bool {
        guard hasResolvedAthleteProfile, athleteProfileError == nil,
              let athleteProfile else { return false }
        return athleteProfile.needsSetup
    }

    func setAthleteProfile(_ profile: NativeSupporterProfile) {
        hypePreviewRequestID = UUID()
        athleteProfile = profile
        athleteProfileError = nil
        hasResolvedAthleteProfile = true
        hasLoadedAthleteProfile = true
    }

    func resetAthleteProfile() {
        hypePreviewRequestID = UUID()
        athleteProfile = nil
        athleteProfileError = nil
        hasResolvedAthleteProfile = false
        hasLoadedAthleteProfile = false
    }

    /// Chooses the game-day guide from scheduled time, not a saved game status.
    /// The home guide shares the detail-step phases, then advances after two hours.
    static func featuredGuideEvent(
        in page: NativeSupporterSchedule,
        now: Date = Date()
    ) -> SupporterScheduleItem? {
        let candidates = page.events.compactMap { event -> SupporterScheduleItem? in
            let eventTimeZone = TimeZone(identifier: event.timezone ?? "")
                ?? TimeZone(identifier: page.timezone ?? "")
                ?? .current
            let dateFormatter = DateFormatter()
            dateFormatter.locale = Locale(identifier: "en_US_POSIX")
            dateFormatter.timeZone = eventTimeZone
            dateFormatter.dateFormat = "yyyy-MM-dd"
            let today = dateFormatter.string(from: now)
            let start = event.parsedStart(timezone: eventTimeZone.identifier)

            if event.type == "game" {
                guard let step = NativeEventGuideTiming.gameRecommendation(
                    eventDate: event.date,
                    start: start,
                    timeZone: eventTimeZone,
                    now: now
                ) else {
                    return nil
                }
                let timing: SupporterEventTiming
                switch step {
                case .prep: timing = .upcoming
                case .trackStats: timing = .live
                case .share: timing = .complete
                }
                return SupporterScheduleItem(event: event, timing: timing, start: start)
            }

            // A stale status must not turn a future game or practice into a
            // live event before its scheduled start.
            if event.date > today || (start.map { $0 > now } ?? false) {
                return SupporterScheduleItem(event: event, timing: .upcoming, start: start)
            }
            guard event.date == today else { return nil }
            if event.status == "final" { return nil }

            if event.status == "live" {
                if let start, now.timeIntervalSince(start) >= 2 * 60 * 60 { return nil }
                return SupporterScheduleItem(event: event, timing: .live, start: start)
            }

            guard let start else {
                return SupporterScheduleItem(event: event, timing: .upcoming, start: nil)
            }
            if now.timeIntervalSince(start) < 2 * 60 * 60 {
                return SupporterScheduleItem(event: event, timing: .live, start: start)
            }
            return nil
        }

        return candidates.sorted { left, right in
            if left.timing != right.timing {
                switch (left.timing, right.timing) {
                case (.live, _): return true
                case (_, .live): return false
                case (.complete, .upcoming): return true
                case (.upcoming, .complete): return false
                default: break
                }
            }
            if left.timing == .complete, let leftStart = left.start, let rightStart = right.start {
                return leftStart > rightStart
            }
            if let leftStart = left.start, let rightStart = right.start {
                return leftStart < rightStart
            }
            if left.start != nil { return true }
            if right.start != nil { return false }
            return left.event.date == right.event.date
                ? left.event.time < right.event.time
                : left.event.date < right.event.date
        }.first
    }

    func load(clerk: Clerk, forceProfileReload: Bool = false) async {
        let previewRequestID = UUID()
        let previewUserID = clerk.user?.id
        if cachedPreviewSubject != previewUserID {
            hypeCardPreview = nil
            hypeCardPrivatePhoto = nil
            hypeCardPreviewError = nil
            cachedPreviewSubject = previewUserID
        }
        fanBase = nil
        fanBaseIsLoading = false
        fanBaseError = nil
        hypePreviewRequestID = previewRequestID
        let offline = NativeOfflineRuntime.shared
        if let data = try? offline.vault.read("get/supporter/schedule", subject: previewUserID),
           let saved = try? JSONDecoder().decode(NativeSupporterSchedule.self, from: data),
           saved.status == "linked" {
            state = .schedule(page: saved, events: upcomingEvents(in: saved, now: Date()),
                              pastEvents: pastEventCards(in: saved, now: Date()))
            if !hasLoadedAthleteProfile,
               let data = try? offline.vault.read("get/supporter/profile", subject: previewUserID),
               let savedProfile = try? JSONDecoder().decode(NativeSupporterProfile.self, from: data) {
                athleteProfile = savedProfile
                // An old unfinished cache must be checked before reopening setup.
                hasLoadedAthleteProfile = !savedProfile.needsSetup
                hasResolvedAthleteProfile = !savedProfile.needsSetup
                hasResolvedInitialSchedule = !savedProfile.needsSetup
            }
            if let data = try? offline.vault.read("dashboard-preview", subject: previewUserID),
               let savedPreview = try? JSONDecoder().decode(NativeSupporterHypeCardPreview.self, from: data) {
                let normalize: (String) -> String = { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
                let name = savedPreview.publicCard?.athleteName ?? savedPreview.privateCard?.athleteName
                let team = savedPreview.publicCard?.teamName ?? savedPreview.privateCard?.teamName ?? ""
                let expectedName = athleteProfile?.athleteName ?? saved.athleteName ?? ""
                let expectedTeam = athleteProfile?.teamName ?? saved.teamName ?? ""
                if !savedPreview.identityMismatch,
                   name.map({ normalize($0) == normalize(expectedName) &&
                       (normalize(expectedTeam).isEmpty || normalize(team) == normalize(expectedTeam)) }) ?? true {
                    hypeCardPreview = savedPreview
                    hypeCardPrivatePhoto = savedPreview.privatePhoto.flatMap(UIImage.init(data:))
                } else { hypeCardPreview = nil; hypeCardPrivatePhoto = nil }
            }
        } else if !hasResolvedInitialSchedule { state = .loading }
        hypeCardPreviewError = nil
        do {
            var page = try await SupporterHomeAPI.fetchPrivateSchedule(clerk: clerk)
            guard !Task.isCancelled, hypePreviewRequestID == previewRequestID,
                  clerk.user?.id == previewUserID else { return }
            if page.status == "unlinked" {
                let ready = try await SupporterHomeAPI.prepareAccount(clerk: clerk)
                guard !Task.isCancelled, hypePreviewRequestID == previewRequestID,
                      clerk.user?.id == previewUserID else { return }
                if ready {
                    // Only first-time unlinked startup prepares an account.
                    // Navigation and stat taps never run account provisioning.
                    hasLoadedAthleteProfile = false
                    hasResolvedAthleteProfile = false
                    athleteProfile = nil
                    page = try await SupporterHomeAPI.fetchPrivateSchedule(clerk: clerk)
                }
            }
            guard hypePreviewRequestID == previewRequestID,
                  clerk.user?.id == previewUserID else { return }
            guard !Task.isCancelled else {
                finishCancelledScheduleLoad()
                return
            }
            guard page.status == "linked" else {
                state = .notConnected
                fanBase = nil
                hypeCardPreview = nil
                hypeCardPrivatePhoto = nil
                hypeCardPreviewError = nil
                athleteProfile = nil
                athleteProfileError = nil
                hasResolvedAthleteProfile = true
                hasLoadedAthleteProfile = true
                hasResolvedInitialSchedule = true
                return
            }
            let verifiedScope = offline.vault.namespace
            let now = Date()
            state = .schedule(
                page: page,
                events: upcomingEvents(in: page, now: now),
                pastEvents: pastEventCards(in: page, now: now)
            )
            if forceProfileReload || !hasLoadedAthleteProfile || athleteProfile?.needsSetup == true {
                let profileRevision = offline.athleteProfileCacheRevision
                do {
                    let profile = try await SupporterHomeAPI.fetchAthleteProfile(clerk: clerk)
                    guard !Task.isCancelled, hypePreviewRequestID == previewRequestID,
                          clerk.user?.id == previewUserID, verifiedScope == offline.vault.namespace,
                          profileRevision == offline.athleteProfileCacheRevision else { return }
                    athleteProfile = profile
                    athleteProfileError = nil
                    hasLoadedAthleteProfile = true
                    hasResolvedAthleteProfile = true
                } catch is CancellationError {
                    return
                } catch {
                    guard !Task.isCancelled, hypePreviewRequestID == previewRequestID,
                          clerk.user?.id == previewUserID, verifiedScope == offline.vault.namespace,
                          profileRevision == offline.athleteProfileCacheRevision else { return }
                    athleteProfileError = error.localizedDescription
                    hasResolvedAthleteProfile = true
                }
            }
            // Resolve first-time athlete setup behind the branded splash.
            // A card does not exist yet, so do not delay the setup sheet by
            // fetching its optional preview.
            hasResolvedInitialSchedule = true
            if needsAthleteProfileSetup { return }
            fanBaseIsLoading = true
            do {
                let summary = try await SupporterHomeAPI.fetchOwnerFanBase(clerk: clerk)
                guard !Task.isCancelled, hypePreviewRequestID == previewRequestID,
                      clerk.user?.id == previewUserID, verifiedScope == offline.vault.namespace else { return }
                fanBase = summary
                fanBaseIsLoading = false
            } catch is CancellationError {
                if hypePreviewRequestID == previewRequestID { fanBaseIsLoading = false }
                return
            } catch {
                guard !Task.isCancelled, hypePreviewRequestID == previewRequestID,
                      clerk.user?.id == previewUserID, verifiedScope == offline.vault.namespace else { return }
                fanBase = nil
                fanBaseIsLoading = false
                let status = (error as? NativeAccountLinkError)?.statusCode
                // Do not reveal a panel for another or unavailable owner's card.
                if status != 401 && status != 403 && status != 404 && status != 409 && status != 423 {
                    fanBaseError = "The latest Fan Base count couldn’t be loaded, so no current count is shown. Check your connection and try again."
                }
            }
            do {
                let preview = try await SupporterHomeAPI.fetchOwnerHypeCardPreview(clerk: clerk)
                guard !Task.isCancelled, hypePreviewRequestID == previewRequestID,
                      clerk.user?.id == previewUserID, verifiedScope == offline.vault.namespace else { return }
                let cardName = preview.publicCard?.athleteName ?? preview.privateCard?.athleteName
                let cardTeam = preview.publicCard?.teamName ?? preview.privateCard?.teamName ?? ""
                let expectedName = athleteProfile?.athleteName ?? page.athleteName ?? ""
                let expectedTeam = athleteProfile?.teamName ?? page.teamName ?? ""
                let normalize: (String) -> String = { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
                let identityMatches = cardName.map {
                    !normalize(expectedName).isEmpty && normalize($0) == normalize(expectedName)
                        && (normalize(expectedTeam).isEmpty || normalize(cardTeam) == normalize(expectedTeam))
                } ?? true
                if preview.identityMismatch || !identityMatches {
                    hypeCardPreviewError = "Review the HYPE Card identity before showing its photo here."
                } else {
                    hypeCardPreview = preview
                    hypeCardPrivatePhoto = preview.privatePhoto.flatMap(UIImage.init(data:))
                    if let data = try? JSONEncoder().encode(preview) { offline.cache(data, key: "dashboard-preview") }
                    if preview.privatePhoto != nil && hypeCardPrivatePhoto == nil {
                        hypeCardPreviewError = "The HYPE Card photo could not be displayed. Open the card to try again."
                    }
                }
            } catch is CancellationError {
                return
            } catch {
                guard hypePreviewRequestID == previewRequestID, clerk.user?.id == previewUserID else { return }
                let status = (error as? NativeAccountLinkError)?.statusCode
                if [401, 403, 404, 409, 410, 423].contains(status ?? 0) {
                    hypeCardPreview = nil
                    hypeCardPrivatePhoto = nil
                    hypeCardPreviewError = "Reconnect this iPhone to view the HYPE Card."
                } else {
                    hypeCardPreviewError = "Your saved HYPE Card is shown, but it couldn’t be refreshed."
                }
            }
            guard !Task.isCancelled else { return }
            offline.resume(clerk: clerk)
        } catch is CancellationError {
            guard hypePreviewRequestID == previewRequestID,
                  clerk.user?.id == previewUserID else { return }
            finishCancelledScheduleLoad()
            return
        } catch let error as URLError {
            guard hypePreviewRequestID == previewRequestID,
                  clerk.user?.id == previewUserID else { return }
            guard !Task.isCancelled else {
                finishCancelledScheduleLoad()
                return
            }
            if case .schedule = state { hasResolvedInitialSchedule = true; return }
            switch error.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut:
                state = .failed("Check your internet connection, then try again.")
            default:
                state = .failed("We couldn’t reach PIXL Sports. Please try again.")
            }
            hasResolvedInitialSchedule = true
        } catch {
            guard hypePreviewRequestID == previewRequestID,
                  clerk.user?.id == previewUserID else { return }
            guard !Task.isCancelled else {
                finishCancelledScheduleLoad()
                return
            }
            let status = (error as? NativeAccountLinkError)?.statusCode
            if [401, 403, 410, 423].contains(status ?? 0) {
                hypeCardPreview = nil
                hypeCardPrivatePhoto = nil
                hypeCardPreviewError = nil
            }
            if case .schedule = state, status == nil || (status ?? 0) >= 500 {
                hasResolvedInitialSchedule = true
                return
            }
            state = .failed(error.localizedDescription)
            hasResolvedInitialSchedule = true
        }
    }

    private func finishCancelledScheduleLoad() {
        state = .failed("The schedule request was interrupted. Check your connection and try again.")
        hasResolvedInitialSchedule = true
    }

    private func upcomingEvents(
        in page: NativeSupporterSchedule,
        now: Date
    ) -> [SupporterScheduleItem] {
        let dateFormatter = DateFormatter()
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.dateFormat = "yyyy-MM-dd"

        let candidates = page.events.compactMap { event -> SupporterScheduleItem? in
            let zone = TimeZone(identifier: event.timezone ?? page.timezone ?? "") ?? .current
            dateFormatter.timeZone = zone
            let today = dateFormatter.string(from: now)
            let start = event.parsedStart(timezone: zone.identifier)
            if event.type == "game" {
                guard let recommendation = NativeEventGuideTiming.gameRecommendation(
                    eventDate: event.date, start: start, timeZone: zone, now: now
                ) else { return nil }
                if recommendation == .share { return nil }
                return SupporterScheduleItem(event: event,
                    timing: recommendation == .trackStats ? .live : .upcoming, start: start)
            }

            guard event.date >= today else { return nil }
            if event.date > today {
                return SupporterScheduleItem(event: event, timing: .upcoming, start: start)
            }
            guard let start else {
                return event.status == "upcoming"
                    ? SupporterScheduleItem(event: event, timing: .upcoming, start: nil)
                    : nil
            }
            if start >= now {
                return SupporterScheduleItem(event: event, timing: .upcoming, start: start)
            }
            if now.timeIntervalSince(start) <= 3 * 60 * 60 {
                return SupporterScheduleItem(event: event, timing: .live, start: start)
            }
            return nil
        }

        return candidates
            .sorted { left, right in
                if left.timing != right.timing {
                    func priority(_ timing: SupporterEventTiming) -> Int {
                        switch timing {
                        case .live: return 0
                        case .upcoming: return 1
                        case .complete: return 2
                        }
                    }
                    return priority(left.timing) < priority(right.timing)
                }
                if let leftStart = left.start, let rightStart = right.start {
                    return leftStart < rightStart
                }
                if left.start != nil { return true }
                if right.start != nil { return false }
                return left.event.date == right.event.date
                    ? left.event.time < right.event.time
                    : left.event.date < right.event.date
            }
    }

    private func pastEventCards(
        in page: NativeSupporterSchedule,
        now: Date
    ) -> [SupporterScheduleItem] {
        let dateFormatter = DateFormatter()
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.dateFormat = "yyyy-MM-dd"

        let candidates = page.events.compactMap { event -> SupporterScheduleItem? in
            let zone = TimeZone(identifier: event.timezone ?? page.timezone ?? "") ?? .current
            dateFormatter.timeZone = zone
            let today = dateFormatter.string(from: now)
            let start = event.parsedStart(timezone: zone.identifier)
            guard event.date <= today else { return nil }
            if event.date == today {
                if let start {
                    let settledAfter: TimeInterval = event.type == "game" ? 2 * 60 * 60 : 3 * 60 * 60
                    guard now.timeIntervalSince(start) >= settledAfter else { return nil }
                } else {
                    guard event.status == "final" else { return nil }
                }
            }
            return SupporterScheduleItem(
                event: event,
                timing: .complete,
                start: start
            )
        }

        return candidates.sorted { left, right in
            if let leftStart = left.start, let rightStart = right.start {
                return leftStart > rightStart
            }
            if left.event.date != right.event.date {
                return left.event.date > right.event.date
            }
            if left.start != nil { return true }
            if right.start != nil { return false }
            return left.event.time > right.event.time
        }
    }
}

struct SupporterScheduleItem: Identifiable {
    let event: AthleteFanEvent
    let timing: SupporterEventTiming
    let start: Date?

    var id: String { event.id }
}
