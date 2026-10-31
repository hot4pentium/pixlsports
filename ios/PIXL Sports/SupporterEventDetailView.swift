import SwiftUI
import ClerkKit
import UIKit

@MainActor
struct SupporterEventDetailView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let clerk: Clerk?
    let shareToken: String
    let fixture: Fixture?

    @State private var state: DetailState = .loading
    @State private var toolsChanged = false
    @State private var detailsVisible = false
    @State private var selectedStep: NativeEventDetailStep = .prep
    @State private var selectionInitialized = false
    @State private var prepHasUnsavedChanges = false
    @State private var refreshTask: Task<Void, Never>?
    @ScaledMetric(relativeTo: .largeTitle) private var eventTitlePointSize = 24
    @ScaledMetric(relativeTo: .body) private var detailValuePointSize = 16
    @ScaledMetric(relativeTo: .body) private var detailLabelPointSize = 10
    @ScaledMetric(relativeTo: .body) private var buttonPointSize = 16
    @ScaledMetric(relativeTo: .title2) private var unavailableTitlePointSize = 22
    @ScaledMetric(relativeTo: .body) private var messagePointSize = 15

    struct Fixture {
        let schedule: NativeSupporterSchedule
        let event: AthleteFanEvent
        var prep: NativeEventWorkspace.Prep = .init(items: [], notes: "")
        var now: Date? = nil
    }

    init(clerk: Clerk?, shareToken: String, fixture: Fixture? = nil) {
        self.clerk = clerk
        self.shareToken = shareToken
        self.fixture = fixture
    }

    private enum DetailState {
        case loading
        case loaded(schedule: NativeSupporterSchedule, event: AthleteFanEvent)
        case unavailable(String)
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [SupporterHomeColors.background, Color(red: 0.035, green: 0.10, blue: 0.20)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            RadialGradient(
                colors: [SupporterHomeColors.blue.opacity(0.16), .clear],
                center: .topTrailing,
                startRadius: 8,
                endRadius: 420
            )
            .ignoresSafeArea()

            Canvas { context, size in
                var grid = Path()
                for x in stride(from: CGFloat.zero, through: size.width, by: CGFloat(36)) {
                    grid.move(to: CGPoint(x: x, y: 0))
                    grid.addLine(to: CGPoint(x: x, y: size.height))
                }
                for y in stride(from: CGFloat.zero, through: size.height, by: CGFloat(36)) {
                    grid.move(to: CGPoint(x: 0, y: y))
                    grid.addLine(to: CGPoint(x: size.width, y: y))
                }
                context.stroke(grid, with: .color(.white.opacity(0.035)), lineWidth: 0.5)
            }
            .ignoresSafeArea()
            .accessibilityHidden(true)

            Group {
                switch state {
                case .loading:
                    HStack(spacing: 12) {
                        ProgressView()
                            .tint(SupporterHomeColors.accent)
                        Text("Verifying Event Card access…")
                            .font(.system(size: messagePointSize, weight: .semibold))
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
                    .overlay {
                        RoundedRectangle(cornerRadius: 20)
                            .stroke(.white.opacity(0.1), lineWidth: 1)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                case let .loaded(schedule, event):
                    eventDetails(schedule: schedule, event: event)
                case let .unavailable(message):
                    unavailable(message)
                }
            }
            .frame(maxWidth: 560)
            .padding(.horizontal, 22)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if case let .loaded(schedule, event) = state {
                TimelineView(.periodic(from: .now, by: 15)) { context in
                    NativeEventStepBar(
                        recommended: recommendedStep(schedule: schedule, event: event, date: context.date),
                        selected: selectedStep,
                        isGame: event.type == "game",
                        actionsEnabled: clerk != nil || fixture != nil,
                        onSelect: { step in
                            UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
                            selectedStep = step
                        }
                    )
#if DEBUG
                    .onChange(of: context.date, initial: true) { _, date in
                        if NativeEventWorkspaceUITestFixture.isRequested {
                            NativeEventWorkspaceUITestFixture.shared.recordTimeline(
                                recommendedStep(schedule: schedule, event: event, date: date)
                            )
                        }
                    }
#endif
                }
            }
        }
#if DEBUG
        .background {
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-event-detail") {
                NativeEventDetailSafeAreaProbe()
                    .allowsHitTesting(false)
            }
        }
#endif
        .navigationTitle("Event Details")
#if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
#endif
        .task {
            await load()
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeEventToolsSaved)) { _ in
            toolsChanged = true
            scheduleRefresh()
        }
        .onAppear {
            detailsVisible = true
            if toolsChanged && !prepHasUnsavedChanges {
                toolsChanged = false
                Task { await load() }
            }
        }
        .onDisappear {
            detailsVisible = false
            refreshTask?.cancel()
        }
        .onChange(of: prepHasUnsavedChanges) { _, dirty in
            if !dirty && toolsChanged { scheduleRefresh() }
        }
        .onChange(of: scenePhase) { _, phase in
            // Don't remove the destination's NavigationLink while a native tool
            // has unsaved work. Its requests still recheck account access.
            guard phase == .active, detailsVisible else { return }
            Task { await load() }
        }
    }

    @ViewBuilder
    private func eventDetails(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        ScrollViewReader { proxy in
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                eventCard(schedule: schedule, event: event)
                eventInformation(schedule: schedule, event: event)
                if prepHasUnsavedChanges {
                    Label("Prep has unsaved edits", systemImage: "pencil.circle")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(SupporterHomeColors.accent)
                }
                NativeEventToolPanel(
                    schedule: schedule, event: event,
                    clerk: clerk,
                    selected: selectedStep,
                    fixturePrep: fixture?.prep,
                    onDirtyChange: { prepHasUnsavedChanges = $0 }
                )
                .id("\(shareToken):\(clerk?.user?.id ?? "fixture")")
                .id("active-event-tool")

                if let clerk {
                    NavigationLink {
                        NativeCreateEventCardView(
                            athleteName: schedule.athleteName ?? "your athlete",
                            teamName: schedule.teamName,
                            initialTimezone: event.timezone ?? schedule.timezone,
                            clerk: clerk,
                            existingEvent: event,
                            shareToken: event.shareToken,
                            onCreated: { _ in Task { await load() } }
                        )
                    } label: {
                        Label("Edit Event Card", systemImage: "pencil")
                            .font(.system(size: buttonPointSize, weight: .bold))
                            .foregroundStyle(SupporterHomeColors.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .frame(minHeight: 44)
                            .fixedSize(horizontal: false, vertical: true)
                            .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 15))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("event-detail-edit")
                }

            }
            .frame(maxWidth: 560, alignment: .leading)
            .padding(.top, 4)
            .padding(.bottom, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onChange(of: selectedStep) { _, _ in
            withAnimation { proxy.scrollTo("active-event-tool", anchor: .top) }
        }
        .accessibilityIdentifier("event-detail-scroll")
        }
    }

    private func recommendedStep(schedule: NativeSupporterSchedule, event: AthleteFanEvent, date: Date) -> NativeEventDetailStep {
        let start = event.parsedStart(timezone: event.timezone ?? schedule.timezone)
        var now = fixture?.now ?? date
#if DEBUG
        if NativeEventWorkspaceUITestFixture.isRequested, let start {
            now = NativeEventWorkspaceUITestFixture.shared.timelineDate(date, eventStart: start)
        }
#endif
        return .recommended(
            start: start,
            isGame: event.type == "game",
            isLive: event.status == "live" || event.liveTapsActive,
            now: now
        )
    }

    @ViewBuilder
    private func trackerScreen(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        if let clerk, event.type == "game" {
            NativeEventTrackerView(
                event: event,
                teamName: schedule.teamName ?? "Your team",
                athleteName: schedule.athleteName ?? "Athlete",
                clerk: clerk
            )
        } else {
            ContentUnavailableView("Game statistics unavailable", systemImage: "chart.bar.fill")
        }
    }

    @ViewBuilder
    private func shareScreen(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        if let clerk {
            NativeEventShareView(schedule: schedule, event: event, clerk: clerk)
        } else {
            ContentUnavailableView("Sign in to share", systemImage: "lock.fill")
        }
    }

    private func eventCard(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            eventCardHeading(event)

            if let athleteName = schedule.athleteName, !athleteName.isEmpty {
                HStack(spacing: 7) {
                    Image(systemName: "person.fill")
                        .font(.system(size: 10, weight: .bold))
                    Text(athleteName)
                        .font(.system(size: 12, weight: .semibold))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .foregroundStyle(SupporterHomeColors.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background {
            RoundedRectangle(cornerRadius: 24)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.10, green: 0.24, blue: 0.43),
                            SupporterHomeColors.panel,
                            Color(red: 0.045, green: 0.12, blue: 0.24)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(
                            LinearGradient(
                                colors: [
                                    SupporterHomeColors.blue.opacity(0.78),
                                    .white.opacity(0.13),
                                    SupporterHomeColors.accent.opacity(0.55)
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                }
        }
    }

    @ViewBuilder
    private func eventCardHeading(_ event: AthleteFanEvent) -> some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 12) {
                eventDateBadge(event)
                eventTitleBlock(event)
            }
        } else {
            HStack(alignment: .top, spacing: 14) {
                eventDateBadge(event)
                eventTitleBlock(event)
                Spacer(minLength: 0)
            }
        }
    }

    private func eventTitleBlock(_ event: AthleteFanEvent) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            statusBadge(event)
            Text(event.title)
                .font(.system(size: eventTitlePointSize, weight: .black, design: .rounded))
                .tracking(-0.4)
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("event-detail-title")
            Text(event.type == "practice" ? "PRACTICE" : "GAME DAY")
                .font(.system(size: detailLabelPointSize, weight: .heavy))
                .tracking(1.5)
                .foregroundStyle(SupporterHomeColors.muted)
        }
    }

    private func eventInformation(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("EVENT DETAILS")
                .font(.system(size: 10, weight: .black))
                .tracking(1.9)
                .foregroundStyle(SupporterHomeColors.accent)

            LazyVGrid(
                columns: Array(
                    repeating: GridItem(.flexible(), alignment: .topLeading),
                    count: dynamicTypeSize.isAccessibilitySize ? 1 : 2
                ),
                alignment: .leading,
                spacing: 16
            ) {
                detailRow(icon: "calendar", label: "DATE", value: event.formattedFullDate(timezone: event.timezone ?? schedule.timezone))
                detailRow(icon: "clock", label: "TIME", value: event.formattedTime(timezone: event.timezone ?? schedule.timezone))

                if event.type == "game" {
                    detailRow(
                        icon: "person.2.fill",
                        label: "OPPONENT",
                        value: event.opponent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            ? "Opponent to be announced"
                            : event.opponent
                    )
                }
                detailRow(
                    icon: "mappin.and.ellipse",
                    label: "LOCATION",
                    value: event.location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? "Location to be announced"
                        : event.location
                )

                if let teamName = schedule.teamName, !teamName.isEmpty {
                    detailRow(icon: "shield.fill", label: "TEAM", value: teamName)
                }
                if let seasonName = schedule.seasonName, !seasonName.isEmpty {
                    detailRow(icon: "calendar", label: "SEASON", value: seasonName)
                }
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
        .overlay {
            RoundedRectangle(cornerRadius: 22)
                .stroke(Color.white.opacity(0.1), lineWidth: 1)
        }
    }

    private func eventDateBadge(_ event: AthleteFanEvent) -> some View {
        let parts = event.date.split(separator: "-")
        let monthNumber = parts.count == 3 ? Int(parts[1]) : nil
        let dayNumber = parts.count == 3 ? Int(parts[2]) : nil
        let monthSymbols = DateFormatter().shortMonthSymbols ?? []
        let month = monthNumber.flatMap { (1...12).contains($0) ? monthSymbols[$0 - 1].uppercased() : nil } ?? "DATE"
        let day = dayNumber.map(String.init) ?? "—"

        return VStack(spacing: 2) {
            Text(month)
                .font(.system(size: 9, weight: .black))
                .tracking(1.1)
            Text(day)
                .font(.system(size: 26, weight: .black, design: .rounded))
                .contentTransition(.numericText())
        }
        .foregroundStyle(SupporterHomeColors.background)
        .frame(width: 58, height: 66)
        .background(
            LinearGradient(
                colors: [SupporterHomeColors.accent, Color(red: 0.88, green: 0.98, blue: 0.48)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 16)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 16)
                .stroke(.white.opacity(0.42), lineWidth: 1)
        }
        .accessibilityHidden(true)
    }

    private func statusBadge(_ event: AthleteFanEvent) -> some View {
        let isLive = event.status == "live"
        let label = isLive ? "LIVE NOW" : event.status == "final" ? "COMPLETE" : "UPCOMING"

        return HStack(spacing: 6) {
            Circle()
                .fill(isLive ? SupporterHomeColors.accent : SupporterHomeColors.blue)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.system(size: 9, weight: .black))
                .tracking(1.2)
        }
        .foregroundStyle(isLive ? SupporterHomeColors.accent : .white.opacity(0.86))
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .background(
            isLive ? SupporterHomeColors.accent.opacity(0.11) : SupporterHomeColors.blue.opacity(0.16),
            in: Capsule()
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Status: \(statusText(event))")
        .accessibilityIdentifier("event-detail-status")
    }

    private func statusText(_ event: AthleteFanEvent) -> String {
        event.status == "live" ? "Live" : event.status == "final" ? "Complete" : "Upcoming"
    }

    private func detailRow(icon: String, label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: detailLabelPointSize, weight: .semibold))
                    .foregroundStyle(SupporterHomeColors.accent)
                Text(label)
                    .font(.system(size: detailLabelPointSize, weight: .heavy))
                    .tracking(1.3)
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            Text(value)
                .font(.system(size: detailValuePointSize, weight: .semibold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("event-detail-\(label.lowercased())")
    }

    private func unavailable(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 13) {
            Image(systemName: "lock.shield")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(SupporterHomeColors.accent)
            Text("Event Card unavailable")
                .font(.system(size: unavailableTitlePointSize, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
            Text(message)
                .font(.system(size: messagePointSize))
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                Task { await load() }
            } label: {
                Label("Try again", systemImage: "arrow.clockwise")
                    .font(.system(size: buttonPointSize, weight: .bold))
                    .foregroundStyle(SupporterHomeColors.background)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .background(SupporterHomeColors.accent, in: Capsule())
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background {
            RoundedRectangle(cornerRadius: 22)
                .fill(
                    LinearGradient(
                        colors: [Color(red: 0.08, green: 0.17, blue: 0.30), SupporterHomeColors.panel],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 22)
                        .stroke(.white.opacity(0.1), lineWidth: 1)
                }
        }
    }

    private func scheduleRefresh() {
        refreshTask?.cancel()
        refreshTask = Task {
            do { try await Task.sleep(for: .milliseconds(500)) } catch { return }
            guard detailsVisible, !prepHasUnsavedChanges else { return }
            toolsChanged = false
            await load()
        }
    }

    private func chooseInitialStep(schedule: NativeSupporterSchedule, event: AthleteFanEvent, now: Date? = nil) {
        guard !selectionInitialized else { return }
        selectedStep = recommendedStep(schedule: schedule, event: event, date: now ?? Date())
        selectionInitialized = true
    }

    private func load() async {
        guard !prepHasUnsavedChanges else { return }
        // Preserve mounted tool models when confirmed event data refreshes.
        if case .loaded = state {} else { state = .loading }
        if let fixture {
            chooseInitialStep(schedule: fixture.schedule, event: fixture.event, now: fixture.now)
            state = .loaded(schedule: fixture.schedule, event: fixture.event)
            return
        }
        guard let clerk else {
            state = .unavailable("Reconnect the PIXL account that owns this Event Card to view its details.")
            return
        }
        do {
            let result = try await SupporterHomeAPI.fetchPrivateEvent(shareToken: shareToken, clerk: clerk)
            guard !Task.isCancelled else { return }
            chooseInitialStep(schedule: result.schedule, event: result.event)
            state = .loaded(schedule: result.schedule, event: result.event)
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled else { return }
            state = .unavailable(error.localizedDescription)
        }
    }
}

#if DEBUG
/// Reports UIKit's actual safe rectangle to XCTest, not a guessed device inset.
/// It does not replace or constrain the production SwiftUI layout.
private struct NativeEventDetailSafeAreaProbe: UIViewRepresentable {
    func makeUIView(context: Context) -> SafeAreaView { SafeAreaView() }
    func updateUIView(_ uiView: SafeAreaView, context: Context) {}

    final class SafeAreaView: UIView {
        override init(frame: CGRect) {
            super.init(frame: frame)
            isAccessibilityElement = true
            accessibilityIdentifier = "event-detail-safe-area"
            accessibilityLabel = "Event Details safe area"
            isUserInteractionEnabled = false
        }

        required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

        override func layoutSubviews() {
            super.layoutSubviews()
            accessibilityFrame = UIAccessibility.convertToScreenCoordinates(
                bounds.inset(by: safeAreaInsets), in: self
            )
        }

        override func safeAreaInsetsDidChange() {
            super.safeAreaInsetsDidChange()
            setNeedsLayout()
        }
    }
}
#endif
