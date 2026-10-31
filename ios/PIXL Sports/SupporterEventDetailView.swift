import SwiftUI
import ClerkKit

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
    @ScaledMetric(relativeTo: .largeTitle) private var eventTitlePointSize = 24
    @ScaledMetric(relativeTo: .body) private var detailValuePointSize = 16
    @ScaledMetric(relativeTo: .body) private var detailLabelPointSize = 10
    @ScaledMetric(relativeTo: .body) private var buttonPointSize = 16
    @ScaledMetric(relativeTo: .title2) private var unavailableTitlePointSize = 22
    @ScaledMetric(relativeTo: .body) private var messagePointSize = 15

    struct Fixture {
        let schedule: NativeSupporterSchedule
        let event: AthleteFanEvent
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
        }
        .onAppear {
            detailsVisible = true
            if toolsChanged {
                toolsChanged = false
                Task { await load() }
            }
        }
        .onDisappear { detailsVisible = false }
        .onChange(of: scenePhase) { _, phase in
            // Don't remove the destination's NavigationLink while a native tool
            // has unsaved work. Its requests still recheck account access.
            guard phase == .active, detailsVisible else { return }
            Task { await load() }
        }
    }

    @ViewBuilder
    private func eventDetails(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                brandHeader
                eventCard(schedule: schedule, event: event)
                eventInformation(schedule: schedule, event: event)
                nativeTools(schedule: schedule, event: event)

                if event.liveTapsActive,
                   let inviteToken = event.liveTapsInviteToken,
                   let sport = event.liveTapsSport {
                    NavigationLink {
                        SupporterLiveTapsView(
                            inviteToken: inviteToken,
                            sport: sport,
                            athleteName: schedule.athleteName ?? "your athlete",
                            eventTitle: event.title
                        )
                    } label: {
                        Label("Send Live Taps", systemImage: "hands.clap.fill")
                            .font(.system(size: buttonPointSize, weight: .bold))
                            .foregroundStyle(SupporterHomeColors.background)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .frame(minHeight: 44)
                            .fixedSize(horizontal: false, vertical: true)
                            .multilineTextAlignment(.center)
                            .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 15))
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Open the active family cheer session. Live Taps do not record player stats.")
                    .accessibilityIdentifier("event-detail-live-taps")
                }
            }
            .frame(maxWidth: 560, alignment: .leading)
            .padding(.top, 4)
            .padding(.bottom, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func nativeTools(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("YOUR EVENT TOOLS")
                .font(.caption.bold())
                .tracking(2)
                .foregroundStyle(SupporterHomeColors.accent)
            if let clerk {
                NavigationLink {
                    NativeEventPrepView(event: event, clerk: clerk)
                } label: {
                    toolRow("Prep", subtitle: "Pack, plan, and check off what’s ready.", icon: "checklist")
                }
                .accessibilityIdentifier("event-card-prep")
                if event.type == "game" {
                    NavigationLink {
                        NativeEventTrackerView(event: event, teamName: schedule.teamName ?? "Your team",
                                               athleteName: schedule.athleteName ?? "Athlete", clerk: clerk)
                    } label: {
                        toolRow(event.status == "final" ? "View Stats" : "Track Stats",
                                subtitle: "Your athlete’s stats and the team scoreboard.", icon: "chart.bar.fill")
                    }
                    .accessibilityIdentifier("event-card-track-stats")
                }
                if event.status == "final" {
                    NavigationLink {
                        SupporterHypeCardView(clerk: clerk)
                    } label: {
                        toolRow("Share HYPE Card", subtitle: "Celebrate your athlete after the game.", icon: "square.and.arrow.up")
                    }
                    .accessibilityIdentifier("event-card-share")
                } else {
                    ShareLink(item: eventShareText(event, timezone: schedule.timezone)) {
                        toolRow("Share", subtitle: "Send this event’s time, place, and matchup.", icon: "square.and.arrow.up")
                    }
                    .accessibilityIdentifier("event-card-share")
                }
            }
        }
        .buttonStyle(.plain)
    }

    private func toolRow(_ title: String, subtitle: String, icon: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.title3.weight(.bold))
                .foregroundStyle(SupporterHomeColors.accent)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.headline).foregroundStyle(.white)
                Text(subtitle).font(.caption).foregroundStyle(SupporterHomeColors.muted)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").foregroundStyle(SupporterHomeColors.muted)
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 18))
    }

    private func eventShareText(_ event: AthleteFanEvent, timezone: String?) -> String {
        [
            "PIXL SPORTS · \(event.title)",
            "\(event.formattedFullDate(timezone: event.timezone ?? timezone)) · \(event.formattedTime(timezone: event.timezone ?? timezone))",
            (event.timezone ?? timezone).map { "Time zone: \($0)" },
            event.opponent.isEmpty ? nil : "Opponent: \(event.opponent)",
            event.location.isEmpty ? nil : "Location: \(event.location)",
        ].compactMap { $0 }.joined(separator: "\n")
    }

    private var brandHeader: some View {
        HStack(alignment: .center, spacing: 11) {
            Image(systemName: "sportscourt.fill")
                .font(.system(size: 15, weight: .black))
                .foregroundStyle(SupporterHomeColors.background)
                .frame(width: 38, height: 38)
                .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 12))
                .overlay {
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(.white.opacity(0.3), lineWidth: 1)
                }

            VStack(alignment: .leading, spacing: 0) {
                Text("PIXL")
                    .font(.system(size: 16, weight: .black, design: .rounded))
                    .tracking(1.4)
                    .foregroundStyle(SupporterHomeColors.blue)
                Text("SPORTS")
                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                    .tracking(3.3)
                    .foregroundStyle(.white.opacity(0.86))
            }

            Spacer()

            Text("SUPPORTER HUB")
                .font(.system(size: 9, weight: .heavy))
                .tracking(1.5)
                .foregroundStyle(SupporterHomeColors.muted)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(.white.opacity(0.06), in: Capsule())
        }
        .accessibilityElement(children: .combine)
    }

    private func eventCard(schedule: NativeSupporterSchedule, event: AthleteFanEvent) -> some View {
        VStack(alignment: .leading, spacing: 17) {
            eventCardHeading(event)

            if let athleteName = schedule.athleteName, !athleteName.isEmpty {
                HStack(spacing: 7) {
                    Image(systemName: "person.fill")
                        .font(.system(size: 10, weight: .bold))
                    Text(athleteName)
                        .font(.system(size: 12, weight: .semibold))
                        .lineLimit(1)
                    if let seasonName = schedule.seasonName, !seasonName.isEmpty {
                        Circle()
                            .fill(SupporterHomeColors.accent.opacity(0.75))
                            .frame(width: 4, height: 4)
                        Text(seasonName)
                            .font(.system(size: 11, weight: .medium))
                            .lineLimit(1)
                    }
                }
                .foregroundStyle(SupporterHomeColors.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
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
        VStack(alignment: .leading, spacing: 16) {
            Text("EVENT DETAILS")
                .font(.system(size: 10, weight: .black))
                .tracking(1.9)
                .foregroundStyle(SupporterHomeColors.accent)

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
            detailRow(
                icon: event.status == "live" ? "dot.radiowaves.left.and.right" : "checkmark.circle",
                label: "STATUS",
                value: statusText(event)
            )
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
        .accessibilityLabel("Status: \(statusText(event))")
    }

    private func statusText(_ event: AthleteFanEvent) -> String {
        event.status == "live" ? "Live" : event.status == "final" ? "Complete" : "Upcoming"
    }

    private func detailRow(icon: String, label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 13) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(SupporterHomeColors.accent)
                .frame(width: 20)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 5) {
                Text(label)
                    .font(.system(size: detailLabelPointSize, weight: .heavy))
                    .tracking(1.3)
                    .foregroundStyle(SupporterHomeColors.muted)
                Text(value)
                    .font(.system(size: detailValuePointSize, weight: .semibold))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
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

    private func load() async {
        state = .loading
        if let fixture {
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
            state = .loaded(schedule: result.schedule, event: result.event)
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled else { return }
            state = .unavailable(error.localizedDescription)
        }
    }
}
