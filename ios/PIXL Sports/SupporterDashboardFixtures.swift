#if DEBUG
import SwiftUI
import Combine

/// Local fictional content only. These screens cannot request account or schedule data.
@MainActor
enum SupporterDashboardFixtures {
    static let clock = SupporterDashboardClock(initialDate: fixedGuideNow ?? Date())

    static var isRequested: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-testing-dashboard")
    }

    static var isClockControlled: Bool {
        ProcessInfo.processInfo.arguments.contains("--dashboard-state=guide-close-events-clock")
    }

    static func state(now: Date? = nil) -> SupporterHomeViewModel.State {
        let arguments = ProcessInfo.processInfo.arguments
        let name = arguments.first(where: { $0.hasPrefix("--dashboard-state=") })?
            .replacingOccurrences(of: "--dashboard-state=", with: "") ?? "upcoming"
        switch name {
        case "loading": return .loading
        case "unlinked": return .notConnected
        case "error": return .failed("Check your internet connection, then try again.")
        case "empty": return .schedule(page: page(), events: [], pastEvents: [])
        case "guide-practice-upcoming":
            let practice = event("guide-practice", day: "15", status: "upcoming", type: "practice")
            let schedulePage = page(events: [practice])
            return .schedule(
                page: schedulePage,
                events: [SupporterScheduleItem(event: practice, timing: .upcoming, start: practice.parsedStart(timezone: practice.timezone))],
                pastEvents: []
            )
        case "guide-upcoming", "guide-live", "guide-postgame", "guide-future-live", "guide-future-final":
            let gameStatus: String
            switch name {
            case "guide-future-live": gameStatus = "live"
            case "guide-future-final": gameStatus = "final"
            default: gameStatus = "upcoming"
            }
            let game = guideGame(status: gameStatus)
            let practice = event("guide-practice", day: "15", status: "upcoming", type: "practice")
            let schedulePage = page(events: [game, practice])
            return .schedule(
                page: schedulePage,
                events: [
                    SupporterScheduleItem(event: game, timing: .upcoming, start: game.parsedStart(timezone: game.timezone)),
                    SupporterScheduleItem(event: practice, timing: .upcoming, start: practice.parsedStart(timezone: practice.timezone))
                ],
                pastEvents: []
            )
        case "guide-after-share-window":
            let game = guideGame(status: "final")
            let practice = event("guide-next-practice", day: "15", status: "upcoming", type: "practice")
            return .schedule(
                page: page(events: [game, practice], timezone: "America/New_York"),
                events: [
                    SupporterScheduleItem(event: game, timing: .complete, start: game.parsedStart(timezone: game.timezone)),
                    SupporterScheduleItem(event: practice, timing: .upcoming, start: practice.parsedStart(timezone: practice.timezone))
                ],
                pastEvents: []
            )
        case "guide-close-events-before-pregame", "guide-close-events-pregame", "guide-close-events-clock":
            let clockBoundaryFixture = name == "guide-close-events-clock"
            let earlier = guideGame(
                status: "live",
                id: "fictional-close-earlier",
                title: clockBoundaryFixture ? "Earlier 7:05 Game" : "Earlier 6:30 Game",
                date: "2026-11-08",
                time: clockBoundaryFixture ? "19:05" : "18:30",
                timezone: "America/New_York"
            )
            // Deliberately stale status: the scheduled time remains authoritative.
            let next = guideGame(
                status: "final",
                id: "fictional-close-next",
                title: "Next 7:15 Game",
                date: "2026-11-08",
                time: "19:15",
                timezone: "America/New_York"
            )
            let referenceDate = now ?? fixedGuideNow ?? Date()
            return .schedule(
                page: page(events: [earlier, next], timezone: "America/New_York"),
                events: [earlier, next].compactMap { scheduledGameItem($0, now: referenceDate) },
                pastEvents: []
            )
        case "guide-close-events-history":
            let completed = guideGame(
                status: "final",
                id: "fictional-close-completed",
                title: "Completed 6:30 Game",
                date: "2026-11-08",
                time: "18:30",
                timezone: "America/New_York"
            )
            // The future card's stale status must not prevent it becoming Up Next.
            let next = guideGame(
                status: "final",
                id: "fictional-close-next",
                title: "Next 9:05 Game",
                date: "2026-11-08",
                time: "21:05",
                timezone: "America/New_York"
            )
            let now = fixedGuideNow ?? Date()
            return .schedule(
                page: page(events: [completed, next], timezone: "America/New_York"),
                events: [scheduledGameItem(next, now: now)].compactMap { $0 },
                pastEvents: [
                    SupporterScheduleItem(
                        event: completed,
                        timing: .complete,
                        start: completed.parsedStart(timezone: completed.timezone)
                    )
                ]
            )
        case "guide-reschedule":
            let target = guideGame(
                status: "upcoming",
                id: "fictional-reschedule-target",
                title: "Target Event Card",
                date: "2026-11-08",
                time: "19:10",
                timezone: "America/New_York"
            )
            let next = guideGame(
                status: "upcoming",
                id: "fictional-reschedule-next",
                title: "Next Event Card",
                date: "2026-11-08",
                time: "19:15",
                timezone: "America/New_York"
            )
            let completed = guideGame(
                status: "final",
                id: "fictional-reschedule-completed",
                title: "Completed Card With Saved Stats",
                date: "2026-11-07",
                time: "18:30",
                timezone: "America/New_York"
            )
            let schedulePage = page(
                events: [target, next, completed],
                timezone: "America/New_York"
            )
            let now = fixedGuideNow ?? Date()
            return .schedule(
                page: schedulePage,
                events: SupporterHomeViewModel.upcomingEvents(in: schedulePage, now: now),
                pastEvents: [
                    SupporterScheduleItem(
                        event: completed,
                        timing: .complete,
                        start: completed.parsedStart(timezone: completed.timezone)
                    )
                ]
            )
        default:
            let timing: SupporterEventTiming = name == "live" ? .live : .upcoming
            let events = [
                event("next", day: "14", status: name == "live" ? "live" : "upcoming"),
                event("later", day: "21", status: "upcoming"),
                event("third", day: "28", status: "upcoming")
            ]
            let past = event("past", day: "31", date: "2025-10-31", status: "upcoming")
            return .schedule(
                page: page(events: events + [past]),
                events: [
                    SupporterScheduleItem(event: events[0], timing: timing, start: nil),
                    SupporterScheduleItem(event: events[1], timing: .upcoming, start: nil),
                    SupporterScheduleItem(event: events[2], timing: .upcoming, start: nil)
                ],
                pastEvents: [
                    SupporterScheduleItem(event: past, timing: .complete, start: past.parsedStart(timezone: past.timezone))
                ]
            )
        }
    }

    static var fixedGuideNow: Date? {
        guard let state = ProcessInfo.processInfo.arguments
            .first(where: { $0.hasPrefix("--dashboard-state=") })?
            .replacingOccurrences(of: "--dashboard-state=", with: "") else {
            return nil
        }
        let timestamps: [String: String] = [
            "guide-upcoming": "2026-11-14T00:29:00Z",
            "guide-future-live": "2026-11-14T00:29:00Z",
            "guide-future-final": "2026-11-14T00:29:00Z",
            "guide-after-share-window": "2026-11-14T06:29:00Z",
            "guide-practice-upcoming": "2026-11-14T00:29:00Z",
            "guide-live": "2026-11-14T02:30:00Z",
            "guide-postgame": "2026-11-14T04:00:00Z",
            "guide-close-events-before-pregame": "2026-11-09T00:04:59Z",
            "guide-close-events-pregame": "2026-11-09T00:05:00Z",
            "guide-close-events-clock": "2026-11-09T00:04:59Z",
            "guide-close-events-history": "2026-11-09T01:55:00Z",
            "guide-reschedule": "2026-11-08T23:59:00Z"
        ]
        guard let timestamp = timestamps[state] else { return nil }
        return ISO8601DateFormatter().date(from: timestamp)
    }

    private static func guideGame(
        status: String = "upcoming",
        id: String = "fictional-guide-game",
        title: String = "Championship Showcase With a Long Event Name",
        date: String = "2026-11-13",
        time: String = "18:30",
        timezone: String = "America/Los_Angeles"
    ) -> AthleteFanEvent {
        AthleteFanEvent(
            shareToken: id,
            eventId: id,
            title: title,
            date: date,
            time: time,
            type: "game",
            status: status,
            opponent: "The Visiting Team With a Very Long Name",
            location: "Northwest Regional Athletic Complex, Field Twenty-Seven, Entrance C",
            timezone: timezone,
            liveTapsActive: false,
            liveTapsOnly: false,
            liveTapsInviteToken: nil,
            liveTapsSport: nil
        )
    }

    private static func scheduledGameItem(
        _ event: AthleteFanEvent,
        now: Date
    ) -> SupporterScheduleItem? {
        let eventTimeZone = TimeZone(identifier: event.timezone ?? "") ?? .current
        let start = event.parsedStart(timezone: eventTimeZone.identifier)
        guard let recommendation = NativeEventGuideTiming.gameRecommendation(
            eventDate: event.date,
            start: start,
            timeZone: eventTimeZone,
            now: now
        ), recommendation != .share else {
            return nil
        }
        return SupporterScheduleItem(
            event: event,
            timing: SupporterHomeViewModel.dashboardCardTiming(
                for: recommendation,
                start: start,
                now: now
            ),
            start: start
        )
    }

    private static func page(
        events: [AthleteFanEvent] = [],
        timezone: String = "America/Los_Angeles"
    ) -> NativeSupporterSchedule {
        NativeSupporterSchedule(
            status: "linked",
            athleteName: "Jordan Example With a Long Athlete Name",
            teamName: "Northwest Regional Athletic Club",
            seasonName: "Autumn Championship Season",
            timezone: timezone,
            events: events,
            record: NativeSeasonRecord(
                wins: 2, losses: 1, ties: 1, gamesPlayed: 4,
                sport: "soccer", seasonName: "Autumn Championship Season"
            )
        )
    }

    private static func event(
        _ id: String,
        day: String,
        date: String? = nil,
        status: String,
        type: String = "game"
    ) -> AthleteFanEvent {
        AthleteFanEvent(
            shareToken: "fictional-\(id)",
            eventId: "fictional-\(id)",
            title: "Championship Showcase With a Long Event Name",
            date: date ?? "2026-11-\(day)",
            time: "18:30",
            type: type,
            status: status,
            opponent: "The Visiting Team With a Very Long Name",
            location: "Northwest Regional Athletic Complex, Field Twenty-Seven, Entrance C",
            timezone: "America/Los_Angeles",
            liveTapsActive: false,
            liveTapsOnly: false,
            liveTapsInviteToken: nil,
            liveTapsSport: nil
        )
    }
}

@MainActor
final class NativeEventCardRescheduleUITestFixture: ObservableObject {
    static var isRequested: Bool {
        ProcessInfo.processInfo.arguments.contains("--dashboard-state=guide-reschedule")
    }

    static let shared = NativeEventCardRescheduleUITestFixture()

    @Published private(set) var state = SupporterDashboardFixtures.state()

    @discardableResult
    func save(_ draft: NativeEventCardDraft) -> Bool {
        guard case let .schedule(page, _, pastEvents) = state,
              page.events.contains(where: { $0.eventId == draft.id }) else {
            return false
        }

        let updatedEvents = page.events.map { event in
            guard event.eventId == draft.id else { return event }
            return AthleteFanEvent(
                shareToken: event.shareToken,
                eventId: event.eventId,
                title: event.title,
                date: draft.date,
                time: draft.time,
                type: draft.type,
                status: event.status,
                opponent: draft.opponent,
                location: draft.location,
                timezone: draft.timezone,
                liveTapsActive: event.liveTapsActive,
                liveTapsOnly: event.liveTapsOnly,
                liveTapsInviteToken: event.liveTapsInviteToken,
                liveTapsSport: event.liveTapsSport
            )
        }
        let updatedPage = NativeSupporterSchedule(
            status: page.status,
            athleteName: page.athleteName,
            teamName: page.teamName,
            seasonName: page.seasonName,
            timezone: page.timezone,
            events: updatedEvents,
            record: page.record,
            linkId: page.linkId
        )
        let now = SupporterDashboardFixtures.fixedGuideNow ?? Date()
        state = .schedule(
            page: updatedPage,
            events: SupporterHomeViewModel.upcomingEvents(in: updatedPage, now: now),
            pastEvents: pastEvents
        )
        return true
    }
}

@MainActor
final class SupporterDashboardClock: ObservableObject {
    @Published private(set) var now: Date

    init(initialDate: Date) {
        now = initialDate
    }

    func advanceToTenMinuteWindow() {
        now = now.addingTimeInterval(1)
    }
}

struct SupporterDashboardFixtureView: View {
    @State private var showingConnection = false

    var body: some View {
        ContentView(
            fixtureState: SupporterDashboardFixtures.state(),
            showingAccountLink: $showingConnection,
            showingSettings: .constant(false)
        )
        .frame(maxWidth: ProcessInfo.processInfo.arguments.contains("--dashboard-narrow") ? 320 : .infinity)
        .safeAreaInset(edge: .bottom) {
            if SupporterDashboardFixtures.isClockControlled {
                HStack {
                    Spacer()
                    Button("Advance to ten-minute window") {
                        SupporterDashboardFixtures.clock.advanceToTenMinuteWindow()
                    }
                    .font(.caption.weight(.semibold))
                    .padding(8)
                    .background(.white, in: Capsule())
                }
                .padding(8)
                .accessibilityIdentifier("dashboard-fixture-advance-clock")
            }
        }
        .sheet(isPresented: $showingConnection) {
            NavigationStack {
                Text("Fictional account connection preview. No account is accessed.")
                    .padding()
                    .accessibilityIdentifier("dashboard-fixture-connection")
                    .navigationTitle("PIXL connection preview")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button {
                                showingConnection = false
                            } label: {
                                Text("Done").nativeToolbarLabel()
                            }
                        }
                    }
            }
        }
    }
}

@MainActor
final class NativeFanBaseRefreshUITestFixture: ObservableObject {
    static var isRequested: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-testing-fan-base-refresh")
    }

    @Published private(set) var fanBase: NativeSupporterFanBase?
    @Published private(set) var isLoading = false
    @Published private(set) var error: String?
    @Published private(set) var isOnline: Bool
    private var authoritativeFanBase = NativeSupporterFanBase(
        totalFollows: 3,
        namedFans: ["Casey"],
        anonymousFollows: 2
    )

    private let unavailableMessage =
        "The latest Fan Base count couldn’t be loaded, so no current count is shown. Check your connection and try again."

    init(startLoaded: Bool) {
        isOnline = startLoaded
        if startLoaded {
            fanBase = authoritativeFanBase
        } else {
            fanBase = nil
            error = unavailableMessage
        }
    }

    func restoreConnection() {
        isOnline = true
    }

    func simulateRemoteFollowChange() {
        if authoritativeFanBase.totalFollows == 3 {
            authoritativeFanBase = NativeSupporterFanBase(
                totalFollows: 4,
                namedFans: authoritativeFanBase.namedFans,
                anonymousFollows: 3
            )
        } else {
            authoritativeFanBase = NativeSupporterFanBase(
                totalFollows: 3,
                namedFans: ["Casey"],
                anonymousFollows: 2
            )
        }
    }

    func makeNextRefreshFail() {
        isOnline = false
    }

    func refresh() async {
        fanBase = nil
        error = nil
        isLoading = true
        guard isOnline else {
            isLoading = false
            error = unavailableMessage
            return
        }
        try? await Task.sleep(for: .milliseconds(150))
        guard isOnline else {
            isLoading = false
            error = unavailableMessage
            return
        }
        fanBase = authoritativeFanBase
        isLoading = false
    }

    func retry() {
        Task { await refresh() }
    }
}

struct NativeFanBaseRefreshFixtureView: View {
    @StateObject private var fixture: NativeFanBaseRefreshUITestFixture
    @State private var showingConnection = false

    init() {
        let startsLoaded = ProcessInfo.processInfo.arguments.contains("--fan-base-start-loaded")
        _fixture = StateObject(
            wrappedValue: NativeFanBaseRefreshUITestFixture(startLoaded: startsLoaded)
        )
    }

    var body: some View {
        ContentView(
            fixtureState: SupporterDashboardFixtures.state(),
            fanBaseRefreshFixture: fixture,
            showingAccountLink: $showingConnection,
            showingSettings: .constant(false)
        )
    }
}
#endif
