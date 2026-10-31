import SwiftUI
import ClerkKit

@main
struct MyApp: App {
    private let configuration: Result<NativeClerkConfiguration, NativeClerkConfiguration.ConfigurationError>

    init() {
        configuration = NativeClerkConfiguration.load()
#if DEBUG
        if SupporterDashboardFixtures.isRequested
            || ProcessInfo.processInfo.arguments.contains("--ui-testing-live-taps")
            || ProcessInfo.processInfo.arguments.contains("--ui-testing-event-detail") {
            return
        }
#endif
        if case let .success(config) = configuration {
            Clerk.configure(publishableKey: config.publishableKey)
        }
    }

    var body: some Scene {
        WindowGroup {
#if DEBUG
            if SupporterDashboardFixtures.isRequested {
                SupporterDashboardFixtureView()
            } else if ProcessInfo.processInfo.arguments.contains("--ui-testing-live-taps") {
                NavigationStack {
                    SupporterLiveTapsView(
                        inviteToken: "ui-test-invite",
                        sport: "softball",
                        athleteName: "Jordan Example",
                        eventTitle: "Championship Showcase",
                        fixture: liveTapsFixture
                    )
                    .frame(maxWidth: 320)
                }
            } else if ProcessInfo.processInfo.arguments.contains("--ui-testing-event-detail") {
                NavigationStack {
                    SupporterEventDetailView(
                        clerk: nil,
                        shareToken: "ui-test-event",
                        fixture: SupporterEventDetailView.Fixture(
                            schedule: NativeSupporterSchedule(
                                status: "linked",
                                athleteName: "Jordan Example",
                                teamName: "PIXL Test Team",
                                seasonName: "Fall 2026",
                                timezone: "America/Los_Angeles",
                                events: []
                            ),
                            event: AthleteFanEvent(
                                shareToken: "ui-test-event",
                                eventId: "ui-test-event",
                                title: "Championship Showcase With an Extraordinarily Long Event Name",
                                date: "2026-11-14",
                                time: "18:30",
                                type: "game",
                                status: "live",
                                opponent: "The Visiting Team With a Very Long Name",
                                location: "Northwest Regional Athletic Complex, Field Twenty-Seven, Entrance C",
                                timezone: "America/Los_Angeles",
                                liveTapsActive: true,
                                liveTapsInviteToken: "ui-test-invite",
                                liveTapsSport: "softball"
                            )
                        )
                    )
                    .frame(maxWidth: 320)
                }
            } else {
                configuredRoot
            }
#else
            configuredRoot
#endif
        }
    }

#if DEBUG
    private var liveTapsFixture: SupporterLiveTapsView.Fixture {
        let state = ProcessInfo.processInfo.arguments
            .first(where: { $0.hasPrefix("--live-taps-state=") })?
            .replacingOccurrences(of: "--live-taps-state=", with: "") ?? "unauthorized"
        let cheers = [
            LiveTapCheer(key: "team-effort", label: "Amazing Team Effort", emoji: "👏", count: 12),
            LiveTapCheer(key: "thumbs-up", label: "Thumbs Up", emoji: "👍", count: 8)
        ]
        if state == "error" {
            return .init(
                summary: nil,
                accessToken: nil,
                error: "The connection timed out. Try again to check this Event Card’s active session."
            )
        }
        return .init(
            summary: LiveTapSummary(active: true, gameId: "fictional-game", cheers: cheers),
            accessToken: state == "authorized" ? "fictional-access-token" : nil,
            error: nil
        )
    }
#endif

    @ViewBuilder
    private var configuredRoot: some View {
        switch configuration {
        case .success:
            NativeAuthRootView()
                .environment(Clerk.shared)
        case let .failure(error):
            NativeAuthSetupView(message: error.localizedDescription)
        }
    }
}
