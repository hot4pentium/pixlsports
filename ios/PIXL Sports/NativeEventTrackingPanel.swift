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
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                SupporterEyebrow(text: "Scoreboard", color: SupporterHomeColors.blue)
                VStack(alignment: .leading, spacing: 14) {
                    NativeEventTrackerView(
                        event: event, teamName: teamName, athleteName: athleteName,
                        clerk: clerk, model: trackerModel, embedded: true, compact: true
                    )
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    LinearGradient(
                        colors: [SupporterHomeColors.blue.opacity(0.12), Color.white.opacity(0.035)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(SupporterHomeColors.blue.opacity(0.24), lineWidth: 1)
                }
                .accessibilityIdentifier("native-event-scorekeeping-card")

                VStack(spacing: 9) {
                    Button {
                        tapsVisited = true
                        showingTaps = true
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "hands.clap.fill")
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Open Live Taps")
                                    .font(.subheadline.weight(.bold))
                                Text("Let fans cheer from their phones")
                                    .font(.caption.weight(.medium))
                                    .opacity(0.86)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.right")
                                .font(.subheadline.weight(.bold))
                        }
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .padding(.horizontal, 12)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(SupporterHomeColors.blue)
                    .accessibilityIdentifier("native-event-mode-live-taps")
                    NavigationLink {
                        NativeEventTrackerView(
                            event: event, teamName: teamName, athleteName: athleteName,
                            clerk: clerk, model: trackerModel
                        )
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "chart.bar.xaxis")
                            Text("Open full tracker")
                            Spacer(minLength: 0)
                            Image(systemName: "arrow.up.right")
                        }
                        .font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .padding(.horizontal, 12)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("native-event-full-tracker")
                }
                .eventToolVisibility(!showingTaps)
            }
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
