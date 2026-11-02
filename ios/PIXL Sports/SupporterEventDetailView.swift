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
#if DEBUG
    @ObservedObject private var scheduleRefreshProbe = NativeScheduleRefreshUITestProbe.shared
#endif
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

    private var pageNavigationTitle: String {
        switch state {
        case .loading, .unavailable(_):
            return "Event Details"
        case .loaded(_, _):
            return selectedStep.title
        }
    }

    var body: some View {
        ZStack {
            NativePageBackground()

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
                    .supporterSurfaceShadow()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                case let .loaded(schedule, event):
                    eventDetails(schedule: schedule, event: event)
                case let .unavailable(message):
                    unavailable(message)
                }
            }
            .frame(maxWidth: detailContentMaxWidth)
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
        .overlay(alignment: .topTrailing) {
            if NativeScheduleRefreshUITestProbe.isRequested {
                Text("Event detail loads: \(scheduleRefreshProbe.detailRefreshes)")
                    .font(.caption2)
                    .padding(4)
                    .background(.black.opacity(0.7), in: Capsule())
                    .accessibilityIdentifier("schedule-refresh-detail-count")
            }
        }
        .background {
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-event-detail") {
                NativeEventDetailSafeAreaProbe()
                    .allowsHitTesting(false)
            }
        }
#endif
        .navigationTitle(pageNavigationTitle)
#if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
#endif
        .task {
            await load()
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeEventScheduleChanged)) { notification in
            guard let rawReason = notification.userInfo?[NativeEventScheduleChangeReason.userInfoKey] as? String,
                  let reason = NativeEventScheduleChangeReason(rawValue: rawReason),
                  reason.refreshesEventDetail else { return }
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
                if prepHasUnsavedChanges {
                    Label("Prep has unsaved edits", systemImage: "pencil.circle")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(SupporterHomeColors.accentText)
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

#if DEBUG
                if NativeScheduleRefreshUITestProbe.isRequested {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Schedule refresh test controls")
                            .font(.caption.weight(.bold))
                        ForEach(NativeEventScheduleChangeReason.allCases, id: \.rawValue) { reason in
                            Button("Trigger \(reason.rawValue)") {
                                if reason == .eventCardEdited {
                                    Task {
                                        await load()
                                        postScheduleChange(reason)
                                    }
                                } else {
                                    postScheduleChange(reason)
                                }
                            }
                            .accessibilityIdentifier("schedule-change-\(reason.rawValue)")
                        }
                    }
                    .padding(12)
                    .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 12))
                }
#endif

                if let clerk {
                    NavigationLink {
                        NativeCreateEventCardView(
                            athleteName: schedule.athleteName ?? "your athlete",
                            teamName: schedule.teamName,
                            seasonName: schedule.seasonName,
                            initialTimezone: event.timezone ?? schedule.timezone,
                            clerk: clerk,
                            existingEvent: event,
                            shareToken: event.shareToken,
                            onCreated: { _ in
                                Task {
                                    await load()
                                    let reason = NativeEventScheduleChangeReason.eventCardEdited
                                    NotificationCenter.default.post(
                                        name: .nativeEventScheduleChanged,
                                        object: nil,
                                        userInfo: [NativeEventScheduleChangeReason.userInfoKey: reason.rawValue]
                                    )
                                }
                            }
                        )
                    } label: {
                        Label("Edit Event Card", systemImage: "pencil")
                            .font(.system(size: buttonPointSize, weight: .bold))
                            .foregroundStyle(SupporterHomeColors.accent)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .frame(minHeight: 44)
                            .fixedSize(horizontal: false, vertical: true)
                            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 15))
                            .supporterSurfaceShadow()
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("event-detail-edit")
                }

            }
            .frame(maxWidth: detailContentMaxWidth, alignment: .leading)
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
        VStack(alignment: .leading, spacing: 13) {
            eventIdentity(schedule: schedule, event: event)
            eventScheduleDetails(schedule: schedule, event: event)
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
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("event-detail-hero")
    }

    private func eventIdentity(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        ViewThatFits(in: .horizontal) {
            eventIdentityRow(schedule: schedule, event: event)
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .center, spacing: 9) {
                    statusBadge(event)
                    eventIdentityName(schedule: schedule, event: event)
                }
                Text(event.type == "practice" ? "PRACTICE" : "GAME DAY")
                    .font(.system(size: detailLabelPointSize, weight: .heavy))
                    .tracking(1.5)
                    .foregroundStyle(SupporterHomeColors.muted)
            }
        }
    }

    private func eventIdentityRow(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        HStack(alignment: .center, spacing: 9) {
            statusBadge(event)
            eventIdentityName(schedule: schedule, event: event)
                .layoutPriority(1)
            Text(event.type == "practice" ? "PRACTICE" : "GAME DAY")
                .font(.system(size: detailLabelPointSize, weight: .heavy))
                .tracking(1.5)
                .foregroundStyle(SupporterHomeColors.muted)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func eventIdentityName(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        let teamName = schedule.teamName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasDistinctTeamName = teamName.map {
            !$0.isEmpty && $0.caseInsensitiveCompare(event.title) != .orderedSame
        } ?? false

        return VStack(alignment: .leading, spacing: 2) {
            if hasDistinctTeamName, let teamName {
                Text(teamName)
                    .font(.system(size: eventTitlePointSize, weight: .black, design: .rounded))
                    .tracking(-0.4)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(event.title)
                    .font(.system(size: detailLabelPointSize, weight: .semibold))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .lineLimit(1)
                    .accessibilityIdentifier("event-detail-title")
            } else {
                Text(event.title)
                    .font(.system(size: eventTitlePointSize, weight: .black, design: .rounded))
                    .tracking(-0.4)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                    .accessibilityIdentifier("event-detail-title")
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func eventScheduleDetails(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        let columns = Array(
            repeating: GridItem(.flexible(minimum: 0), spacing: 10, alignment: .top),
            count: 3
        )
        let date = compactDate(event: event, schedule: schedule)
        let time = event.formattedTime(timezone: event.timezone ?? schedule.timezone)
        let location = event.location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "Location to be announced"
            : event.location

        return Group {
            if dynamicTypeSize.isAccessibilitySize {
                VStack(alignment: .leading, spacing: 10) {
                    detailRow(icon: "calendar", label: "DATE", value: date)
                    detailRow(icon: "clock", label: "TIME", value: time)
                    detailRow(icon: "mappin.and.ellipse", label: "LOCATION", value: location)
                }
            } else {
                LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
                    detailRow(icon: "calendar", label: "DATE", value: date)
                    detailRow(icon: "clock", label: "TIME", value: time)
                    detailRow(icon: "mappin.and.ellipse", label: "LOCATION", value: location)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("event-detail-metadata")
    }

    private func compactDate(event: AthleteFanEvent, schedule: NativeSupporterSchedule) -> String {
        let timezone = event.timezone ?? schedule.timezone
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timezone ?? "") ?? .current
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: event.date) else { return event.date }
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
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

    private var detailContentMaxWidth: CGFloat {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-share-narrow") {
            return 320
        }
#endif
        return 560
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
                    .lineLimit(1)
                    .minimumScaleFactor(0.78)
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
#if DEBUG
        if NativeScheduleRefreshUITestProbe.isRequested {
            NativeScheduleRefreshUITestProbe.shared.recordDetailRefresh()
        }
#endif
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
            let status = (error as? NativeAccountLinkError)?.statusCode
            if case .loaded = state, status == nil || (status ?? 0) >= 500 { return }
            state = .unavailable(error.localizedDescription)
        }
    }

#if DEBUG
    private func postScheduleChange(_ reason: NativeEventScheduleChangeReason) {
        NotificationCenter.default.post(
            name: .nativeEventScheduleChanged,
            object: nil,
            userInfo: [NativeEventScheduleChangeReason.userInfoKey: reason.rawValue]
        )
    }
#endif
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
