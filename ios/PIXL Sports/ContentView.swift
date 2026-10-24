import SwiftUI

private enum SupporterHomeColors {
    static let background = Color(red: 0.035, green: 0.075, blue: 0.15)
    static let panel = Color(red: 0.075, green: 0.13, blue: 0.23)
    static let accent = Color(red: 0.72, green: 0.94, blue: 0.25)
    static let muted = Color(red: 0.68, green: 0.75, blue: 0.86)
}

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase

    @AppStorage("pixlsports.supporter.athlete-page-link")
    private var savedAthletePageLink = ""

    @StateObject private var viewModel = SupporterHomeViewModel()
    @State private var draftAthletePageLink = ""
    @State private var isEditingLink = true
    @State private var linkError: String?

    var body: some View {
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
                    nextEventSection
                    athletePageSection
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.top, 28)
                .padding(.bottom, 36)
                .frame(maxWidth: .infinity)
            }
            .refreshable {
                guard !savedAthletePageLink.isEmpty else { return }
                await viewModel.load(from: savedAthletePageLink)
            }
        }
        .preferredColorScheme(.dark)
        .task(id: savedAthletePageLink) {
            guard !savedAthletePageLink.isEmpty else {
                viewModel.reset()
                return
            }
            await viewModel.load(from: savedAthletePageLink)
        }
        .onAppear {
            draftAthletePageLink = savedAthletePageLink
            isEditingLink = savedAthletePageLink.isEmpty
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, !savedAthletePageLink.isEmpty else { return }
            Task { await viewModel.load(from: savedAthletePageLink) }
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

            Text("Supporter Home")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .foregroundStyle(.white)

            Text("The next big moment starts here.")
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
                icon: "calendar.badge.plus",
                title: "Connect an athlete page",
                message: "Add a PIXL Sports athlete page link to see their next published Event Card here."
            )
        case .loading:
            HStack(spacing: 14) {
                ProgressView()
                    .tint(SupporterHomeColors.accent)
                VStack(alignment: .leading, spacing: 5) {
                    Text("Finding the next event")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                    Text("Loading the latest schedule…")
                        .font(.system(size: 14))
                        .foregroundStyle(SupporterHomeColors.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Loading the next event")
        case let .event(page, event, timing):
            eventCard(page: page, event: event, timing: timing)
        case let .empty(page):
            messageCard(
                icon: "calendar",
                title: "No upcoming events yet",
                message: "\(page.athleteName)’s next Event Card will appear here when it’s published on their athlete page."
            )
        case let .failed(message):
            VStack(alignment: .leading, spacing: 14) {
                Label("We couldn’t load the schedule", systemImage: "exclamationmark.triangle.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                Text(message)
                    .font(.system(size: 14))
                    .foregroundStyle(SupporterHomeColors.muted)
                Button {
                    Task { await viewModel.load(from: savedAthletePageLink) }
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

    private var athletePageSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(isEditingLink ? "ATHLETE PAGE LINK" : "CONNECTED ATHLETE")
                    .font(.system(size: 11, weight: .heavy))
                    .tracking(1.5)
                    .foregroundStyle(SupporterHomeColors.muted)

                Spacer()

                if !savedAthletePageLink.isEmpty && !isEditingLink {
                    Button("Change") {
                        draftAthletePageLink = savedAthletePageLink
                        linkError = nil
                        isEditingLink = true
                    }
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(SupporterHomeColors.accent)
                }
            }

            if isEditingLink {
                TextField("https://pixlsports.com/fan/…", text: $draftAthletePageLink)
                    .athletePageURLInputModifiers()
                    .padding(15)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
                    .overlay {
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(Color.white.opacity(0.12), lineWidth: 1)
                    }
                    .accessibilityLabel("Athlete page link")

                if let linkError {
                    Text(linkError)
                        .font(.system(size: 13))
                        .foregroundStyle(Color(red: 1, green: 0.65, blue: 0.61))
                }

                Button {
                    saveAthletePageLink()
                } label: {
                    HStack {
                        Text("Show my next event")
                        Spacer()
                        Image(systemName: "arrow.right")
                    }
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(SupporterHomeColors.background)
                    .padding(.horizontal, 17)
                    .padding(.vertical, 15)
                    .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 15))
                }
                .buttonStyle(.plain)

                Text("Paste the athlete page link shared with you. Your link is saved on this iPhone.")
                    .font(.system(size: 12))
                    .foregroundStyle(SupporterHomeColors.muted)
            } else {
                Text(savedAthletePageLink)
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.85))
                    .lineLimit(2)
                    .textSelection(.enabled)
            }
        }
        .padding(18)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 20))
    }

    private func eventCard(
        page: AthleteFanPage,
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
                    Text(page.athleteName)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(SupporterHomeColors.muted)
                }

                Spacer()

                Text(page.seasonName.uppercased())
                    .font(.system(size: 10, weight: .heavy))
                    .tracking(1.1)
                    .foregroundStyle(.white.opacity(0.78))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 7)
                    .background(Color.white.opacity(0.09), in: Capsule())
                    .lineLimit(1)
            }

            VStack(alignment: .leading, spacing: 7) {
                Text(event.type == "game" ? page.teamName : "Practice")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(SupporterHomeColors.muted)
                Text(event.type == "game" && !event.opponent.isEmpty
                     ? "vs \(event.opponent)"
                     : event.type == "game" ? "Game day" : page.teamName)
                    .font(.system(size: 27, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Rectangle()
                .fill(Color.white.opacity(0.12))
                .frame(height: 1)

            VStack(alignment: .leading, spacing: 13) {
                eventDetail(icon: "calendar", text: event.formattedDate(timezone: page.timezone))
                eventDetail(icon: "clock", text: event.formattedTime(timezone: page.timezone))
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
        .accessibilityLabel("\(timing == .live ? "Happening now" : "Up next"), \(page.athleteName), \(page.teamName), \(event.opponent), \(event.formattedDate(timezone: page.timezone)), \(event.formattedTime(timezone: page.timezone))")
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

    private func saveAthletePageLink() {
        let value = draftAthletePageLink.trimmingCharacters(in: .whitespacesAndNewlines)
        guard SupporterHomeAPI.inviteToken(from: value) != nil else {
            linkError = "Paste a valid PIXL Sports athlete page link, such as pixlsports.com/fan/…"
            return
        }
        savedAthletePageLink = value
        linkError = nil
        isEditingLink = false
    }
}

private extension View {
    @ViewBuilder
    func athletePageURLInputModifiers() -> some View {
#if os(iOS)
        textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.URL)
            .textContentType(.URL)
#else
        self
#endif
    }
}

extension AthleteFanEvent {
    func formattedDate(timezone: String?) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timezone ?? "") ?? .current
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: self.date) else { return self.date }
        formatter.dateFormat = "EEEE, MMMM d"
        return formatter.string(from: date)
    }

    func formattedTime(timezone: String?) -> String {
        guard let start = parsedStart(timezone: timezone) else {
            return time.isEmpty ? "Time to be announced" : time
        }
        let formatter = DateFormatter()
        formatter.locale = Locale.current
        formatter.timeZone = TimeZone(identifier: timezone ?? "") ?? .current
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: start)
    }

    func parsedStart(timezone: String?) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: timezone ?? "") ?? .current
        formatter.isLenient = false

        for pattern in ["yyyy-MM-dd HH:mm", "yyyy-MM-dd H:mm", "yyyy-MM-dd h:mm a"] {
            formatter.dateFormat = pattern
            if let date = formatter.date(from: "\(self.date) \(time)") {
                return date
            }
        }
        return nil
    }
}

#Preview {
    ContentView()
}
