import SwiftUI
import ClerkKit

@MainActor
struct NativeEventTrackingPanel: View {
    let event: AthleteFanEvent
    let teamName: String
    let athleteName: String
    let clerk: Clerk
    @StateObject private var trackerModel: NativeEventToolModel
    @State private var showingTaps: Bool?
    @State private var tapsVisited = false

    init(event: AthleteFanEvent, teamName: String, athleteName: String, clerk: Clerk, model: NativeEventToolModel? = nil) {
        self.event = event
        self.teamName = teamName
        self.athleteName = athleteName
        self.clerk = clerk
        _trackerModel = StateObject(wrappedValue: model ?? NativeEventToolModel(
            shareToken: event.shareToken, accountID: clerk.user?.id ?? "signed-out"
        ))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                modeButton("Track Stats", icon: "chart.bar", taps: false)
                modeButton("Live Taps only", icon: "hands.clap", taps: true)
            }
            if showingTaps == nil {
                Text("Choose game statistics or cheers only. Live Taps does not record player stats.")
                    .font(.caption)
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 14) {
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
                    Text("Quick tracking · Full tracker includes every stat and recent play history.")
                        .font(.caption).foregroundStyle(SupporterHomeColors.muted)
                    NativeEventTrackerView(
                        event: event, teamName: teamName, athleteName: athleteName,
                        clerk: clerk, model: trackerModel, embedded: true, compact: true
                    )
                }
                .eventToolVisibility(showingTaps == false)
                if tapsVisited {
                    NativeEventFanAccessView(event: event, athleteName: athleteName, clerk: clerk)
                        .eventToolVisibility(showingTaps == true)
                }
            }
        }
    }

    private func modeButton(_ title: String, icon: String, taps: Bool) -> some View {
        Button {
            showingTaps = taps
            if taps { tapsVisited = true }
        } label: {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.bold))
                .frame(maxWidth: .infinity, minHeight: 48)
                .background(showingTaps == taps ? SupporterHomeColors.blue.opacity(0.35) : Color.white.opacity(0.05),
                            in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(showingTaps == taps ? .isSelected : [])
        .accessibilityIdentifier(taps ? "native-event-mode-live-taps" : "native-event-mode-stats")
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
