import SwiftUI
import ClerkKit

enum SupporterHomeColors {
    static let background = Color(red: 0.035, green: 0.075, blue: 0.15)
    static let panel = Color(red: 0.075, green: 0.13, blue: 0.23)
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
                    colors: [SupporterHomeColors.background, Color(red: 0.04, green: 0.11, blue: 0.22)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 26) {
                        header
                        accountConnectionSection
                        nextEventSection
                    }
                    .frame(maxWidth: 560, alignment: .leading)
                    .padding(.horizontal, 22)
                    .padding(.top, 28)
                    .padding(.bottom, 36)
                    .frame(maxWidth: .infinity)
                }
                .refreshable {
                    await viewModel.load(clerk: clerk)
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
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
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "sportscourt.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(SupporterHomeColors.background)
                    .frame(width: 34, height: 34)
                    .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 10))

                Text("PIXL SPORTS")
                    .font(.system(size: 13, weight: .black, design: .rounded))
                    .tracking(1.8)
                    .foregroundStyle(.white)
            }

            Text("Your schedule")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .foregroundStyle(.white)

            Text("Your private schedule, at a glance.")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(SupporterHomeColors.muted)
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
            if events.isEmpty {
                messageCard(
                    icon: "calendar",
                    title: "No upcoming Event Cards",
                    message: "New Event Cards from your connected PIXL account will appear here."
                )
            } else {
                VStack(alignment: .leading, spacing: 14) {
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
    }

    private func eventCard(
        page: NativeSupporterSchedule,
        event: AthleteFanEvent,
        timing: SupporterEventTiming
    ) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(timing == .live ? "HAPPENING NOW" : "UP NEXT")
                        .font(.system(size: 11, weight: .black))
                        .tracking(1.6)
                        .foregroundStyle(SupporterHomeColors.accent)
                    Text(page.athleteName ?? "Your athlete")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(SupporterHomeColors.muted)
                }

                Spacer()

                HStack(spacing: 8) {
                    if let seasonName = page.seasonName, !seasonName.isEmpty {
                        Text(seasonName.uppercased())
                            .font(.system(size: 10, weight: .heavy))
                            .tracking(1.1)
                            .foregroundStyle(.white.opacity(0.78))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 7)
                            .background(Color.white.opacity(0.09), in: Capsule())
                            .lineLimit(1)
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundStyle(SupporterHomeColors.muted)
                }
            }

            VStack(alignment: .leading, spacing: 7) {
                Text(event.type == "game" ? (page.teamName ?? "Game") : "Practice")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(SupporterHomeColors.muted)
                Text(event.type == "game" && !event.opponent.isEmpty
                      ? "vs \(event.opponent)"
                      : event.type == "game" ? event.title : (page.teamName ?? "Practice"))
                    .font(.system(size: 27, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Rectangle()
                .fill(Color.white.opacity(0.12))
                .frame(height: 1)

            VStack(alignment: .leading, spacing: 13) {
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
        .padding(21)
        .background {
            RoundedRectangle(cornerRadius: 24)
                .fill(
                    LinearGradient(
                        colors: [Color(red: 0.09, green: 0.20, blue: 0.36), SupporterHomeColors.panel],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 24)
                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
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
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
    }
}
