import SwiftUI
import ClerkKit

enum SupporterHomeColors {
    static let background = Color(red: 0.035, green: 0.075, blue: 0.15)
    static let panel = Color(red: 0.075, green: 0.13, blue: 0.23)
    static let blue = Color(red: 0.16, green: 0.48, blue: 0.98)
    static let accent = Color(red: 0.72, green: 0.94, blue: 0.25)
    // Darker brand-green for text placed directly on the white native canvas.
    static let accentText = Color(red: 0.25, green: 0.38, blue: 0.02)
    static let muted = Color(red: 0.68, green: 0.75, blue: 0.86)
    static let lightMuted = Color(red: 0.34, green: 0.40, blue: 0.49)
}

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let clerk: Clerk?
    @Binding var showingAccountLink: Bool
    @Binding var showingSettings: Bool

    @StateObject private var viewModel = SupporterHomeViewModel()
    @ObservedObject private var offlineRuntime = NativeOfflineRuntime.shared
#if DEBUG
    @ObservedObject private var scheduleRefreshProbe = NativeScheduleRefreshUITestProbe.shared
    @ObservedObject private var fanBaseRefreshFixture: NativeFanBaseRefreshUITestFixture
    private let usesFanBaseRefreshFixture: Bool
#endif
    @State private var heroDestination: HeroDestination?
    @State private var eventToolsChanged = false
    @State private var dashboardVisible = false
    @State private var heroCoverVisible = false
    @State private var showingWeeklyWelcome = false
    @State private var welcomeProgressForPresentation: NativeWeeklyWelcomeProgress?
    @State private var eventCardToDelete: AthleteFanEvent?
    @State private var showingEventCardDeleteConfirmation = false
    @State private var eventCardActionAlert: EventCardActionAlert?
    @State private var pendingEventCardToDelete: NativePendingEventCardChange?
    @State private var showingPendingEventCardDeleteConfirmation = false
    @State private var fixtureDeletedEventIDs = Set<String>()

    private struct EventCardActionAlert: Identifiable {
        let id = UUID()
        let title: String
        let message: String
    }

    private enum HeroDestination: Identifiable {
        case eventCard(String)
        case editEventCard(String)
        case pendingEventCard(String)
        case hypeCard
        case fanBase
        case seasonStats
        case createEvent
        case recordMoments
        case profileSetup

        var id: String {
            switch self {
            case let .eventCard(token): return "event-\(token)"
            case let .editEventCard(token): return "edit-event-\(token)"
            case let .pendingEventCard(id): return "pending-event-\(id)"
            case .hypeCard: return "hype-card"
            case .fanBase: return "fan-base"
            case .seasonStats: return "season-stats"
            case .createEvent: return "create-event"
            case .recordMoments: return "record-moments"
            case .profileSetup: return "athlete-profile-setup"
            }
        }

        var showsDoneButton: Bool {
            if case .profileSetup = self { return false }
            if case .recordMoments = self { return false }
            return true
        }
    }
#if DEBUG
    /// Fictional presentation states never request a session or private data.
    private let fixtureState: SupporterHomeViewModel.State?
#endif

    init(clerk: Clerk, showingAccountLink: Binding<Bool>, showingSettings: Binding<Bool>) {
        self.clerk = clerk
        self._showingAccountLink = showingAccountLink
        self._showingSettings = showingSettings
#if DEBUG
        self.fixtureState = nil
        self._fanBaseRefreshFixture = ObservedObject(
            wrappedValue: NativeFanBaseRefreshUITestFixture(startLoaded: false)
        )
        self.usesFanBaseRefreshFixture = false
#endif
    }

#if DEBUG
    /// Fictional, network-free dashboard fixture for UI verification.
    init(
        fixtureState: SupporterHomeViewModel.State,
        fanBaseRefreshFixture: NativeFanBaseRefreshUITestFixture? = nil,
        showingAccountLink: Binding<Bool>,
        showingSettings: Binding<Bool>
    ) {
        self.clerk = nil
        self._showingAccountLink = showingAccountLink
        self._showingSettings = showingSettings
        self.fixtureState = fixtureState
        self._fanBaseRefreshFixture = ObservedObject(
            wrappedValue: fanBaseRefreshFixture
                ?? NativeFanBaseRefreshUITestFixture(startLoaded: false)
        )
        self.usesFanBaseRefreshFixture = fanBaseRefreshFixture != nil
    }
#endif

#if DEBUG
    private var displayedFanBase: NativeSupporterFanBase? {
        if usesFanBaseRefreshFixture { return fanBaseRefreshFixture.fanBase }
        return viewModel.fanBase
    }

    private var displayedFanBaseIsLoading: Bool {
        usesFanBaseRefreshFixture ? fanBaseRefreshFixture.isLoading : viewModel.fanBaseIsLoading
    }

    private var displayedFanBaseError: String? {
        usesFanBaseRefreshFixture ? fanBaseRefreshFixture.error : viewModel.fanBaseError
    }
#else
    private var displayedFanBase: NativeSupporterFanBase? { viewModel.fanBase }
    private var displayedFanBaseIsLoading: Bool { viewModel.fanBaseIsLoading }
    private var displayedFanBaseError: String? { viewModel.fanBaseError }
#endif

    private var displayedState: SupporterHomeViewModel.State {
#if DEBUG
        if let fixtureState { return fixtureState }
#endif
        return viewModel.state
    }

    private var shouldShowInitialSplash: Bool {
#if DEBUG
        if fixtureState != nil { return false }
#endif
        return !viewModel.hasResolvedInitialSchedule
    }

    private func loadSchedule(forceProfileReload: Bool = false) async {
#if DEBUG
        if NativeScheduleRefreshUITestProbe.isRequested {
            NativeScheduleRefreshUITestProbe.shared.recordDashboardRefresh()
        }
        guard fixtureState == nil else { return }
#endif
        guard let clerk else { return }
        await viewModel.load(clerk: clerk, forceProfileReload: forceProfileReload)
        presentInitialGuidanceIfNeeded()
    }

    private func refreshDashboard() async {
#if DEBUG
        if usesFanBaseRefreshFixture {
            await fanBaseRefreshFixture.refresh()
            return
        }
#endif
        await loadSchedule()
    }

    private var weeklyWelcomeProgress: NativeWeeklyWelcomeProgress? {
        guard let userID = clerk?.user?.id,
              let configuration = try? NativeClerkConfiguration.load().get() else { return nil }
        return NativeWeeklyWelcomeProgress(instance: configuration.publishableKey, userID: userID)
    }

    private func presentInitialGuidanceIfNeeded() {
#if DEBUG
        guard fixtureState == nil else { return }
#endif
        guard !shouldShowInitialSplash, heroDestination == nil, !heroCoverVisible,
              !showingAccountLink, !showingSettings, !showingWeeklyWelcome else { return }
        if viewModel.needsAthleteProfileSetup {
            weeklyWelcomeProgress?.beginInitialSetup()
            heroDestination = .profileSetup
            return
        }
        guard case .schedule = displayedState,
              viewModel.hasResolvedAthleteProfile,
              viewModel.athleteProfileError == nil,
              viewModel.athleteProfile?.needsSetup == false,
              let progress = weeklyWelcomeProgress, progress.isPending else { return }
        welcomeProgressForPresentation = progress
        showingWeeklyWelcome = true
    }

    private func acknowledgeWeeklyWelcome() {
        // A session change must never acknowledge a different account's guide.
        if let progress = welcomeProgressForPresentation,
           progress.storageKey == weeklyWelcomeProgress?.storageKey {
            progress.acknowledge()
        }
        showingWeeklyWelcome = false
    }

    var body: some View {
        NavigationStack {
            if shouldShowInitialSplash {
                NativeLaunchSplashView()
            } else {
                ZStack {
                    backdrop

                    ScrollView {
                        VStack(alignment: .leading, spacing: 22) {
                            header
                                .modifier(SupporterDashboardSectionSurface())
                                .accessibilityElement(children: .contain)
                                .accessibilityIdentifier("dashboard-header-section")
                            athleteHero
                            Button {
                                heroDestination = .recordMoments
                            } label: {
                                NativeRecordMomentsLaunchCard(
                                    title: "Make a shareable clip",
                                    subtitle: "Record Moments anytime, with or without an Event Card."
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("dashboard-record-moments")
                            if case let .schedule(page, _, _) = displayedState {
                                if let record = page.record {
                                    NativeSeasonRecordView(record: record)
                                }
                                Button {
                                    heroDestination = .seasonStats
                                } label: {
                                    NativeSeasonStatsLaunchCard()
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("dashboard-season-stats")
                            }
#if DEBUG
                            if usesFanBaseRefreshFixture {
                                VStack(alignment: .leading, spacing: 8) {
                                    Button("Refresh dashboard") {
                                        Task { await refreshDashboard() }
                                    }
                                    .accessibilityIdentifier("fan-base-fixture-refresh")
                                    if fanBaseRefreshFixture.fanBase != nil {
                                        Button("Simulate follow from another device") {
                                            fanBaseRefreshFixture.simulateRemoteFollowChange()
                                        }
                                        .accessibilityIdentifier("fan-base-fixture-remote-follow")
                                    }
                                    if !fanBaseRefreshFixture.isOnline {
                                        Button("Restore connection") {
                                            fanBaseRefreshFixture.restoreConnection()
                                        }
                                        .accessibilityIdentifier("fan-base-fixture-reconnect")
                                    }
                                    if fanBaseRefreshFixture.fanBase != nil {
                                        Button("Make next refresh fail") {
                                            fanBaseRefreshFixture.makeNextRefreshFail()
                                        }
                                        .accessibilityIdentifier("fan-base-fixture-failed-refresh")
                                    }
                                }
                            }
#endif
                            accountSetupIfNeeded
                            athleteProfileLoadIssue
                            pendingEventCardSection
                            nextEventSection
                        }
                        .frame(maxWidth: 560, alignment: .leading)
                        .padding(.horizontal, 20)
                        .padding(.top, 12)
                        .padding(.bottom, 40)
                        .frame(maxWidth: .infinity)
                    }
                    .scrollIndicators(.hidden)
                    .refreshable {
                        await refreshDashboard()
                    }
                    .onAppear {
                        dashboardVisible = true
                        if eventToolsChanged {
                            eventToolsChanged = false
                            Task { await loadSchedule() }
                        }
                    }
                    .onDisappear { dashboardVisible = false }
                }
            }
        }
        .fullScreenCover(item: $heroDestination, onDismiss: {
            heroCoverVisible = false
            if eventToolsChanged {
                eventToolsChanged = false
                Task { await loadSchedule() }
            } else {
                presentInitialGuidanceIfNeeded()
            }
        }) { destination in
            NavigationStack {
                heroDestinationView(destination)
                    .toolbar {
                        if destination.showsDoneButton {
                            ToolbarItem(placement: .topBarTrailing) {
                                Button {
                                    heroDestination = nil
                                } label: {
                                    Text("Done").nativeToolbarLabel()
                                }
                                    .tint(.black)
                                    .shadow(color: .black.opacity(0.24), radius: 2, x: 0, y: 1)
                            }
                        }
                    }
            }
            .toolbar(.visible, for: .navigationBar)
            .preferredColorScheme(.light)
            .onAppear { heroCoverVisible = true }
        }
        .sheet(isPresented: $showingWeeklyWelcome, onDismiss: {
            welcomeProgressForPresentation = nil
        }) {
            NativeWeeklyWelcomeView(onContinue: acknowledgeWeeklyWelcome)
                .presentationDetents([.large])
                .presentationDragIndicator(.hidden)
                .interactiveDismissDisabled()
                .preferredColorScheme(.light)
        }
#if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
#endif
        .preferredColorScheme(.light)
        .animation(.easeOut(duration: 0.22), value: viewModel.hasResolvedInitialSchedule)
        .task {
            await loadSchedule()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, dashboardVisible, heroDestination == nil,
                  !heroCoverVisible, !showingWeeklyWelcome else { return }
            Task { await loadSchedule() }
        }
        .onChange(of: showingAccountLink) { wasShowing, isShowing in
            if isShowing {
                viewModel.resetAthleteProfile()
                return
            }
            guard wasShowing else { return }
            Task { await loadSchedule(forceProfileReload: true) }
        }
        .onChange(of: showingSettings) { wasShowing, isShowing in
            guard wasShowing && !isShowing else { return }
            Task { await loadSchedule(forceProfileReload: true) }
        }
        .onChange(of: viewModel.needsAthleteProfileSetup) { _, _ in
            presentInitialGuidanceIfNeeded()
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeEventScheduleChanged)) { notification in
            guard let rawReason = notification.userInfo?[NativeEventScheduleChangeReason.userInfoKey] as? String,
                  let reason = NativeEventScheduleChangeReason(rawValue: rawReason),
                  reason.refreshesDashboard else { return }
            eventToolsChanged = true
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeOfflineConnectionChanged)) { _ in
            guard let clerk, offlineRuntime.online else { return }
            offlineRuntime.resume(clerk: clerk, force: true)
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeEventCardQueueSynced)) { _ in
            Task { await loadSchedule() }
        }
        .confirmationDialog(
            "Delete this Event Card?",
            isPresented: $showingEventCardDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete Event Card", role: .destructive) {
                Task { await deleteSelectedEventCard() }
            }
            .accessibilityIdentifier("dashboard-event-delete-confirm")
            Button("Cancel", role: .cancel) { eventCardToDelete = nil }
        } message: {
            Text("This removes the Event Card and turns off its public link. Stats and game history for this date stay saved.")
        }
        .confirmationDialog(
            "Remove this saved Event Card?",
            isPresented: $showingPendingEventCardDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete saved Event Card", role: .destructive) {
                Task { await deleteSelectedPendingEventCard() }
            }
            .accessibilityIdentifier("dashboard-pending-event-delete-confirm")
            Button("Cancel", role: .cancel) { pendingEventCardToDelete = nil }
        } message: {
            Text("If this card has reached PIXL, its link will be removed when deletion syncs. Recorded stats and game history stay saved.")
        }
        .alert(item: $eventCardActionAlert) { alert in
            Alert(
                title: Text(alert.title),
                message: Text(alert.message),
                dismissButton: .default(Text("Done"))
            )
        }
#if DEBUG
        .overlay(alignment: .topTrailing) {
            if NativeScheduleRefreshUITestProbe.isRequested {
                Text("Dashboard loads: \(scheduleRefreshProbe.dashboardRefreshes)")
                    .font(.caption2)
                    .padding(4)
                    .background(.black.opacity(0.7), in: Capsule())
                    .accessibilityIdentifier("schedule-refresh-dashboard-count")
            }
        }
#endif
    }

    // MARK: - Backdrop

    private var backdrop: some View {
        NativePageBackground()
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .center, spacing: 11) {
                Image("PixlSportsLogoOnDark")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 112, height: 46)
                    .accessibilityElement()
                .accessibilityLabel("PIXL Sports")

                Spacer(minLength: 8)

                if !dynamicTypeSize.isAccessibilitySize {
                    Text("SUPPORTER HUB")
                        .font(.caption2.weight(.heavy))
                        .tracking(1.4)
                        .foregroundStyle(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(SupporterHomeColors.panel, in: Capsule())
                        .overlay { Capsule().strokeBorder(SupporterHomeColors.blue.opacity(0.3), lineWidth: 1) }
                        .lineLimit(1)
                        .accessibilityHidden(true)
                }

#if os(iOS)
                Button {
                    showingSettings = true
                } label: {
                    Image(systemName: "gearshape")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(SupporterHomeColors.background)
                        .frame(width: 38, height: 38)
                        .background(.white.opacity(0.88), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Settings")
                .accessibilityIdentifier("dashboard-settings-button")
#endif
            }

        }
    }

    // MARK: - Athlete hero (connected only)

    private func guideReferenceDate(for timelineDate: Date) -> Date {
#if DEBUG
        if fixtureState != nil {
            return SupporterDashboardFixtures.fixedGuideNow ?? timelineDate
        }
#endif
        return timelineDate
    }

    private var fanBasePage: some View {
        ZStack {
            NativePageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Fan Base")
                        .font(.largeTitle.weight(.black))
                        .fontDesign(.rounded)
                        .foregroundStyle(SupporterHomeColors.background)
                        .accessibilityAddTraits(.isHeader)
                    if let fanBase = displayedFanBase {
                        NativeFanBaseView(fanBase: fanBase)
                    } else {
                        NativeFanBaseStatusView(
                            isLoading: displayedFanBaseIsLoading,
                            message: displayedFanBaseError ?? "Fan Base details aren’t available right now. Try again."
                        ) {
#if DEBUG
                            if usesFanBaseRefreshFixture {
                                fanBaseRefreshFixture.retry()
                            } else {
                                Task { await loadSchedule() }
                            }
#else
                            Task { await loadSchedule() }
#endif
                        }
                    }
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(20)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await refreshDashboard() }
        }
        .navigationTitle("Fan Base")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("native-fan-base-page")
    }

    @ViewBuilder
    private var athleteHero: some View {
        if case let .schedule(page, _, _) = displayedState {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                let guide = SupporterHomeViewModel.featuredGuideEvent(
                    in: page,
                    now: guideReferenceDate(for: context.date)
                )
                NativeHomeHeroCards(
                    athleteName: profileValue(viewModel.athleteProfile?.athleteName, fallback: page.athleteName) ?? "Your athlete",
                    teamName: profileValue(viewModel.athleteProfile?.teamName, fallback: page.teamName),
                    jerseyNumber: profileValue(viewModel.athleteProfile?.jerseyNumber, fallback: nil),
                    position: profileValue(viewModel.athleteProfile?.position, fallback: nil),
                    scheduleTimezone: page.timezone,
                    nextEvent: guide?.event,
                    eventTiming: guide?.timing,
                    seasonName: viewModel.hypeCardPreview?.publicCard?.seasonName
                        ?? viewModel.hypeCardPreview?.privateCard?.seasonName ?? page.seasonName ?? "",
                    hypePhotoURL: viewModel.hypeCardPreview?.publicCard?.photoUrl
                        ?? viewModel.hypeCardPreview?.publicCard?.cutoutUrl,
                    hypePrivatePhoto: viewModel.hypeCardPrivatePhoto,
                    hypePreviewFailed: viewModel.hypeCardPreviewError != nil
                        && viewModel.hypeCardPreview == nil,
                    showsFanBase: displayedFanBase != nil || displayedFanBaseIsLoading || displayedFanBaseError != nil,
                    onOpenEvent: {
                        if let token = guide?.event.shareToken {
                            heroDestination = .eventCard(token)
                        } else {
                            heroDestination = .createEvent
                        }
                    },
                    onOpenHypeCard: { heroDestination = .hypeCard },
                    onOpenFanBase: { heroDestination = .fanBase }
                )
                .modifier(SupporterDashboardSectionSurface())
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("dashboard-hero-section")
            }
        }
    }

    @ViewBuilder
    private var pendingEventCardSection: some View {
        if let clerk, let subject = clerk.user?.id {
            let changes = offlineRuntime.pendingEventCards(subject: subject)
            if !changes.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    SupporterEyebrow(text: "SAVED ON THIS IPHONE", color: SupporterHomeColors.accentText)
                    Text("Event Cards waiting to sync")
                        .font(.title3.weight(.black))
                        .fontDesign(.rounded)
                        .foregroundStyle(SupporterHomeColors.background)
                    ForEach(changes) { change in
                        VStack(alignment: .leading, spacing: 10) {
                            let team = change.teamName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                            let title = change.draft.type == "practice"
                                ? "Practice · \(change.draft.date)"
                                : "\(team.isEmpty ? change.athleteName : team) vs. \(change.draft.opponent) · \(change.draft.date)"
                            Text(title)
                                .font(.headline.weight(.bold))
                                .foregroundStyle(.white)
                            if change.operation == .delete {
                                Text(change.lastError ?? "Saved on this iPhone. Waiting for PIXL to remove this Event Card.")
                                    .font(.footnote)
                                    .foregroundStyle(change.lastError == nil ? SupporterHomeColors.muted : .orange)
                                    .fixedSize(horizontal: false, vertical: true)
                                HStack {
                                    Button("Try sync") {
                                        Task { await offlineRuntime.retryPendingEventCards(clerk: clerk, onlyID: change.id) }
                                    }
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(.white)
                                    .frame(minHeight: 44)
                                }
                            } else {
                                if !change.isConflicted || change.conflictDraft == nil {
                                    Text(change.conflictMessage ?? change.lastError
                                         ?? "Saved on this iPhone. Waiting for PIXL to confirm the save.")
                                        .font(.footnote)
                                        .foregroundStyle(change.isConflicted ? .orange : SupporterHomeColors.muted)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                if change.isConflicted {
                                    if let remoteDraft = change.conflictDraft {
                                        NativeEventCardConflictPanel(
                                            message: change.conflictMessage
                                                ?? "This Event Card changed on another device.",
                                            localDraft: change.draft,
                                            serverDraft: remoteDraft,
                                            onKeepLocal: {
                                                Task {
                                                    await offlineRuntime.keepLocalEventCardAfterConflict(
                                                        id: change.id,
                                                        subject: subject,
                                                        clerk: clerk
                                                    )
                                                }
                                            },
                                            onUseServer: {
                                                offlineRuntime.discardPendingEventCard(id: change.id, subject: subject)
                                                Task { await loadSchedule() }
                                            }
                                        )
                                    } else {
                                        Button("Create as new Event Card") {
                                            Task {
                                                await offlineRuntime.recreatePendingEventCardAsNew(
                                                    id: change.id,
                                                    subject: subject,
                                                    clerk: clerk
                                                )
                                            }
                                        }
                                        .font(.subheadline.weight(.bold))
                                        .foregroundStyle(SupporterHomeColors.accent)
                                        .frame(minHeight: 44)
                                        Button("Discard saved draft") {
                                            offlineRuntime.discardPendingEventCard(id: change.id, subject: subject)
                                        }
                                        .font(.subheadline.weight(.bold))
                                        .foregroundStyle(.white.opacity(0.8))
                                        .frame(minHeight: 44)
                                    }
                                } else {
                                    HStack(spacing: 12) {
                                        Button("Open saved draft") {
                                            heroDestination = .pendingEventCard(change.id)
                                        }
                                        .font(.subheadline.weight(.bold))
                                        .foregroundStyle(SupporterHomeColors.accent)
                                        .frame(minHeight: 44)
                                        Button("Try sync") {
                                            Task {
                                                await offlineRuntime.retryPendingEventCards(clerk: clerk)
                                            }
                                        }
                                        .font(.subheadline.weight(.bold))
                                        .foregroundStyle(.white)
                                        .frame(minHeight: 44)
                                    }
                                }
                                if change.operation == .create {
                                    Button("Delete saved draft", role: .destructive) {
                                        pendingEventCardToDelete = change
                                        showingPendingEventCardDeleteConfirmation = true
                                    }
                                    .font(.subheadline.weight(.bold))
                                    .frame(minHeight: 44)
                                    .accessibilityIdentifier("dashboard-pending-event-delete-\(change.id)")
                                }
                            }
                        }
                        .padding(14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 16))
                    }
                }
                .padding(16)
                .background(.white.opacity(0.82), in: RoundedRectangle(cornerRadius: 20))
                .accessibilityIdentifier("native-pending-event-cards")
            }
        }
    }

    @ViewBuilder
    private func heroDestinationView(_ destination: HeroDestination) -> some View {
        switch destination {
        case let .eventCard(token):
            eventDetailScreen(token: token)
        case let .editEventCard(token):
            if let page = schedulePage,
               let event = page.events.first(where: { $0.shareToken == token }),
               canManageEventCards {
                NativeCreateEventCardView(
                    athleteName: page.athleteName ?? "your athlete",
                    teamName: page.teamName,
                    seasonName: page.seasonName,
                    initialTimezone: event.timezone ?? page.timezone,
                    clerk: clerk,
                    existingEvent: event,
                    shareToken: token,
                    onCreated: { updatedToken in
                        Task {
                            await loadSchedule()
                            heroDestination = .eventCard(updatedToken)
                        }
                    }
                )
            } else {
                ContentUnavailableView("Event Card unavailable", systemImage: "calendar")
            }
        case let .pendingEventCard(id):
            if let subject = clerk?.user?.id,
               let change = offlineRuntime.pendingEventCards(subject: subject).first(where: { $0.id == id }) {
                NativeCreateEventCardView(
                    athleteName: change.athleteName,
                    teamName: change.teamName,
                    seasonName: change.seasonName,
                    initialTimezone: change.draft.timezone,
                    clerk: clerk,
                    shareToken: change.shareToken,
                    pendingChange: change,
                    onCreated: { token in
                        Task {
                            await loadSchedule()
                            heroDestination = .eventCard(token)
                        }
                    }
                )
            } else {
                VStack(spacing: 12) {
                    Text("This saved Event Card draft is no longer available.")
                    Button("Done") { heroDestination = nil }
                }
                .padding()
            }
        case .hypeCard:
            SupporterHypeCardView(
                clerk: clerk,
                cachedOwnerPreview: NativeOfflineRuntime.shared.vault.canContinue(subject: clerk?.user?.id)
                    ? viewModel.hypeCardPreview : nil,
                showsAthleteDetailsShortcut: true
            )
        case .fanBase:
            fanBasePage
        case .seasonStats:
            NativeSeasonStatsView(clerk: clerk, schedule: schedulePage)
        case .createEvent:
            NativeCreateEventCardView(
                athleteName: schedulePage?.athleteName ?? "your athlete",
                teamName: schedulePage?.teamName,
                seasonName: schedulePage?.seasonName,
                initialTimezone: schedulePage?.timezone,
                clerk: clerk,
                onCreated: { token in
                    Task {
                        await loadSchedule()
                        heroDestination = .eventCard(token)
                    }
                }
            )
        case .recordMoments:
            NativeRecordMomentsView(
                athleteName: profileValue(
                    viewModel.athleteProfile?.athleteName,
                    fallback: schedulePage?.athleteName
                ) ?? "Your athlete"
            )
        case .profileSetup:
            if let clerk {
                NativeAthleteProfileView(
                    clerk: clerk,
                    isInitialSetup: true,
                    initialProfile: viewModel.athleteProfile,
                    onSaved: { profile in
                        viewModel.setAthleteProfile(profile)
                        eventToolsChanged = true
                        heroDestination = nil
                    }
                )
            } else {
                ContentUnavailableView("Athlete profile unavailable", systemImage: "person.crop.circle")
            }
        }
    }

    private func profileValue(_ value: String?, fallback: String?) -> String? {
        for candidate in [value, fallback] {
            if let candidate {
                let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { return trimmed }
            }
        }
        return nil
    }

    private var schedulePage: NativeSupporterSchedule? {
        if case let .schedule(page, _, _) = displayedState { return page }
        return nil
    }

    private func eventCardIsHidden(_ eventId: String) -> Bool {
#if DEBUG
        if fixtureState != nil, fixtureDeletedEventIDs.contains(eventId) { return true }
#endif
        guard let subject = clerk?.user?.id else { return false }
        return offlineRuntime.pendingEventCards(subject: subject).contains {
            $0.id == eventId && $0.operation == .delete
        }
    }

    private var canManageEventCards: Bool {
#if DEBUG
        clerk != nil || fixtureState != nil
#else
        clerk != nil
#endif
    }

    @ViewBuilder
    private func eventCardManagementMenu(for event: AthleteFanEvent) -> some View {
        if canManageEventCards {
            Button {
                heroDestination = .editEventCard(event.shareToken)
            } label: {
                Label("Edit Event Card", systemImage: "pencil")
            }
            .accessibilityIdentifier("dashboard-event-edit-action-\(event.eventId)")

            Button(role: .destructive) {
                eventCardToDelete = event
                showingEventCardDeleteConfirmation = true
            } label: {
                Label("Delete Event Card", systemImage: "trash")
            }
            .accessibilityIdentifier("dashboard-event-delete-action-\(event.eventId)")
        }
    }

    @MainActor
    private func deleteSelectedEventCard() async {
        guard let event = eventCardToDelete else { return }
        eventCardToDelete = nil
#if DEBUG
        if fixtureState != nil {
            fixtureDeletedEventIDs.insert(event.eventId)
            eventCardActionAlert = EventCardActionAlert(
                title: "Event Card deleted",
                message: "This fictional card was removed. Stats and game history remain unchanged."
            )
            return
        }
#endif
        guard let clerk, let subject = clerk.user?.id else {
            eventCardActionAlert = EventCardActionAlert(
                title: "Couldn’t delete Event Card",
                message: "Sign in to the PIXL account that owns this Event Card."
            )
            return
        }
        do {
            let result = try offlineRuntime.stageEventCardDeletion(
                event: event,
                teamName: schedulePage?.teamName,
                athleteName: schedulePage?.athleteName ?? "Your athlete",
                seasonName: schedulePage?.seasonName,
                subject: subject
            )
            if result == .queuedForSync, offlineRuntime.online {
                await offlineRuntime.retryPendingEventCards(clerk: clerk, onlyID: event.eventId)
            }
            let pending = offlineRuntime.pendingEventCards(subject: subject)
                .first(where: { $0.id == event.eventId && $0.operation == .delete })
            if let pending {
                eventCardActionAlert = EventCardActionAlert(
                    title: "Deletion saved on this iPhone",
                    message: pending.lastError
                        ?? "This Event Card is hidden here. PIXL will remove its public link when the deletion syncs. Stats and game history stay saved."
                )
            } else {
                eventCardActionAlert = EventCardActionAlert(
                    title: result == .cancelledLocalDraft ? "Saved draft removed" : "Event Card deleted",
                    message: result == .cancelledLocalDraft
                        ? "The Event Card had not been created on PIXL. Its local draft was removed."
                        : "The Event Card and its public link were removed. Stats and game history for this date stay saved."
                )
            }
            if offlineRuntime.online, pending == nil {
                await loadSchedule()
            }
        } catch {
            eventCardActionAlert = EventCardActionAlert(
                title: "Couldn’t save the deletion",
                message: "The Event Card is still on this iPhone. Try again when its saved changes are available."
            )
        }
    }

    @MainActor
    private func deleteSelectedPendingEventCard() async {
        guard let change = pendingEventCardToDelete,
              let subject = clerk?.user?.id else { return }
        pendingEventCardToDelete = nil
        do {
            let result = try offlineRuntime.stagePendingEventCardDeletion(id: change.id, subject: subject)
            if result == .queuedForSync, offlineRuntime.online, let clerk {
                await offlineRuntime.retryPendingEventCards(clerk: clerk, onlyID: change.id)
            }
            let pending = offlineRuntime.pendingEventCards(subject: subject)
                .first(where: { $0.id == change.id && $0.operation == .delete })
            eventCardActionAlert = EventCardActionAlert(
                title: result == .cancelledLocalDraft ? "Saved draft removed" : "Deletion saved",
                message: pending?.lastError
                    ?? (pending == nil
                        ? "This Event Card had not been created on PIXL. Its local draft was removed."
                        : "This Event Card is hidden on this iPhone. Its public link will be removed when the deletion syncs; recorded stats and game history stay saved.")
            )
        } catch {
            eventCardActionAlert = EventCardActionAlert(
                title: "Couldn’t update the saved Event Card",
                message: "The local changes remain on this iPhone. Try again."
            )
        }
    }

    @ViewBuilder
    private func eventDetailScreen(token: String) -> some View {
        if let page = schedulePage,
           let event = page.events.first(where: { $0.shareToken == token }) {
#if DEBUG
            if fixtureState != nil {
                SupporterEventDetailView(
                    clerk: nil,
                    shareToken: token,
                    fixture: SupporterEventDetailView.Fixture(
                        schedule: page, event: event, now: guideReferenceDate(for: Date())
                    )
                )
            } else if let clerk {
                SupporterEventDetailView(clerk: clerk, shareToken: token)
            } else {
                ContentUnavailableView("Event Card unavailable", systemImage: "calendar")
            }
#else
            if let clerk {
                SupporterEventDetailView(clerk: clerk, shareToken: token)
            } else {
                ContentUnavailableView("Event Card unavailable", systemImage: "calendar")
            }
#endif
        } else {
            ContentUnavailableView("Event Card unavailable", systemImage: "calendar")
        }
    }

    private func weekSteps(page: NativeSupporterSchedule, events: [SupporterScheduleItem]) -> [SupporterWeekStep] {
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = TimeZone(identifier: page.timezone ?? "") ?? .current
        parser.dateFormat = "yyyy-MM-dd"
        let weekday = DateFormatter()
        weekday.timeZone = parser.timeZone
        weekday.dateFormat = "EEE"
        let month = DateFormatter()
        month.timeZone = parser.timeZone
        month.dateFormat = "MMM"

        return events.prefix(4).enumerated().map { index, item in
            let date = parser.date(from: item.event.date)
            let day = item.event.date.split(separator: "-").last.flatMap { Int($0) }.map(String.init) ?? "—"
            return SupporterWeekStep(
                id: item.id,
                weekday: date.map { weekday.string(from: $0).uppercased() } ?? "TBA",
                day: day,
                month: date.map { month.string(from: $0).uppercased() } ?? "",
                accessibleDate: item.event.formattedDate(timezone: item.event.timezone ?? page.timezone),
                isCurrent: index == 0,
                isLive: item.timing == .live
            )
        }
    }

    // MARK: - First-time account setup

    @ViewBuilder
    private var accountSetupIfNeeded: some View {
        if case .notConnected = displayedState {
            accountSetupSection
        }
    }

    private var accountSetupSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label {
                Text("Private PIXL schedule")
                    .textCase(.uppercase)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "lock.fill")
            }
            .font(.caption.weight(.heavy))
            .tracking(1.3)
            .foregroundStyle(SupporterHomeColors.muted)

            Text("You already have a PIXL sign-in or saved account. Connect it to keep your athlete and Event Cards. Approval is required on both devices; we never merge accounts automatically.")
                .font(.footnote)
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                showingAccountLink = true
            } label: {
                HStack(spacing: 10) {
                    Image(systemName: "link")
                    Text("Connect PIXL account")
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 4)
                    Image(systemName: "arrow.right")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(SupporterPrimaryButtonStyle())
            .accessibilityIdentifier("dashboard-connection-action")
        }
        .padding(18)
        .background(SupporterCardBackground(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(SupporterHomeColors.blue.opacity(0.38), lineWidth: 1)
        }
    }

    @ViewBuilder
    private var athleteProfileLoadIssue: some View {
        if viewModel.athleteProfileError != nil {
            VStack(alignment: .leading, spacing: 10) {
                Label("Athlete details unavailable", systemImage: "person.crop.circle.badge.exclamationmark")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(SupporterHomeColors.background)
                Text("We couldn’t load your profile from the linked PIXL account.")
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.lightMuted)
                Button {
                    Task { await loadSchedule(forceProfileReload: true) }
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                        .font(.subheadline.weight(.bold))
                }
                .buttonStyle(.borderedProminent)
                .tint(SupporterHomeColors.accent)
                .foregroundStyle(SupporterHomeColors.background)
                .accessibilityIdentifier("dashboard-athlete-profile-retry")
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(SupporterHomeColors.blue.opacity(0.2), lineWidth: 1)
            }
            .supporterSurfaceShadow()
            .accessibilityIdentifier("dashboard-athlete-profile-error")
        }
    }

    // MARK: - Schedule states

    @ViewBuilder
    private var nextEventSection: some View {
        switch displayedState {
        case .notConnected:
            messageCard(
                icon: "link",
                title: "Connect your PIXL account",
                message: "Securely link the iPhone app to the PIXL Sports account that owns your Event Cards."
            )
        case .loading:
            loadingCard
        case let .schedule(page, events, pastEvents):
            let allEventCards = (events + pastEvents).filter {
                !eventCardIsHidden($0.event.eventId)
            }
            VStack(alignment: .leading, spacing: 14) {
                SupporterSectionHeader(
                    eyebrow: "Your season",
                    title: "Event Cards",
                    trailing: allEventCards.isEmpty
                        ? nil
                        : "\(allEventCards.count) \(allEventCards.count == 1 ? "EVENT" : "EVENTS")"
                )

                if allEventCards.isEmpty {
                    emptyScheduleCard()
                } else {
                    eventGrid(page: page, events: allEventCards)
                }
                Button {
                    heroDestination = .createEvent
                } label: {
                    Label("Add an Event Card", systemImage: "plus")
                        .font(.subheadline.bold())
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(SupporterHomeColors.accent)
                .foregroundStyle(SupporterHomeColors.background)
                .accessibilityIdentifier("dashboard-add-event-card")
            }
            .modifier(SupporterDashboardSectionSurface())
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("dashboard-upcoming-section")
        case let .failed(message):
            VStack(alignment: .leading, spacing: 14) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(SupporterHomeColors.background)
                    .frame(width: 44, height: 44)
                    .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    .accessibilityHidden(true)
                Text("We couldn’t load your schedule")
                    .font(.headline.weight(.bold))
                    .fontDesign(.rounded)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    Task { await loadSchedule() }
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(SupporterPrimaryButtonStyle())
                .accessibilityIdentifier("dashboard-retry")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(SupporterCardBackground())
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("dashboard-error")
        }
    }

    private var loadingCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                ProgressView()
                    .tint(SupporterHomeColors.accent)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Loading your schedule")
                        .font(.headline)
                        .foregroundStyle(.white)
                    Text("Checking your connected Event Cards…")
                        .font(.subheadline)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            HStack(alignment: .top, spacing: 14) {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white.opacity(0.08))
                    .frame(width: 58, height: 66)
                VStack(alignment: .leading, spacing: 10) {
                    SupporterSkeletonBar(width: 70, height: 9)
                    SupporterSkeletonBar(width: 180, height: 18)
                    SupporterSkeletonBar(width: 130, height: 10)
                }
            }
            .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(SupporterCardBackground())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Loading your private schedule")
        .accessibilityIdentifier("dashboard-loading")
    }

    // MARK: - Event cards

    @ViewBuilder
    private func eventDestination(for event: AthleteFanEvent) -> some View {
#if DEBUG
        if fixtureState != nil {
            if case .schedule(let page, _, _) = displayedState {
                SupporterEventDetailView(
                    clerk: nil,
                    shareToken: event.shareToken,
                    fixture: .init(schedule: page, event: event)
                )
            }
        } else {
            SupporterEventDetailView(clerk: clerk, shareToken: event.shareToken)
        }
#else
        SupporterEventDetailView(clerk: clerk, shareToken: event.shareToken)
#endif
    }

    private func eventCard(
        page: NativeSupporterSchedule,
        event: AthleteFanEvent,
        timing: SupporterEventTiming
    ) -> some View {
        let zone = event.timezone ?? page.timezone
        let location = event.location.trimmingCharacters(in: .whitespacesAndNewlines)
        let headline = event.type == "game" && !event.opponent.isEmpty
            ? "vs \(event.opponent)"
            : event.type == "game" ? event.title : (page.teamName ?? "Practice")

        let headingLayout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 14))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 14))

        return VStack(alignment: .leading, spacing: 18) {
            headingLayout {
                eventDateBadge(event)

                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        if timing == .live {
                            Circle().fill(SupporterHomeColors.accent).frame(width: 7, height: 7)
                        }
                        SupporterEyebrow(text: timing == .live ? "Happening now" : "Up next")
                    }
                    Text(event.type == "game" ? (page.teamName ?? "Game") : "Practice")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(SupporterHomeColors.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(headline)
                        .font(.title2.weight(.black))
                        .fontDesign(.rounded)
                        .tracking(-0.3)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !dynamicTypeSize.isAccessibilitySize {
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right")
                        .font(.caption.weight(.black))
                        .foregroundStyle(.white.opacity(0.8))
                        .frame(width: 32, height: 32)
                        .background(.white.opacity(0.08), in: Circle())
                        .accessibilityHidden(true)
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Label {
                    Text(page.athleteName ?? "Your athlete")
                        .fixedSize(horizontal: false, vertical: true)
                } icon: {
                    Image(systemName: "person.2.fill")
                }
                if let seasonName = page.seasonName, !seasonName.isEmpty {
                    Label {
                        Text(seasonName)
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: "flag.checkered")
                    }
                }
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(SupporterHomeColors.muted)

            Rectangle()
                .fill(LinearGradient(
                    colors: [SupporterHomeColors.accent.opacity(0.5), .white.opacity(0.1), .clear],
                    startPoint: .leading, endPoint: .trailing))
                .frame(height: 1)

            VStack(alignment: .leading, spacing: 11) {
                eventDetail(icon: "calendar", text: event.formattedDate(timezone: zone))
                eventDetail(icon: "clock", text: event.formattedTime(timezone: zone))
                eventDetail(icon: "mappin.and.ellipse", text: location.isEmpty ? "Location to be announced" : event.location)
                    .accessibilityIdentifier("dashboard-event-location")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(SupporterCardBackground(cornerRadius: 24, highlighted: true))
        .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(timing == .live ? "Happening now" : "Up next"), \(page.athleteName ?? "your athlete"), \(page.teamName ?? "team"), \(headline), \(event.formattedDate(timezone: zone)), \(event.formattedTime(timezone: zone)), \(location.isEmpty ? "Location to be announced" : event.location). Tap to view details.")
            .contextMenu { eventCardManagementMenu(for: event) }
    }

    private func compactEventCard(page: NativeSupporterSchedule, item: SupporterScheduleItem, isUpNext: Bool = false) -> some View {
        let zone = item.event.timezone ?? page.timezone
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 13))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 13))
        return NavigationLink {
            eventDestination(for: item.event)
        } label: {
            layout {
                Image(systemName: item.timing == .live
                      ? "dot.radiowaves.left.and.right"
                      : item.timing == .complete ? "checkmark.circle.fill" : "calendar")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(item.timing == .complete ? SupporterHomeColors.blue : SupporterHomeColors.accent)
                    .frame(width: 40, height: 40)
                    .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 5) {
                    if item.timing == .live || item.timing == .complete || isUpNext {
                        Text(item.timing == .live ? "LIVE" : item.timing == .complete ? "COMPLETE" : "UP NEXT")
                            .font(.caption2.weight(.black))
                            .tracking(1)
                            .foregroundStyle(SupporterHomeColors.background)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(
                                item.timing == .complete ? SupporterHomeColors.blue.opacity(0.85) : SupporterHomeColors.accent,
                                in: Capsule()
                            )
                    }
                    Text(item.event.title)
                        .font(.headline.weight(.bold))
                        .fontDesign(.rounded)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    if item.event.type == "game", !item.event.opponent.isEmpty {
                        Text("vs \(item.event.opponent)")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.9))
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Text("\(item.event.formattedDate(timezone: zone)) · \(item.event.formattedTime(timezone: zone))")
                        .font(dynamicTypeSize.isAccessibilitySize ? .subheadline : .caption)
                        .fontWeight(.medium)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .fixedSize(horizontal: false, vertical: true)
                    if !item.event.location.isEmpty {
                        Text(item.event.location)
                            .font(.caption)
                            .foregroundStyle(SupporterHomeColors.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if !dynamicTypeSize.isAccessibilitySize {
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(SupporterHomeColors.muted.opacity(0.8))
                        .frame(minHeight: 40)
                        .accessibilityHidden(true)
                }
            }
            .padding(15)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.1), lineWidth: 1)
            }
            .supporterSurfaceShadow()
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contextMenu { eventCardManagementMenu(for: item.event) }
        }
        .buttonStyle(SupporterCardPressStyle())
        .accessibilityIdentifier("dashboard-event-card-\(item.event.eventId)")
        .accessibilityLabel("\(item.timing == .complete ? "Complete, " : item.timing == .live ? "Live, " : isUpNext ? "UP NEXT, " : "")\(item.event.title), \(item.event.opponent.isEmpty ? "" : "versus \(item.event.opponent), ")\(item.event.formattedFullDate(timezone: zone)), \(item.event.formattedTime(timezone: zone)). View Event Card details.")
        .accessibilityHint("Tap to open Event Card details. Long press for Edit or Delete.")
    }

    private func eventDetail(icon: String, text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 11) {
            Image(systemName: icon)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(SupporterHomeColors.accent)
                .frame(minWidth: 20)
                .accessibilityHidden(true)
            Text(text)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white.opacity(0.92))
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func eventGrid(page: NativeSupporterSchedule, events: [SupporterScheduleItem]) -> some View {
        let nextUpcomingID = events.first(where: { $0.timing == .upcoming })?.id
        if dynamicTypeSize.isAccessibilitySize {
            LazyVStack(spacing: 9) {
                ForEach(events) { item in
                    compactEventCard(page: page, item: item, isUpNext: item.id == nextUpcomingID)
                }
            }
            .accessibilityIdentifier("dashboard-event-grid")
        } else {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 9), count: 3), spacing: 9) {
                ForEach(events) { item in
                    NavigationLink {
                        eventDestination(for: item.event)
                    } label: {
                        NativeEventGridTile(
                            event: item.event, timezone: page.timezone,
                            timing: item.timing, isUpNext: item.id == nextUpcomingID
                        )
                        .contextMenu { eventCardManagementMenu(for: item.event) }
                    }
                    .buttonStyle(SupporterCardPressStyle())
                    .accessibilityIdentifier("dashboard-event-tile-\(item.event.eventId)")
                    .accessibilityHint("Tap to open Event Card details. Long press for Edit or Delete.")
                }
            }
            .accessibilityIdentifier("dashboard-event-grid")
        }
    }

    private func eventDateBadge(_ event: AthleteFanEvent) -> some View {
        let parts = event.date.split(separator: "-")
        let monthNumber = parts.count == 3 ? Int(parts[1]) : nil
        let dayNumber = parts.count == 3 ? Int(parts[2]) : nil
        let monthSymbols = DateFormatter().shortMonthSymbols ?? []
        let month = monthNumber.flatMap { (1...12).contains($0) && monthSymbols.count >= $0 ? monthSymbols[$0 - 1].uppercased() : nil } ?? "DATE"
        let day = dayNumber.map(String.init) ?? "—"

        return VStack(spacing: 2) {
            Text(month)
                .font(.caption2.weight(.black))
                .tracking(1.1)
            Text(day)
                .font(.title.weight(.black))
                .fontDesign(.rounded)
                .monospacedDigit()
                .contentTransition(.numericText())
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .foregroundStyle(SupporterHomeColors.background)
        .frame(minWidth: 58, minHeight: 66)
        .padding(.horizontal, 4)
        .background(
            LinearGradient(
                colors: [SupporterHomeColors.accent, Color(red: 0.88, green: 0.98, blue: 0.48)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(.white.opacity(0.42), lineWidth: 1)
        }
        .accessibilityHidden(true)
    }

    private func emptyScheduleCard() -> some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 12))
        return VStack(alignment: .leading, spacing: 16) {
            layout {
                Image(systemName: "calendar")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(SupporterHomeColors.background)
                    .frame(width: 46, height: 46)
                    .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityHidden(true)
                if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 8) }
                Text("ALL CAUGHT UP")
                    .font(.caption2.weight(.black))
                    .tracking(1.3)
                    .foregroundStyle(SupporterHomeColors.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(SupporterHomeColors.accent.opacity(0.1), in: Capsule())
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("No upcoming Event Cards")
                    .font(.title3.weight(.bold))
                    .fontDesign(.rounded)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                Text("New Event Cards from your connected PIXL account will show up here.")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 8) {
                Capsule().fill(SupporterHomeColors.accent).frame(width: 28, height: 3)
                Capsule().fill(SupporterHomeColors.blue.opacity(0.75)).frame(width: 12, height: 3)
                Text("YOUR SEASON, ONE EVENT AT A TIME")
                    .font(.caption2.weight(.heavy))
                    .tracking(1)
                    .foregroundStyle(SupporterHomeColors.muted.opacity(0.88))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(19)
        .background(SupporterCardBackground())
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("dashboard-empty")
    }

    private func messageCard(icon: String, title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: icon)
                .font(.title3.weight(.semibold))
                .foregroundStyle(SupporterHomeColors.accent)
                .frame(width: 44, height: 44)
                .background(SupporterHomeColors.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                .accessibilityHidden(true)
            Text(title)
                .font(.title3.weight(.bold))
                .fontDesign(.rounded)
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(SupporterCardBackground())
        .accessibilityElement(children: .combine)
    }
}
