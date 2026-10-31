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

    /// Mirrors the web Message Board's priority: live event, recently ended
    /// event, then the next upcoming event. Event Cards use a two-hour window
    /// after their scheduled start when no explicit end time is available.
    static func featuredGuideEvent(
        in page: NativeSupporterSchedule,
        now: Date = Date()
    ) -> SupporterScheduleItem? {
        let zone = TimeZone(identifier: page.timezone ?? "") ?? .current
        let dateFormatter = DateFormatter()
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.timeZone = zone
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let today = dateFormatter.string(from: now)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let recentDate = calendar.date(byAdding: .day, value: -1, to: now) ?? now
        let recentDateKey = dateFormatter.string(from: recentDate)

        let candidates = page.events.compactMap { event -> SupporterScheduleItem? in
            let start = event.parsedStart(timezone: event.timezone ?? page.timezone)
            let elapsed = start.map { now.timeIntervalSince($0) }
            let isRecent = elapsed.map { $0 >= 0 && $0 < 24 * 60 * 60 }
                ?? (event.date >= recentDateKey && event.date <= today)

            if event.date < today {
                return isRecent && event.type == "game"
                    ? SupporterScheduleItem(event: event, timing: .complete, start: start)
                    : nil
            }
            if event.status == "final" {
                return isRecent && event.type == "game"
                    ? SupporterScheduleItem(event: event, timing: .complete, start: start)
                    : nil
            }

            if event.status == "live" {
                if let elapsed, elapsed >= 2 * 60 * 60 {
                    return isRecent && event.type == "game"
                        ? SupporterScheduleItem(event: event, timing: .complete, start: start)
                        : nil
                }
                return SupporterScheduleItem(event: event, timing: .live, start: start)
            }

            if event.date > today {
                return SupporterScheduleItem(event: event, timing: .upcoming, start: start)
            }
            guard let start else {
                return SupporterScheduleItem(event: event, timing: .upcoming, start: nil)
            }
            if start > now {
                return SupporterScheduleItem(event: event, timing: .upcoming, start: start)
            }
            if now.timeIntervalSince(start) < 2 * 60 * 60 {
                return SupporterScheduleItem(event: event, timing: .live, start: start)
            }
            return isRecent && event.type == "game"
                ? SupporterScheduleItem(event: event, timing: .complete, start: start)
                : nil
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

    func load(clerk: Clerk) async {
        state = .loading
        hypeCardPreview = nil
        hypeCardPreviewError = nil
        do {
            let page = try await SupporterHomeAPI.fetchPrivateSchedule(clerk: clerk)
            guard !Task.isCancelled else { return }
            guard page.status == "linked" else {
                state = .notConnected
                return
            }
            let now = Date()
            state = .schedule(
                page: page,
                events: upcomingEvents(in: page, now: now),
                pastEvents: recentCompletedEvents(in: page, now: now)
            )
            do {
                hypeCardPreview = try await SupporterHomeAPI.fetchPublicHypeCard(clerk: clerk)
            } catch is CancellationError {
                return
            } catch {
                hypeCardPreviewError = error.localizedDescription
            }
            guard !Task.isCancelled else { return }
        } catch is CancellationError {
            return
        } catch let error as URLError {
            guard !Task.isCancelled else { return }
            switch error.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut:
                state = .failed("Check your internet connection, then try again.")
            default:
                state = .failed("We couldn’t reach PIXL Sports. Please try again.")
            }
        } catch {
            guard !Task.isCancelled else { return }
            state = .failed(error.localizedDescription)
        }
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
