import SwiftUI
import ClerkKit

@MainActor
struct NativeEventToolPanel: View {
    let schedule: NativeSupporterSchedule
    let event: AthleteFanEvent
    let clerk: Clerk?
    let selected: NativeEventDetailStep
    let fixturePrep: NativeEventWorkspace.Prep?
    let onDirtyChange: (Bool) -> Void
    @StateObject private var workspaceModel: NativeEventToolModel
    @State private var prepVisited = false
    @State private var trackingVisited = false
    @State private var shareVisited = false

    init(schedule: NativeSupporterSchedule, event: AthleteFanEvent, clerk: Clerk?,
         selected: NativeEventDetailStep, fixturePrep: NativeEventWorkspace.Prep?,
         onDirtyChange: @escaping (Bool) -> Void) {
        self.schedule = schedule
        self.event = event
        self.clerk = clerk
        self.selected = selected
        self.fixturePrep = fixturePrep
        self.onDirtyChange = onDirtyChange
#if DEBUG
        if NativeEventWorkspaceUITestFixture.isRequested {
            _workspaceModel = StateObject(wrappedValue: NativeEventToolModel(uiTestFixture: .shared))
            return
        }
#endif
        _workspaceModel = StateObject(wrappedValue: NativeEventToolModel(
            shareToken: event.shareToken, accountID: clerk?.user?.id ?? "signed-out"
        ))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(selected.title)
                .font(.title3.weight(.heavy))
                .foregroundStyle(SupporterHomeColors.accent)
            if usesUITestWorkspace {
                uiTestPrepPanel
            } else if let clerk {
                VStack(spacing: 0) {
                    if prepVisited || selected == .prep {
                        NativeEventPrepView(event: event, clerk: clerk, model: workspaceModel,
                                            embedded: true, onDirtyChange: onDirtyChange)
                            .eventToolVisibility(selected == .prep)
                    }
                    if event.type == "game", trackingVisited || selected == .trackStats {
                        NativeEventTrackingPanel(
                            event: event, teamName: schedule.teamName ?? "Your team",
                            athleteName: schedule.athleteName ?? "Your athlete", clerk: clerk, model: workspaceModel
                        )
                        .eventToolVisibility(selected == .trackStats)
                    }
                    if shareVisited || selected == .share {
                        NativeEventShareView(schedule: schedule, event: event, clerk: clerk, embedded: true)
                            .eventToolVisibility(selected == .share)
                    }
                }
            } else if selected == .prep, let fixturePrep {
                NativeEventPrepSummaryView(shareToken: event.shareToken, clerk: nil, fixturePrep: fixturePrep)
            } else {
                Text("Sign in to use this event’s native tools.")
                    .foregroundStyle(SupporterHomeColors.muted)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .foregroundStyle(.white)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 22))
        .overlay {
            RoundedRectangle(cornerRadius: 22).strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
        }
        .accessibilityIdentifier("event-detail-tool-panel")
        .onAppear { rememberSelection() }
        .onChange(of: selected) { _, _ in rememberSelection() }
    }

    private var usesUITestWorkspace: Bool {
#if DEBUG
        return NativeEventWorkspaceUITestFixture.isRequested
#else
        return false
#endif
    }

    @ViewBuilder
    private var uiTestPrepPanel: some View {
#if DEBUG
        if prepVisited || selected == .prep {
            NativeEventPrepView(event: event, uiTestFixture: .shared, model: workspaceModel,
                                embedded: true, onDirtyChange: onDirtyChange)
                .eventToolVisibility(selected == .prep)
        }
#endif
    }

    private func rememberSelection() {
        switch selected {
        case .prep: prepVisited = true
        case .trackStats: trackingVisited = true
        case .share: shareVisited = true
        }
    }
}
