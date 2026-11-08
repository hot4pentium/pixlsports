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
    let onCompletionChange: (Bool) -> Void
    @StateObject private var workspaceModel: NativeEventToolModel
    @State private var prepVisited = false
    @State private var trackingVisited = false
    @State private var shareVisited = false

    init(schedule: NativeSupporterSchedule, event: AthleteFanEvent, clerk: Clerk?,
         selected: NativeEventDetailStep, fixturePrep: NativeEventWorkspace.Prep?,
         onDirtyChange: @escaping (Bool) -> Void,
         onCompletionChange: @escaping (Bool) -> Void) {
        self.schedule = schedule
        self.event = event
        self.clerk = clerk
        self.selected = selected
        self.fixturePrep = fixturePrep
        self.onDirtyChange = onDirtyChange
        self.onCompletionChange = onCompletionChange
#if DEBUG
        if NativeEventWorkspaceUITestFixture.isRequested {
            _workspaceModel = StateObject(wrappedValue: NativeEventToolModel(uiTestFixture: .shared))
            return
        }
#endif
        _workspaceModel = StateObject(wrappedValue: NativeEventToolModel.shared(
            shareToken: event.shareToken, accountID: clerk?.user?.id ?? NativeOfflineRuntime.shared.accountID
        ))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if isComplete, let clerk {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Game complete").font(.headline)
                    if workspaceModel.pendingFinal {
                        Text("Final saved on this iPhone · not yet saved to PIXL")
                            .font(.caption)
                            .accessibilityIdentifier("native-event-final-pending")
                    }
                    if workspaceModel.pendingCount > 0 || workspaceModel.errorMessage != nil
                        || workspaceModel.trackerRecoveryStatus != nil
                        || workspaceModel.conflictBlocked || workspaceModel.unreadablePendingData {
                        NativeToolSaveNotice(model: workspaceModel, clerk: clerk, savedContentName: "Stat Tracker")
                    }
                }
                .accessibilityIdentifier("native-event-completed-game-status")
            }
            if usesUITestWorkspace {
                uiTestPrepPanel
            } else if let clerk {
                VStack(spacing: 0) {
                    if prepVisited || selected == .prep {
                        NativeEventPrepView(event: event, clerk: clerk, model: workspaceModel,
                                            embedded: true, compactContent: true,
                                            onDirtyChange: onDirtyChange)
                            .eventToolVisibility(selected == .prep)
                    }
                    if event.type == "game", trackingVisited || selected == .trackStats || (isComplete && event.liveTapsActive) {
                        NativeEventTrackingPanel(
                            event: event, teamName: schedule.teamName ?? "Your team",
                            athleteName: schedule.athleteName ?? "Your athlete", clerk: clerk,
                            isActive: (!isComplete && selected == .trackStats)
                                || (isComplete && selected == .share && event.liveTapsActive),
                            hasActiveLiveTapsElsewhere: schedule.events.contains {
                                $0.liveTapsActive && $0.eventId != event.eventId
                            },
                            model: workspaceModel
                        )
                        .eventToolVisibility((!isComplete && selected == .trackStats)
                            || (isComplete && selected == .share && event.liveTapsActive))
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
        .background {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.10, green: 0.20, blue: 0.34),
                            SupporterHomeColors.panel
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        }
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(toolAccent.opacity(0.30), lineWidth: 1)
        }
        .supporterSurfaceShadow()
        .accessibilityIdentifier("event-detail-tool-panel")
        .onAppear { rememberSelection() }
        .onChange(of: selected) { _, _ in rememberSelection() }
        .onChange(of: isComplete, initial: true) { _, complete in onCompletionChange(complete) }
        .task {
            if let clerk, workspaceModel.workspace == nil { await workspaceModel.load(clerk: clerk) }
        }
    }

    private var isComplete: Bool {
        event.type == "game" && (workspaceModel.trackerIsComplete
            || NativeEventDetailStep.gameIsComplete(eventStatus: event.status))
    }
    private var toolAccent: Color {
        NativeEventToolColors.color(for: selected)
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
                                embedded: true, compactContent: true,
                                onDirtyChange: onDirtyChange)
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
