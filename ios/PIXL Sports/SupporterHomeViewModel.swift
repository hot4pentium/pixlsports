import Foundation
import Combine
import ClerkKit

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
    @Published private(set) var hypeCardPreview: NativePublicHypeCard?
    @Published private(set) var hypeCardPreviewError: String?
    @Published private(set) var athleteProfile: NativeSupporterProfile?
    @Published private(set) var athleteProfileError: String?
    @Published private(set) var hasResolvedAthleteProfile = false
    @Published private(set) var hasResolvedInitialSchedule = false
    private var hasLoadedAthleteProfile = false

    var needsAthleteProfileSetup: Bool {
        guard hasResolvedAthleteProfile, athleteProfileError == nil,
              let athleteProfile else { return false }
        return athleteProfile.athleteName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    func setAthleteProfile(_ profile: NativeSupporterProfile) {
        athleteProfile = profile
        athleteProfileError = nil
        hasResolvedAthleteProfile = true
        hasLoadedAthleteProfile = true
    }

    func resetAthleteProfile() {
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
        state = .loading
        hypeCardPreview = nil
        hypeCardPreviewError = nil
        do {
            let page = try await SupporterHomeAPI.fetchPrivateSchedule(clerk: clerk)
            guard !Task.isCancelled else {
                finishCancelledScheduleLoad()
                return
            }
            guard page.status == "linked" else {
                state = .notConnected
                athleteProfile = nil
                athleteProfileError = nil
                hasResolvedAthleteProfile = true
                hasLoadedAthleteProfile = true
                hasResolvedInitialSchedule = true
                return
            }
            let now = Date()
            state = .schedule(
                page: page,
                events: upcomingEvents(in: page, now: now),
                pastEvents: recentCompletedEvents(in: page, now: now)
            )
            // The schedule is sufficient to render the dashboard; the optional
            // HYPE Card preview can continue loading without holding the splash.
            hasResolvedInitialSchedule = true
            if forceProfileReload || !hasLoadedAthleteProfile {
                do {
                    athleteProfile = try await SupporterHomeAPI.fetchAthleteProfile(clerk: clerk)
                    athleteProfileError = nil
                    hasLoadedAthleteProfile = true
                    hasResolvedAthleteProfile = true
                } catch is CancellationError {
                    return
                } catch {
                    athleteProfileError = error.localizedDescription
                    hasResolvedAthleteProfile = true
                }
            }
            do {
                hypeCardPreview = try await SupporterHomeAPI.fetchPublicHypeCard(clerk: clerk)
            } catch is CancellationError {
                return
            } catch {
                hypeCardPreviewError = error.localizedDescription
            }
            guard !Task.isCancelled else { return }
        } catch is CancellationError {
            finishCancelledScheduleLoad()
            return
        } catch let error as URLError {
            guard !Task.isCancelled else {
                finishCancelledScheduleLoad()
                return
            }
            switch error.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut:
                state = .failed("Check your internet connection, then try again.")
            default:
                state = .failed("We couldn’t reach PIXL Sports. Please try again.")
            }
            hasResolvedInitialSchedule = true
        } catch {
            guard !Task.isCancelled else {
                finishCancelledScheduleLoad()
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
        let zone = TimeZone(identifier: page.timezone ?? "") ?? .current
        let dateFormatter = DateFormatter()
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.timeZone = zone
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let today = dateFormatter.string(from: now)

        let candidates = page.events.compactMap { event -> SupporterScheduleItem? in
            guard event.status != "final" else { return nil }
            let start = event.parsedStart(timezone: page.timezone)

            if event.status == "live" {
                return SupporterScheduleItem(event: event, timing: .live, start: start)
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
                    return left.timing == .live
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

    private func recentCompletedEvents(
        in page: NativeSupporterSchedule,
        now: Date
    ) -> [SupporterScheduleItem] {
        let zone = TimeZone(identifier: page.timezone ?? "") ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone

        let dateFormatter = DateFormatter()
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.timeZone = zone
        dateFormatter.dateFormat = "yyyy-MM-dd"

        guard
            let today = dateFormatter.date(from: dateFormatter.string(from: now)),
            let cutoff = calendar.date(byAdding: .day, value: -30, to: today)
        else {
            return []
        }

        let candidates = page.events.compactMap { event -> SupporterScheduleItem? in
            guard event.status == "final",
                  let eventDate = dateFormatter.date(from: event.date),
                  eventDate >= cutoff,
                  eventDate <= today
            else {
                return nil
            }
            return SupporterScheduleItem(
                event: event,
                timing: .complete,
                start: event.parsedStart(timezone: event.timezone ?? page.timezone)
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
