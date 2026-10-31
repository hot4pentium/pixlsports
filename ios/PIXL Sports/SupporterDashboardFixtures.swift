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
        default:
            let timing: SupporterEventTiming = name == "live" ? .live : .upcoming
            return .schedule(
                page: page,
                events: [
                    SupporterScheduleItem(event: event("next", day: "14", status: name == "live" ? "live" : "upcoming"), timing: timing, start: nil),
                    SupporterScheduleItem(event: event("later", day: "21", status: "upcoming"), timing: .upcoming, start: nil),
                    SupporterScheduleItem(event: event("third", day: "28", status: "upcoming"), timing: .upcoming, start: nil)
                ],
                pastEvents: [
                    SupporterScheduleItem(event: event("past", day: "07", status: "final"), timing: .complete, start: nil)
                ]
            )
        }
    }

    private static var page: NativeSupporterSchedule {
        NativeSupporterSchedule(
            status: "linked",
            athleteName: "Jordan Example With a Long Athlete Name",
            teamName: "Northwest Regional Athletic Club",
            seasonName: "Autumn Championship Season",
            timezone: "America/Los_Angeles",
            events: []
        )
    }

    private static func event(_ id: String, day: String, status: String) -> AthleteFanEvent {
        AthleteFanEvent(
            shareToken: "fictional-\(id)",
            eventId: "fictional-\(id)",
            title: "Championship Showcase With a Long Event Name",
            date: "2026-11-\(day)",
            time: "18:30",
            type: "game",
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
