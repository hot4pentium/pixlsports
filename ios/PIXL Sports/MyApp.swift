import SwiftUI
import ClerkKit

private struct NativePublicHypeCardRoute: Identifiable {
    let id = UUID()
    let inviteToken: String
}

@main
struct MyApp: App {
#if os(iOS)
    @UIApplicationDelegateAdaptor(NativePushAppDelegate.self) private var pushAppDelegate
#endif
    private let configuration: Result<NativeClerkConfiguration, NativeClerkConfiguration.ConfigurationError>
    @State private var publicHypeCardRoute: NativePublicHypeCardRoute?

    init() {
        configuration = NativeClerkConfiguration.load()
#if DEBUG
        if SupporterDashboardFixtures.isRequested
            || ProcessInfo.processInfo.arguments.contains("--ui-testing-launch-splash")
            || ProcessInfo.processInfo.arguments.contains("--ui-testing-launch-splash-error")
            || ProcessInfo.processInfo.arguments.contains("--ui-testing-live-taps")
            || ProcessInfo.processInfo.arguments.contains("--ui-testing-event-detail")
            || ProcessInfo.processInfo.arguments.contains("--ui-testing-shared-hype-card")
            || NativeEventCardCreateRetryUITestFixture.isRequested
            || NativeFanBaseRefreshUITestFixture.isRequested {
            return
        }
#endif
        if case let .success(config) = configuration {
            Clerk.configure(publishableKey: config.publishableKey)
        }
    }

    var body: some Scene {
        WindowGroup {
            Group {
#if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--ui-testing-launch-splash-error") {
                    NativeLaunchSplashView(
                        errorTitle: "We couldn’t get PIXL ready",
                        errorMessage: "Check your connection, then try again.",
                        onRetry: {}
                    )
                } else if ProcessInfo.processInfo.arguments.contains("--ui-testing-launch-splash") {
                    NativeLaunchSplashView()
                } else if SupporterDashboardFixtures.isRequested {
                    SupporterDashboardFixtureView()
                } else if NativeFanBaseRefreshUITestFixture.isRequested {
                    NativeFanBaseRefreshFixtureView()
                } else if ProcessInfo.processInfo.arguments.contains("--ui-testing-shared-hype-card") {
                    NativePublicHypeCardRecipientView(fixtureCard: sharedHypeCardFixture, onClose: {})
                } else if NativeEventCardCreateRetryUITestFixture.isRequested {
                    NavigationStack {
                        NativeCreateEventCardView(
                            athleteName: "Jordan Example",
                            teamName: "PIXL Test Team",
                            seasonName: "Fall 2026",
                            initialTimezone: "America/Los_Angeles",
                            clerk: nil,
                            onCreated: { _ in }
                        )
                    }
                } else if let publicHypeCardRoute {
                    NativePublicHypeCardRecipientView(inviteToken: publicHypeCardRoute.inviteToken) {
                        self.publicHypeCardRoute = nil
                    }
                    .id(publicHypeCardRoute.id)
                } else if ProcessInfo.processInfo.arguments.contains("--ui-testing-create-event-card") {
                    NavigationStack {
                        NativeCreateEventCardView(
                            athleteName: "Jordan Example",
                            teamName: "",
                            seasonName: "Fall 2026",
                            initialTimezone: "America/Los_Angeles",
                            clerk: nil,
                            onCreated: { _ in }
                        )
                    }
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
                        if NativeEventWorkspaceUITestFixture.isRequested {
                            NavigationLink("Open test Event Card") {
                                eventDetailFixture
                            }
                            .accessibilityIdentifier("prep-test-open-event")
                            .navigationTitle("Test workspace")
                        } else {
                            eventDetailFixture
                        }
                    }
                } else {
                    configuredRoot
                }
#else
                if let publicHypeCardRoute {
                    NativePublicHypeCardRecipientView(inviteToken: publicHypeCardRoute.inviteToken) {
                        self.publicHypeCardRoute = nil
                    }
                    .id(publicHypeCardRoute.id)
                } else {
                    configuredRoot
                }
#endif
            }
            .onOpenURL(perform: handleIncomingURL)
        }
    }

#if DEBUG
    private var sharedHypeCardFixture: NativePublicHypeCard {
        NativePublicHypeCard(
            athleteName: "Jordan Example",
            teamName: "PIXL Test Team",
            seasonName: "Fall 2026",
            sport: "soccer",
            photoUrl: nil,
            cutoutUrl: nil,
            favoriteMoment: nil,
            showEvents: false,
            hypeCard: nil,
            videos: [],
            stats: nil,
            events: [],
            shareURL: nil,
            inviteToken: "ui-test-shared-card"
        )
    }

    private var eventDetailFixture: some View {
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
                                type: ProcessInfo.processInfo.arguments.contains("--event-detail-practice") ? "practice" : "game",
                                status: "live",
                                opponent: "The Visiting Team With a Very Long Name",
                                location: "Northwest Regional Athletic Complex, Field Twenty-Seven, Entrance C",
                                timezone: "America/Los_Angeles",
                                liveTapsActive: true,
                                liveTapsOnly: true,
                                liveTapsInviteToken: "ui-test-invite",
                                liveTapsSport: "softball"
                            ),
                            prep: NativeEventWorkspaceUITestFixture.isRequested
                                ? NativeEventWorkspaceUITestFixture.shared.workspace.prep
                                : .init(items: [], notes: "")
                        )
                    )
                    .frame(maxWidth: ProcessInfo.processInfo.arguments.contains("--event-detail-full-width") ? .infinity : 320)
    }

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

    private func handleIncomingURL(_ url: URL) {
        guard let origin = try? NativeAccountLinkClient.apiOrigin(),
              let token = NativeHypeCardUniversalLink.inviteToken(from: url, allowedOrigin: origin) else {
            return
        }
        publicHypeCardRoute = NativePublicHypeCardRoute(inviteToken: token)
    }

    @ViewBuilder
    private var configuredRoot: some View {
        switch configuration {
        case .success:
#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--diagnose-startup") {
                // Unlike the forced splash fixture, normal Clerk.configure
                // has already run. Do not construct the app root until asked.
                NativeStartupDiagnosticView()
                    .environment(Clerk.shared)
            } else {
                NativeAuthRootView()
                    .environment(Clerk.shared)
            }
#else
            NativeAuthRootView()
                .environment(Clerk.shared)
#endif
        case let .failure(error):
            NativeAuthSetupView(message: error.localizedDescription)
        }
    }
}
