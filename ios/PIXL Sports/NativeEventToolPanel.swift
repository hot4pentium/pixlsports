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
            toolHeader
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
                    if event.type == "game", trackingVisited || selected == .trackStats {
                        NativeEventTrackingPanel(
                            event: event, teamName: schedule.teamName ?? "Your team",
                            athleteName: schedule.athleteName ?? "Your athlete", clerk: clerk,
                            hasActiveLiveTapsElsewhere: schedule.events.contains {
                                $0.liveTapsActive && $0.eventId != event.eventId
                            },
                            model: workspaceModel
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
        .background {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [toolAccent.opacity(0.12), Color.white.opacity(0.055)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        }
        .overlay {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(toolAccent.opacity(0.30), lineWidth: 1)
        }
        .accessibilityIdentifier("event-detail-tool-panel")
        .onAppear { rememberSelection() }
        .onChange(of: selected) { _, _ in rememberSelection() }
    }

    private var toolHeader: some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: selected.icon)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(toolAccent)
                .frame(width: 52, height: 52)
                .background(toolAccent.opacity(0.16), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(toolAccent.opacity(0.35), lineWidth: 1)
                }
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 7) {
                    Text("STEP \(selected.number)")
                        .font(.caption2.weight(.black))
                        .tracking(1.2)
                        .foregroundStyle(toolAccent)
                    Circle()
                        .fill(toolAccent.opacity(0.7))
                        .frame(width: 3, height: 3)
                        .accessibilityHidden(true)
                    Text(toolKicker)
                        .font(.caption2.weight(.black))
                        .tracking(1.1)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("event-tool-context")
                }

                Text(selected.title)
                    .font(.title2.weight(.black))
                    .fontDesign(.rounded)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("event-tool-title")

                Text(toolSummary)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("event-tool-summary")

                Text("\(event.title) · \(event.formattedDate(timezone: event.timezone ?? schedule.timezone)) · \(event.formattedTime(timezone: event.timezone ?? schedule.timezone))")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white.opacity(0.84))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("event-tool-event-context")
                    .padding(.top, 3)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(toolAccent.opacity(0.075))
        }
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(toolAccent.opacity(0.20), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("event-tool-header")
    }

    private var toolAccent: Color {
        switch selected {
        case .prep:
            return SupporterHomeColors.accent
        case .trackStats:
            return SupporterHomeColors.blue
        case .share:
            return Color(red: 0.30, green: 0.78, blue: 0.95)
        }
    }

    private var toolKicker: String {
        switch selected {
        case .prep: return "BEFORE THE EVENT"
        case .trackStats: return "GAME SCOREKEEPING"
        case .share: return "SHARE THIS EVENT"
        }
    }

    private var toolSummary: String {
        switch selected {
        case .prep: return "Get the family and gear ready."
        case .trackStats: return "Keep score, open Live Taps, or use the full tracker."
        case .share: return "Share event details or review the athlete HYPE Card."
        }
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
