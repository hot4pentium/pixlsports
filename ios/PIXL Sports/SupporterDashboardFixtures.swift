#if DEBUG
import SwiftUI

/// Local fictional content only. These screens cannot request account or schedule data.
@MainActor
enum SupporterDashboardFixtures {
    static var isRequested: Bool {
        ProcessInfo.processInfo.arguments.contains("--ui-testing-dashboard")
    }

    static var state: SupporterHomeViewModel.State {
        let arguments = ProcessInfo.processInfo.arguments
        let name = arguments.first(where: { $0.hasPrefix("--dashboard-state=") })?
            .replacingOccurrences(of: "--dashboard-state=", with: "") ?? "upcoming"
        switch name {
        case "loading": return .loading
        case "unlinked": return .notConnected
        case "error": return .failed("Check your internet connection, then try again.")
        case "empty": return .schedule(page: page, events: [], pastEvents: [])
        case "guide-upcoming", "guide-live", "guide-postgame":
            let game = guideGame
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
        default:
            let timing: SupporterEventTiming = name == "live" ? .live : .upcoming
            let events = [
                event("next", day: "14", status: name == "live" ? "live" : "upcoming"),
                event("later", day: "21", status: "upcoming"),
                event("third", day: "28", status: "upcoming")
            ]
            return .schedule(
                page: page(events: events),
                events: [
                    SupporterScheduleItem(event: events[0], timing: timing, start: nil),
                    SupporterScheduleItem(event: events[1], timing: .upcoming, start: nil),
                    SupporterScheduleItem(event: events[2], timing: .upcoming, start: nil)
                ],
                pastEvents: [
                    SupporterScheduleItem(event: event("past", day: "07", status: "final"), timing: .complete, start: nil)
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
            "guide-upcoming": "2026-11-14T02:29:00Z",
            "guide-live": "2026-11-14T02:30:00Z",
            "guide-postgame": "2026-11-14T05:31:00Z"
        ]
        guard let timestamp = timestamps[state] else { return nil }
        return ISO8601DateFormatter().date(from: timestamp)
    }

    private static var guideGame: AthleteFanEvent {
        AthleteFanEvent(
            shareToken: "fictional-guide-game",
            eventId: "fictional-guide-game",
            title: "Championship Showcase With a Long Event Name",
            date: "2026-11-13",
            time: "18:30",
            type: "game",
            status: "upcoming",
            opponent: "The Visiting Team With a Very Long Name",
            location: "Northwest Regional Athletic Complex, Field Twenty-Seven, Entrance C",
            timezone: "America/Los_Angeles",
            liveTapsActive: false,
            liveTapsInviteToken: nil,
            liveTapsSport: nil
        )
    }

    private static func page(events: [AthleteFanEvent] = []) -> NativeSupporterSchedule {
        NativeSupporterSchedule(
            status: "linked",
            athleteName: "Jordan Example With a Long Athlete Name",
            teamName: "Northwest Regional Athletic Club",
            seasonName: "Autumn Championship Season",
            timezone: "America/Los_Angeles",
            events: events
        )
    }

    private static func event(
        _ id: String,
        day: String,
        status: String,
        type: String = "game"
    ) -> AthleteFanEvent {
        AthleteFanEvent(
            shareToken: "fictional-\(id)",
            eventId: "fictional-\(id)",
            title: "Championship Showcase With a Long Event Name",
            date: "2026-11-\(day)",
            time: "18:30",
            type: type,
            status: status,
            opponent: "The Visiting Team With a Very Long Name",
            location: "Northwest Regional Athletic Complex, Field Twenty-Seven, Entrance C",
            timezone: "America/Los_Angeles",
            liveTapsActive: false,
            liveTapsInviteToken: nil,
            liveTapsSport: nil
        )
    }
}

struct SupporterDashboardFixtureView: View {
    @State private var showingConnection = false

    var body: some View {
        ContentView(
            fixtureState: SupporterDashboardFixtures.state,
            showingAccountLink: $showingConnection
        )
        .frame(maxWidth: ProcessInfo.processInfo.arguments.contains("--dashboard-narrow") ? 320 : .infinity)
        .sheet(isPresented: $showingConnection) {
            NavigationStack {
                Text("Fictional account connection preview. No account is accessed.")
                    .padding()
                    .accessibilityIdentifier("dashboard-fixture-connection")
                    .navigationTitle("PIXL connection preview")
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showingConnection = false }
                        }
                    }
            }
        }
    }
}
#endif
