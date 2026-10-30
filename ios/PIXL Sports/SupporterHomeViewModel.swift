import Foundation
import Combine
import ClerkKit

enum SupporterEventTiming: Equatable {
    case upcoming
    case live
}

@MainActor
final class SupporterHomeViewModel: ObservableObject {
    enum State {
        case notConnected
        case loading
        case schedule(page: NativeSupporterSchedule, events: [SupporterScheduleItem])
        case failed(String)
    }

    @Published private(set) var state: State = .loading

    func load(clerk: Clerk) async {
        state = .loading
        do {
            let page = try await SupporterHomeAPI.fetchPrivateSchedule(clerk: clerk)
            guard !Task.isCancelled else { return }
            guard page.status == "linked" else {
                state = .notConnected
                return
            }
            state = .schedule(page: page, events: upcomingEvents(in: page, now: Date()))
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
}

struct SupporterScheduleItem: Identifiable {
    let event: AthleteFanEvent
    let timing: SupporterEventTiming
    let start: Date?

    var id: String { event.id }
}
