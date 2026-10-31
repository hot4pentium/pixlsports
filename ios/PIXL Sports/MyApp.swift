import SwiftUI
import ClerkKit

@main
struct MyApp: App {
    private let configuration: Result<NativeClerkConfiguration, NativeClerkConfiguration.ConfigurationError>

    init() {
        configuration = NativeClerkConfiguration.load()
#if DEBUG
        if SupporterDashboardFixtures.isRequested
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
