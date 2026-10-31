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
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 14) {
                    NativeEventTrackerView(
                        event: event, teamName: teamName, athleteName: athleteName,
                        clerk: clerk, model: trackerModel, embedded: true, compact: true
                    )
                    Button {
                        tapsVisited = true
                        showingTaps = true
                    } label: {
                        Label("Access Live Taps", systemImage: "hands.clap")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("native-event-mode-live-taps")
                    NavigationLink {
                        NativeEventTrackerView(
                            event: event, teamName: teamName, athleteName: athleteName,
                            clerk: clerk, model: trackerModel
                        )
                    } label: {
                        Label("Open full tracker", systemImage: "arrow.up.left.and.arrow.down.right")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .accessibilityIdentifier("native-event-full-tracker")
                    Text("Keep score here, or open the full tracker to record player stats.")
                        .font(.caption).foregroundStyle(SupporterHomeColors.muted)
                }
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
