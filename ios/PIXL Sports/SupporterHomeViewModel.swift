import Foundation
import Combine

enum SupporterEventTiming: Equatable {
    case upcoming
    case live
}

@MainActor
final class SupporterHomeViewModel: ObservableObject {
    enum State {
        case notConnected
        case loading
        case event(page: AthleteFanPage, event: AthleteFanEvent, timing: SupporterEventTiming)
        case empty(page: AthleteFanPage)
        case failed(String)
    }

    @Published private(set) var state: State = .notConnected

    func reset() {
        state = .notConnected
    }

    func load(from athletePageLink: String) async {
        guard let inviteToken = SupporterHomeAPI.inviteToken(from: athletePageLink) else {
            state = .failed(SupporterHomeAPIError.invalidPageLink.localizedDescription)
            return
        }

        state = .loading
        do {
            let page = try await SupporterHomeAPI.fetchFanPage(inviteToken: inviteToken)
            guard !Task.isCancelled else { return }

            if let next = nextEvent(in: page, now: Date()) {
                state = .event(page: page, event: next.event, timing: next.timing)
            } else {
                state = .empty(page: page)
            }
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

    private func nextEvent(
        in page: AthleteFanPage,
        now: Date
    ) -> (event: AthleteFanEvent, timing: SupporterEventTiming)? {
        let zone = TimeZone(identifier: page.timezone ?? "") ?? .current
        let dateFormatter = DateFormatter()
        dateFormatter.locale = Locale(identifier: "en_US_POSIX")
        dateFormatter.timeZone = zone
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let today = dateFormatter.string(from: now)

        let candidates = page.events.compactMap { event -> (AthleteFanEvent, SupporterEventTiming, Date?)? in
            guard event.status != "final" else { return nil }
            let start = event.parsedStart(timezone: page.timezone)

            if event.status == "live" {
                return (event, .live, start)
            }

            guard event.date >= today else { return nil }
            if event.date > today {
                return (event, .upcoming, start)
            }
            guard let start else {
                return event.status == "upcoming" ? (event, .upcoming, nil) : nil
            }
            if start >= now {
                return (event, .upcoming, start)
            }
            if now.timeIntervalSince(start) <= 3 * 60 * 60 {
                return (event, .live, start)
            }
            return nil
        }

        return candidates
            .sorted { left, right in
                if left.1 != right.1 {
                    return left.1 == .live
                }
                if let leftStart = left.2, let rightStart = right.2 {
                    return leftStart < rightStart
                }
                if left.2 != nil { return true }
                if right.2 != nil { return false }
                return left.0.date == right.0.date
                    ? left.0.time < right.0.time
                    : left.0.date < right.0.date
            }
            .first
            .map { (event: $0.0, timing: $0.1) }
    }
}
