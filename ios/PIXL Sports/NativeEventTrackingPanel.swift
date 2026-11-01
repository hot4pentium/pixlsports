import SwiftUI
import ClerkKit

@MainActor
struct NativeEventTrackingPanel: View {
    let event: AthleteFanEvent
    let teamName: String
    let athleteName: String
    let clerk: Clerk
    let hasActiveLiveTapsElsewhere: Bool
    @StateObject private var trackerModel: NativeEventToolModel
    @State private var showingTaps = false
    @State private var tapsVisited = false

    init(
        event: AthleteFanEvent,
        teamName: String,
        athleteName: String,
        clerk: Clerk,
        hasActiveLiveTapsElsewhere: Bool = false,
        model: NativeEventToolModel? = nil
    ) {
        self.event = event
        self.teamName = teamName
        self.athleteName = athleteName
        self.clerk = clerk
        self.hasActiveLiveTapsElsewhere = hasActiveLiveTapsElsewhere
        _trackerModel = StateObject(wrappedValue: model ?? NativeEventToolModel(
            shareToken: event.shareToken, accountID: clerk.user?.id ?? "signed-out"
        ))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            scorekeepingSection
                .eventToolVisibility(!showingTaps)
            fanEngagementSection
                .eventToolVisibility(!showingTaps)
            if tapsVisited {
                VStack(alignment: .leading, spacing: 14) {
                    Button {
                        showingTaps = false
                    } label: {
                        Label("Back to scorekeeping", systemImage: "arrow.left")
                            .frame(minHeight: 44)
                    }
                    .accessibilityIdentifier("native-event-mode-stats")
                    NativeEventFanAccessView(
                        event: event,
                        athleteName: athleteName,
                        clerk: clerk,
                        hasActiveLiveTapsElsewhere: hasActiveLiveTapsElsewhere
                    )
                }
                .eventToolVisibility(showingTaps)
            }
        }
        .tint(NativeEventToolColors.trackStats)
    }

    private var scorekeepingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SupporterEyebrow(text: "Scorekeeping", color: NativeEventToolColors.trackStats)
            NativeEventTrackerView(
                event: event, teamName: teamName, athleteName: athleteName,
                clerk: clerk, model: trackerModel, embedded: true, compact: true
            )
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(
                    colors: [NativeEventToolColors.trackStats.opacity(0.16), Color.white.opacity(0.035)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                in: RoundedRectangle(cornerRadius: 18, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(NativeEventToolColors.trackStats.opacity(0.35), lineWidth: 1)
            }
            .accessibilityIdentifier("native-event-scorekeeping-card")

            NavigationLink {
                NativeEventTrackerView(
                    event: event, teamName: teamName, athleteName: athleteName,
                    clerk: clerk, model: trackerModel
                )
            } label: {
                Label("Open full tracker", systemImage: "chart.bar.xaxis")
                    .font(.subheadline.weight(.bold))
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("native-event-full-tracker")
        }
        .accessibilityIdentifier("native-event-scorekeeping-section")
    }

    private var fanEngagementSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            SupporterEyebrow(text: "Fan engagement", color: NativeEventToolColors.trackStats)
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "hands.clap.fill")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(NativeEventToolColors.trackStats)
                        .frame(width: 44, height: 44)
                        .background(
                            NativeEventToolColors.trackStats.opacity(0.15),
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                        )
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 5) {
                        Text("Live Taps")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(.white)
                        Text("Give fans a cheer-only screen. It doesn’t change the score or player stats.")
                            .font(.subheadline)
                            .foregroundStyle(SupporterHomeColors.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    tapsVisited = true
                    showingTaps = true
                } label: {
                    HStack(spacing: 10) {
                        Text("Open Live Taps")
                            .font(.subheadline.weight(.bold))
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.right")
                            .font(.subheadline.weight(.bold))
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .padding(.horizontal, 12)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("native-event-mode-live-taps")
            }
            .padding(15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.16), lineWidth: 1)
            }
            .accessibilityIdentifier("native-event-live-taps-card")
        }
    }
}

extension View {
    /// Keep drafts, pending commands and the current fan QR alive when changing tools.
    func eventToolVisibility(_ visible: Bool) -> some View {
        self
            .frame(maxHeight: visible ? nil : 0)
            .opacity(visible ? 1 : 0)
            .clipped()
            .allowsHitTesting(visible)
            .accessibilityHidden(!visible)
    }
}
