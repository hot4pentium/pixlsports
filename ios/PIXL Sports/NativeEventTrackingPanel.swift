import SwiftUI
import ClerkKit

@MainActor
struct NativeEventTrackingPanel: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let event: AthleteFanEvent
    let teamName: String
    let athleteName: String
    let clerk: Clerk
    let isActive: Bool
    let hasActiveLiveTapsElsewhere: Bool
    @StateObject private var trackerModel: NativeEventToolModel
    @State private var selectedMode: TrackingMode?
    @State private var hasVisitedStatTracker = false
    @State private var hasVisitedLiveTaps = false
    @State private var hasVisitedRecordMoments = false
    @State private var showingModePicker = false
    @State private var showingRecordMoments = false
    @State private var recordMomentsAfterPicker = false
    @State private var expandedExplanation: TrackingMode?

    private enum TrackingMode: String {
        case statTracker
        case liveTaps
        case recordMoments

        var title: String {
            switch self {
            case .statTracker: return "Track Stats"
            case .liveTaps: return "Live Taps"
            case .recordMoments: return "Record Moments"
            }
        }

        var symbol: String {
            switch self {
            case .statTracker: return "chart.bar.fill"
            case .liveTaps: return "hands.clap.fill"
            case .recordMoments: return "video.badge.plus"
            }
        }

        var subtitle: String {
            switch self {
            case .statTracker: return "Keep score and track player stats."
            case .liveTaps: return "Set up cheers for fans at the game."
            case .recordMoments: return "Add a shoutout intro to a clip, then save or share it."
            }
        }

        var explanation: String {
            switch self {
            case .statTracker:
                return "Keep the team score here, then open the full tracker when you want player-stat details."
            case .liveTaps:
                return "Fans can cheer while you track stats. Cheers stay separate from official stats."
            case .recordMoments:
                return "Choose or record video, keep up to 15 seconds of action, and add a short shoutout intro. Save to Photos or share without uploading to PIXL Sports."
            }
        }
    }

    private var gameIsComplete: Bool {
        trackerModel.trackerIsComplete || NativeEventDetailStep.gameIsComplete(eventStatus: event.status)
    }

    init(
        event: AthleteFanEvent,
        teamName: String,
        athleteName: String,
        clerk: Clerk,
        isActive: Bool,
        hasActiveLiveTapsElsewhere: Bool = false,
        model: NativeEventToolModel? = nil
    ) {
        self.event = event
        self.teamName = teamName
        self.athleteName = athleteName
        self.clerk = clerk
        self.isActive = isActive
        self.hasActiveLiveTapsElsewhere = hasActiveLiveTapsElsewhere
        _trackerModel = StateObject(wrappedValue: model ?? NativeEventToolModel.shared(
            shareToken: event.shareToken, accountID: clerk.user?.id ?? NativeOfflineRuntime.shared.accountID
        ))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if selectedMode == nil && !gameIsComplete {
                chooseTrackingToolPrompt
            }
            scorekeepingSection
                .eventToolVisibility(!gameIsComplete && selectedMode == .statTracker)
            liveTapsSection
                .eventToolVisibility((!gameIsComplete && selectedMode == .liveTaps)
                    || (gameIsComplete && event.liveTapsActive))
            if hasVisitedRecordMoments || selectedMode == .recordMoments {
                recordMomentsSection
                    .eventToolVisibility(!gameIsComplete && selectedMode == .recordMoments)
            }
        }
        .tint(NativeEventToolColors.trackStats)
        .sheet(isPresented: $showingModePicker, onDismiss: {
            if recordMomentsAfterPicker && !gameIsComplete {
                recordMomentsAfterPicker = false
                showingRecordMoments = true
            }
        }) {
            modePickerSheet
        }
        .fullScreenCover(isPresented: $showingRecordMoments) {
            NavigationStack {
                NativeRecordMomentsView(athleteName: athleteName, eventTitle: event.title)
            }
            .toolbar(.visible, for: .navigationBar)
            .preferredColorScheme(.light)
        }
        .onAppear {
            if isActive { presentModePicker() }
        }
        .onChange(of: isActive) { _, active in
            if active { presentModePicker() }
        }
        .onChange(of: gameIsComplete) { _, complete in
            if complete {
                recordMomentsAfterPicker = false
                showingModePicker = false
                showingRecordMoments = false
            }
        }
    }

    private var modePickerSheet: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 15) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Choose your game-day tool")
                        .font(.title2.weight(.black))
                        .foregroundStyle(SupporterHomeColors.background)
                    Text("Choose what you want to use for this event. You can switch tools later.")
                        .font(.subheadline)
                        .foregroundStyle(SupporterHomeColors.lightMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                modeChoice(.statTracker)
                modeChoice(.liveTaps)
                modeChoice(.recordMoments)
                Button(selectedMode == nil ? "Not now" : "Keep current tool") {
                    showingModePicker = false
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(SupporterHomeColors.lightMuted)
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .padding(20)
            .frame(maxWidth: 560, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .presentationDetents([.large])
        .presentationCornerRadius(0)
        .presentationDragIndicator(.hidden)
        .presentationBackground(.white)
        .preferredColorScheme(.light)
        .accessibilityIdentifier("native-event-mode-choice-sheet")
    }

    private func modeChoice(_ mode: TrackingMode) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            Group {
                if dynamicTypeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 8) {
                        modeChoiceButton(mode)
                        modeHelpButton(mode)
                    }
                } else {
                    HStack(spacing: 8) {
                        modeChoiceButton(mode)
                        modeHelpButton(mode)
                    }
                }
            }

            if expandedExplanation == mode {
                Text(mode.explanation)
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("native-event-mode-explanation-\(mode.rawValue)")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(NativeEventToolColors.trackStats.opacity(0.32), lineWidth: 1)
        }
        .supporterSurfaceShadow()
    }

    private func modeChoiceButton(_ mode: TrackingMode) -> some View {
        Button {
            selectMode(mode)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: mode.symbol)
                    .font(.headline.weight(.bold))
                    .foregroundStyle(NativeEventToolColors.trackStats)
                    .frame(width: 42, height: 42)
                    .background(
                        NativeEventToolColors.trackStats.opacity(0.15),
                        in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                    )
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(mode.title)
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                    Text(mode.subtitle)
                        .font(.caption)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Image(systemName: "arrow.right")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(NativeEventToolColors.trackStats)
                    .accessibilityHidden(true)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(mode.title)
        .accessibilityHint("Use \(mode.title) for this event.")
        .accessibilityIdentifier("native-event-choice-\(mode.rawValue)")
    }

    private func modeHelpButton(_ mode: TrackingMode) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.18)) {
                expandedExplanation = expandedExplanation == mode ? nil : mode
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: expandedExplanation == mode ? "questionmark.circle.fill" : "questionmark.circle")
                    .font(.title3.weight(.semibold))
                if dynamicTypeSize.isAccessibilitySize {
                    Text("\(expandedExplanation == mode ? "Hide" : "Explain") \(mode.title)")
                        .font(.subheadline.weight(.semibold))
                }
            }
            .frame(minWidth: 44, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(NativeEventToolColors.trackStats)
        .accessibilityLabel("\(expandedExplanation == mode ? "Hide" : "Explain") \(mode.title)")
        .accessibilityValue(expandedExplanation == mode ? "Explanation shown" : "Explanation hidden")
        .accessibilityHint(
            "\(expandedExplanation == mode ? "Hide" : "Show") what \(mode.title) does."
        )
        .accessibilityIdentifier("native-event-mode-help-\(mode.rawValue)")
    }

    private var chooseTrackingToolPrompt: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Choose a game-day tool", systemImage: "figure.run")
                .font(.headline.weight(.bold))
                .foregroundStyle(NativeEventToolColors.trackStats)
            Text("Choose Track Stats, Live Taps, or Record Moments.")
                .font(.subheadline)
                .foregroundStyle(SupporterHomeColors.muted)
            Button("Choose an option", action: presentModePicker)
                .buttonStyle(.borderedProminent)
                .accessibilityIdentifier("native-event-open-mode-choice")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .supporterSurfaceShadow()
    }

    private var scorekeepingSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SupporterEyebrow(text: "Stat tracker", color: NativeEventToolColors.trackStats)
                Spacer(minLength: 8)
                switchToolButton
            }
            if hasVisitedStatTracker {
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
            }
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
            .disabled(gameIsComplete)
            .accessibilityIdentifier("native-event-full-tracker")
        }
        .accessibilityIdentifier("native-event-scorekeeping-section")
    }

    private var liveTapsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SupporterEyebrow(text: "Live Taps", color: NativeEventToolColors.trackStats)
                Spacer(minLength: 8)
                if !gameIsComplete { switchToolButton }
            }
            if hasVisitedLiveTaps || (gameIsComplete && event.liveTapsActive) {
                NativeEventFanAccessView(
                    event: event,
                    athleteName: athleteName,
                    clerk: clerk,
                    hasActiveLiveTapsElsewhere: hasActiveLiveTapsElsewhere,
                    isActive: isActive && (selectedMode == .liveTaps || gameIsComplete)
                )
            }
        }
        .accessibilityIdentifier("native-event-live-taps-section")
    }

    private var recordMomentsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                SupporterEyebrow(text: "Record Moments", color: NativeEventToolColors.trackStats)
                Spacer(minLength: 8)
                switchToolButton
            }
            Button {
                showingRecordMoments = true
            } label: {
                NativeRecordMomentsLaunchCard(
                    title: "Make a shareable clip",
                    subtitle: "Pick a shoutout intro and a video. The finished clip stays here until you save or share it."
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("event-record-moments-open")
        }
        .accessibilityIdentifier("native-event-record-moments-section")
    }

    private var switchToolButton: some View {
        Button(action: presentModePicker) {
            Label("Switch tool", systemImage: "arrow.left.arrow.right")
                .font(.caption.weight(.bold))
                .frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("native-event-switch-tracking-mode")
    }

    private func selectMode(_ mode: TrackingMode) {
        guard !gameIsComplete else { return }
        if mode == .recordMoments {
            recordMomentsAfterPicker = true
        }
        selectedMode = mode
        if mode == .statTracker { hasVisitedStatTracker = true }
        if mode == .liveTaps { hasVisitedLiveTaps = true }
        if mode == .recordMoments { hasVisitedRecordMoments = true }
        expandedExplanation = nil
        showingModePicker = false
    }

    private func presentModePicker() {
        guard isActive, !gameIsComplete else { return }
        expandedExplanation = nil
        showingModePicker = true
    }
}

extension View {
    /// The event container owns the title for embedded and retained tool panels.
    @ViewBuilder
    func eventToolNavigationTitle(_ title: String, embedded: Bool) -> some View {
        if embedded {
            self
        } else {
            self.navigationTitle(title)
        }
    }

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
