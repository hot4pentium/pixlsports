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
    let clerk: Clerk
    @Binding var showingAccountLink: Bool

    @StateObject private var viewModel = SupporterHomeViewModel()

    init(clerk: Clerk, showingAccountLink: Binding<Bool>) {
        self.clerk = clerk
        self._showingAccountLink = showingAccountLink
    }

    var body: some View {
        NavigationStack {
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

                ScrollView {
                    VStack(alignment: .leading, spacing: 24) {
                        header
                        accountConnectionSection
                        nextEventSection
                    }
                    .frame(maxWidth: 560, alignment: .leading)
                    .padding(.horizontal, 22)
                    .padding(.top, 20)
                    .padding(.bottom, 40)
                    .frame(maxWidth: .infinity)
                }
                .refreshable {
                    await viewModel.load(clerk: clerk)
                }
            }
        }
#if os(iOS)
        .toolbar(.hidden, for: .navigationBar)
#endif
        .preferredColorScheme(.dark)
        .task {
            await viewModel.load(clerk: clerk)
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await viewModel.load(clerk: clerk) }
        }
        .onChange(of: showingAccountLink) { wasShowing, isShowing in
            guard wasShowing && !isShowing else { return }
            Task { await viewModel.load(clerk: clerk) }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 18) {
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

            VStack(alignment: .leading, spacing: 8) {
                Text("YOUR SEASON")
                    .font(.system(size: 11, weight: .black))
                    .tracking(2.1)
                    .foregroundStyle(SupporterHomeColors.accent)

                Text("Your schedule")
                    .font(.system(size: 35, weight: .black, design: .rounded))
                    .tracking(-0.7)
                    .foregroundStyle(.white)

                Text("Your private schedule, at a glance.")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(SupporterHomeColors.muted)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var nextEventSection: some View {
        switch viewModel.state {
        case .notConnected:
            messageCard(
                icon: "link",
                title: "Connect your PIXL account",
                message: "Securely link the iPhone app to the PIXL Sports account that owns your Event Cards."
            )
        case .loading:
            HStack(spacing: 14) {
                ProgressView()
                    .tint(SupporterHomeColors.accent)
                VStack(alignment: .leading, spacing: 5) {
                    Text("Loading your schedule")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                    Text("Checking your connected Event Cards…")
                        .font(.system(size: 14))
                        .foregroundStyle(SupporterHomeColors.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Loading your private schedule")
        case let .schedule(page, events):
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .lastTextBaseline) {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("EVENT CARDS")
                            .font(.system(size: 10, weight: .black))
                            .tracking(1.9)
                            .foregroundStyle(SupporterHomeColors.muted)
                        Text(events.isEmpty ? "Coming up" : "Up next")
                            .font(.system(size: 24, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                    }
                    Spacer()
                    if !events.isEmpty {
                        Text("\(events.count) \(events.count == 1 ? "EVENT" : "EVENTS")")
                            .font(.system(size: 9, weight: .black))
                            .tracking(1.1)
                            .foregroundStyle(SupporterHomeColors.accent)
                    }
                }

                if events.isEmpty {
                    emptyScheduleCard()
                } else {
                    NavigationLink {
                        SupporterEventDetailView(clerk: clerk, shareToken: events[0].event.shareToken)
                    } label: {
                        eventCard(page: page, event: events[0].event, timing: events[0].timing)
                    }
                    .buttonStyle(.plain)

                    if events.count > 1 {
                        Text("MORE UPCOMING")
                            .font(.system(size: 11, weight: .black))
                            .tracking(1.6)
                            .foregroundStyle(SupporterHomeColors.muted)
                            .padding(.top, 7)
                        ForEach(Array(events.dropFirst())) { item in
                            compactEventCard(page: page, item: item)
                        }
                    }
                }
            }
        case let .failed(message):
            VStack(alignment: .leading, spacing: 14) {
                Label("We couldn’t load your schedule", systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                Text(message)
                    .font(.system(size: 14))
                    .foregroundStyle(SupporterHomeColors.muted)
                Button {
                    Task { await viewModel.load(clerk: clerk) }
                } label: {
                    Label("Try again", systemImage: "arrow.clockwise")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(SupporterHomeColors.background)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .background(SupporterHomeColors.accent, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
        }
    }

    private var accountConnectionSection: some View {
        let isLinked: Bool
        let isChecking: Bool
        if case .schedule = viewModel.state {
            isLinked = true
            isChecking = false
        } else if case .loading = viewModel.state {
            isLinked = false
            isChecking = true
        } else {
            isLinked = false
            isChecking = false
        }

        return VStack(alignment: .leading, spacing: 12) {
            Label(
                isLinked ? "PIXL ACCOUNT CONNECTED" : isChecking ? "CHECKING PIXL ACCOUNT" : "PRIVATE PIXL SCHEDULE",
                systemImage: isLinked ? "checkmark.shield.fill" : isChecking ? "arrow.triangle.2.circlepath" : "lock.fill"
            )
            .font(.system(size: 11, weight: .heavy))
            .tracking(1.4)
            .foregroundStyle(isLinked ? SupporterHomeColors.accent : SupporterHomeColors.muted)

            Text(isLinked
                 ? "Schedule data is loaded from your verified PIXL account."
                 : isChecking
                    ? "Verifying your private schedule connection…"
                    : "Connect the PIXL account you already use. Approval is required on both devices.")
                .font(.system(size: 13))
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                showingAccountLink = true
            } label: {
                HStack {
                    Image(systemName: isLinked ? "person.crop.circle.badge.checkmark" : "link")
                    Text(isLinked ? "Manage PIXL connection" : "Connect PIXL account")
                    Spacer()
                    Image(systemName: "arrow.right")
                }
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(SupporterHomeColors.background)
                .padding(.horizontal, 16)
                .padding(.vertical, 13)
                .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .disabled(isChecking)
        }
        .padding(18)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(.white.opacity(0.09), lineWidth: 1)
        }
    }

    private func eventCard(
        page: NativeSupporterSchedule,
        event: AthleteFanEvent,
        timing: SupporterEventTiming
    ) -> some View {
        VStack(alignment: .leading, spacing: 19) {
            HStack(alignment: .top, spacing: 14) {
                eventDateBadge(event)

                VStack(alignment: .leading, spacing: 7) {
                    Text(timing == .live ? "HAPPENING NOW" : "UP NEXT")
                        .font(.system(size: 10, weight: .black))
                        .tracking(1.6)
                        .foregroundStyle(SupporterHomeColors.accent)

                    Text(event.type == "game" ? (page.teamName ?? "Game") : "Practice")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(SupporterHomeColors.muted)

                    Text(event.type == "game" && !event.opponent.isEmpty
                         ? "vs \(event.opponent)"
                         : event.type == "game" ? event.title : (page.teamName ?? "Practice"))
                        .font(.system(size: 25, weight: .black, design: .rounded))
                        .tracking(-0.4)
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 12, weight: .black))
                    .foregroundStyle(.white.opacity(0.74))
                    .padding(9)
                    .background(.white.opacity(0.08), in: Circle())
            }

            HStack(spacing: 7) {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 10, weight: .bold))
                Text(page.athleteName ?? "Your athlete")
                    .lineLimit(1)
                if let seasonName = page.seasonName, !seasonName.isEmpty {
                    Circle().fill(SupporterHomeColors.accent.opacity(0.75)).frame(width: 4, height: 4)
                    Text(seasonName)
                        .lineLimit(1)
                }
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(SupporterHomeColors.muted)

            Rectangle()
                .fill(.white.opacity(0.12))
                .frame(height: 1)

            VStack(alignment: .leading, spacing: 12) {
                eventDetail(icon: "calendar", text: event.formattedDate(timezone: event.timezone ?? page.timezone))
                eventDetail(icon: "clock", text: event.formattedTime(timezone: event.timezone ?? page.timezone))
                eventDetail(
                    icon: "mappin.and.ellipse",
                    text: event.location.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? "Location to be announced"
                        : event.location
                )
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
                                colors: [SupporterHomeColors.blue.opacity(0.78), .white.opacity(0.13), SupporterHomeColors.accent.opacity(0.55)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            ),
                            lineWidth: 1
                        )
                }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(timing == .live ? "Happening now" : "Up next"), \(page.athleteName ?? "your athlete"), \(page.teamName ?? "team"), \(event.opponent), \(event.formattedDate(timezone: event.timezone ?? page.timezone)), \(event.formattedTime(timezone: event.timezone ?? page.timezone)), \(event.location). Tap to view details.")
    }

    private func compactEventCard(page: NativeSupporterSchedule, item: SupporterScheduleItem) -> some View {
        NavigationLink {
            SupporterEventDetailView(clerk: clerk, shareToken: item.event.shareToken)
        } label: {
            HStack(alignment: .top, spacing: 13) {
                Image(systemName: item.timing == .live ? "dot.radiowaves.left.and.right" : "calendar")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(SupporterHomeColors.accent)
                    .frame(width: 38, height: 38)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 5) {
                    Text(item.event.title)
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("\(item.event.formattedDate(timezone: item.event.timezone ?? page.timezone)) · \(item.event.formattedTime(timezone: item.event.timezone ?? page.timezone))")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(SupporterHomeColors.muted)
                    if !item.event.location.isEmpty {
                        Text(item.event.location)
                            .font(.system(size: 12))
                            .foregroundStyle(SupporterHomeColors.muted)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                if item.timing == .live {
                    Text("LIVE")
                        .font(.system(size: 9, weight: .black))
                        .tracking(1)
                        .foregroundStyle(SupporterHomeColors.background)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 5)
                        .background(SupporterHomeColors.accent, in: Capsule())
                }
                Image(systemName: "chevron.right")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(SupporterHomeColors.muted.opacity(0.8))
            }
            .padding(15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 18))
            .overlay {
                RoundedRectangle(cornerRadius: 18)
                    .stroke(Color.white.opacity(0.1), lineWidth: 1)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(item.event.title), \(item.event.formattedDate(timezone: item.event.timezone ?? page.timezone)), \(item.event.formattedTime(timezone: item.event.timezone ?? page.timezone)). View Event Card details.")
    }

    private func eventDetail(icon: String, text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 11) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(SupporterHomeColors.accent)
                .frame(width: 18)
            Text(text)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.white.opacity(0.9))
                .fixedSize(horizontal: false, vertical: true)
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

    private func emptyScheduleCard() -> some View {
        VStack(alignment: .leading, spacing: 17) {
            HStack {
                Image(systemName: "calendar")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(SupporterHomeColors.background)
                    .frame(width: 46, height: 46)
                    .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 14))

                Spacer()

                Text("ALL CAUGHT UP")
                    .font(.system(size: 9, weight: .black))
                    .tracking(1.4)
                    .foregroundStyle(SupporterHomeColors.accent)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(SupporterHomeColors.accent.opacity(0.1), in: Capsule())
            }

            VStack(alignment: .leading, spacing: 7) {
                Text("No upcoming Event Cards")
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                Text("New Event Cards from your connected PIXL account will show up here.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 8) {
                Capsule()
                    .fill(SupporterHomeColors.accent)
                    .frame(width: 28, height: 3)
                Capsule()
                    .fill(SupporterHomeColors.blue.opacity(0.75))
                    .frame(width: 12, height: 3)
                Text("YOUR SEASON, ONE EVENT AT A TIME")
                    .font(.system(size: 8, weight: .heavy))
                    .tracking(1.05)
                    .foregroundStyle(SupporterHomeColors.muted.opacity(0.88))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(19)
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

    private func messageCard(icon: String, title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 11) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(SupporterHomeColors.accent)
            Text(title)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
            Text(message)
                .font(.system(size: 14))
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
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
}
