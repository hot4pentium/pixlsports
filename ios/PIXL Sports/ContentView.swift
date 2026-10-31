import SwiftUI
import ClerkKit

enum SupporterHomeColors {
    static let background = Color(red: 0.035, green: 0.075, blue: 0.15)
    static let panel = Color(red: 0.075, green: 0.13, blue: 0.23)
    static let blue = Color(red: 0.16, green: 0.48, blue: 0.98)
    static let accent = Color(red: 0.72, green: 0.94, blue: 0.25)
    static let muted = Color(red: 0.68, green: 0.75, blue: 0.86)
}

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let clerk: Clerk?
    @Binding var showingAccountLink: Bool

    @StateObject private var viewModel = SupporterHomeViewModel()
    @State private var heroDestination: HeroDestination?
    @State private var eventToolsChanged = false
    @State private var dashboardVisible = false

    private enum HeroDestination: Identifiable {
        case eventCard(String)
        case hypeCard
        case createEvent

        var id: String {
            switch self {
            case let .eventCard(token): return "event-\(token)"
            case .hypeCard: return "hype-card"
            case .createEvent: return "create-event"
            }
        }
    }
#if DEBUG
    /// Fictional presentation states never request a session or private data.
    private let fixtureState: SupporterHomeViewModel.State?
#endif

    init(clerk: Clerk, showingAccountLink: Binding<Bool>) {
        self.clerk = clerk
        self._showingAccountLink = showingAccountLink
#if DEBUG
        self.fixtureState = nil
#endif
    }

#if DEBUG
    /// Fictional, network-free dashboard fixture for UI verification.
    init(fixtureState: SupporterHomeViewModel.State, showingAccountLink: Binding<Bool>) {
        self.clerk = nil
        self._showingAccountLink = showingAccountLink
        self.fixtureState = fixtureState
    }
#endif

    private var displayedState: SupporterHomeViewModel.State {
#if DEBUG
        if let fixtureState { return fixtureState }
#endif
        return viewModel.state
    }

    private func loadSchedule() async {
#if DEBUG
        guard fixtureState == nil else { return }
#endif
        guard let clerk else { return }
        await viewModel.load(clerk: clerk)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                backdrop

                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        header
                        athleteHero
                        accountConnectionSection
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
                    await loadSchedule()
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
        .fullScreenCover(item: $heroDestination, onDismiss: {
            Task { await loadSchedule() }
        }) { destination in
            NavigationStack {
                heroDestinationView(destination)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") { heroDestination = nil }
                                .tint(SupporterHomeColors.accent)
                        }
                    }
            }
            .toolbar(.visible, for: .navigationBar)
            .preferredColorScheme(.dark)
        }
#if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
#endif
        .preferredColorScheme(.dark)
        .task {
            await loadSchedule()
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, dashboardVisible, heroDestination == nil else { return }
            Task { await loadSchedule() }
        }
        .onChange(of: showingAccountLink) { wasShowing, isShowing in
            guard wasShowing && !isShowing else { return }
            Task { await loadSchedule() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeEventToolsSaved)) { _ in
            eventToolsChanged = true
        }
    }

    // MARK: - Backdrop

    private var backdrop: some View {
        ZStack {
            LinearGradient(
                colors: [SupporterHomeColors.background, Color(red: 0.035, green: 0.10, blue: 0.20)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [SupporterHomeColors.blue.opacity(0.22), .clear],
                center: .topTrailing,
                startRadius: 8,
                endRadius: 440
            )
            RadialGradient(
                colors: [SupporterHomeColors.accent.opacity(0.05), .clear],
                center: .bottomLeading,
                startRadius: 8,
                endRadius: 380
            )
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
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    // MARK: - Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(alignment: .center, spacing: 11) {
                Image(systemName: "sportscourt.fill")
                    .font(.system(size: 18, weight: .black))
                    .foregroundStyle(SupporterHomeColors.background)
                    .frame(width: 40, height: 40)
                    .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(.white.opacity(0.3), lineWidth: 1)
                    }
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 0) {
                    Text("PIXL")
                        .font(.headline.weight(.black))
                        .fontDesign(.rounded)
                        .tracking(1.4)
                        .foregroundStyle(SupporterHomeColors.blue)
                    Text("SPORTS")
                        .font(.caption2.weight(.heavy))
                        .fontDesign(.rounded)
                        .tracking(3)
                        .foregroundStyle(.white.opacity(0.86))
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("PIXL Sports")

                Spacer(minLength: 8)

                if !dynamicTypeSize.isAccessibilitySize {
                    Text("SUPPORTER HUB")
                        .font(.caption2.weight(.heavy))
                        .tracking(1.4)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(.white.opacity(0.06), in: Capsule())
                        .overlay { Capsule().strokeBorder(.white.opacity(0.08), lineWidth: 1) }
                        .lineLimit(1)
                        .accessibilityHidden(true)
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Capsule().fill(SupporterHomeColors.accent).frame(width: 22, height: 3)
                    SupporterEyebrow(text: "Your season")
                }
                Text("Your schedule")
                    .font(.largeTitle.weight(.black))
                    .fontDesign(.rounded)
                    .tracking(-0.6)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("dashboard-title")
                Text("Your private schedule, at a glance.")
                    .font(.body.weight(.medium))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Athlete hero (connected only)

    @ViewBuilder
    private var athleteHero: some View {
        if case let .schedule(page, _, _) = displayedState {
            let guide = SupporterHomeViewModel.featuredGuideEvent(in: page)
            NativeHomeHeroCards(
                athleteName: page.athleteName ?? "Your athlete",
                teamName: page.teamName,
                scheduleTimezone: page.timezone,
                nextEvent: guide?.event,
                eventTiming: guide?.timing,
                hypePhotoURL: viewModel.hypeCardPreview?.cutoutUrl ?? viewModel.hypeCardPreview?.photoUrl,
                hypePreviewFailed: viewModel.hypeCardPreviewError != nil,
                onOpenEvent: {
                    if let token = guide?.event.shareToken {
                        heroDestination = .eventCard(token)
                    } else {
                        heroDestination = .createEvent
                    }
                },
                onOpenHypeCard: { heroDestination = .hypeCard }
            )
        }
    }

    @ViewBuilder
    private func heroDestinationView(_ destination: HeroDestination) -> some View {
        switch destination {
        case let .eventCard(token):
            eventDetailScreen(token: token)
        case .hypeCard:
            SupporterHypeCardView(clerk: clerk)
        case .createEvent:
            NativeCreateEventCardView(
                athleteName: schedulePage?.athleteName ?? "your athlete",
                teamName: schedulePage?.teamName,
                initialTimezone: schedulePage?.timezone,
                clerk: clerk,
                onCreated: { token in
                    Task {
                        await loadSchedule()
                        heroDestination = .eventCard(token)
                    }
                }
            )
        }
    }

    private var schedulePage: NativeSupporterSchedule? {
        if case let .schedule(page, _, _) = displayedState { return page }
        return nil
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
                    fixture: SupporterEventDetailView.Fixture(schedule: page, event: event)
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

    // MARK: - Account connection

    @ViewBuilder
    private var accountConnectionSection: some View {
        if case .schedule = displayedState {
            Button {
                showingAccountLink = true
            } label: {
                HStack(alignment: .center, spacing: 12) {
                    Image(systemName: "checkmark.shield.fill")
                        .foregroundStyle(SupporterHomeColors.accent)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 4) {
                        Text("PIXL account connected")
                            .font(.caption.weight(.heavy))
                            .foregroundStyle(SupporterHomeColors.accent)
                        Text("Manage connection")
                            .font(.footnote)
                            .foregroundStyle(SupporterHomeColors.muted)
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .foregroundStyle(SupporterHomeColors.muted)
                        .accessibilityHidden(true)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(16)
                .background(.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(0.09), lineWidth: 1)
                }
            }
            .buttonStyle(SupporterCardPressStyle())
            .accessibilityLabel("PIXL account connected. Manage PIXL connection")
            .accessibilityHint("Schedule data is loaded from your verified PIXL account.")
            .accessibilityIdentifier("dashboard-connection-action")
        } else {
            accountSetupSection
        }
    }

    private var accountSetupSection: some View {
        let isChecking: Bool
        if case .loading = displayedState {
            isChecking = true
        } else {
            isChecking = false
        }

        return VStack(alignment: .leading, spacing: 12) {
            Label {
                Text(isChecking ? "Checking PIXL account" : "Private PIXL schedule")
                    .textCase(.uppercase)
                    .fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: isChecking ? "arrow.triangle.2.circlepath" : "lock.fill")
            }
            .font(.caption.weight(.heavy))
            .tracking(1.3)
            .foregroundStyle(SupporterHomeColors.muted)

            Text(isChecking
                    ? "Verifying your private schedule connection…"
                    : "Connect the PIXL account you already use. Approval is required on both devices.")
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
            .disabled(isChecking)
            .opacity(isChecking ? 0.55 : 1)
            .accessibilityIdentifier("dashboard-connection-action")
        }
        .padding(18)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(.white.opacity(0.09), lineWidth: 1)
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
            VStack(alignment: .leading, spacing: 14) {
                SupporterSectionHeader(
                    eyebrow: "Event Cards",
                    title: events.isEmpty ? "Coming up" : "Up next",
                    trailing: events.isEmpty ? nil : "\(events.count) \(events.count == 1 ? "EVENT" : "EVENTS")"
                )

                if events.isEmpty {
                    emptyScheduleCard()
                } else {
                    eventGrid(page: page, events: events)
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
                if !pastEvents.isEmpty {
                    pastEventsSection(page: page, events: pastEvents)
                }
            }
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
    }

    private func compactEventCard(page: NativeSupporterSchedule, item: SupporterScheduleItem) -> some View {
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
                    if item.timing == .live || item.timing == .complete {
                        Text(item.timing == .live ? "LIVE" : "COMPLETE")
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
                    Text("\(item.event.formattedDate(timezone: zone)) · \(item.event.formattedTime(timezone: zone))")
                        .font(.caption.weight(.medium))
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
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(SupporterCardPressStyle())
        .accessibilityLabel("\(item.timing == .complete ? "Complete, " : item.timing == .live ? "Live, " : "")\(item.event.title), \(item.event.formattedDate(timezone: zone)), \(item.event.formattedTime(timezone: zone)). View Event Card details.")
    }

    private func pastEventsSection(
        page: NativeSupporterSchedule,
        events: [SupporterScheduleItem]
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SupporterSectionHeader(
                eyebrow: "Event history",
                title: "Past Event Cards",
                trailing: "\(events.count) \(events.count == 1 ? "CARD" : "CARDS")",
                trailingColor: SupporterHomeColors.blue
            )
            eventGrid(page: page, events: events)
        }
        .padding(.top, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("dashboard-history")
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

    private func eventGrid(page: NativeSupporterSchedule, events: [SupporterScheduleItem]) -> some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 9), count: 3), spacing: 9) {
            ForEach(events) { item in
                NavigationLink {
                    eventDestination(for: item.event)
                } label: {
                    NativeEventGridTile(event: item.event, timezone: page.timezone)
                }
                .buttonStyle(SupporterCardPressStyle())
                .accessibilityIdentifier("dashboard-event-tile-\(item.event.eventId)")
            }
        }
        .accessibilityIdentifier("dashboard-event-grid")
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
