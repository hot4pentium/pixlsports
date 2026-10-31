import SwiftUI
import ClerkKit
import CoreImage.CIFilterBuiltins
import UIKit

@MainActor
struct NativeEventFanAccessView: View {
    @Environment(\.scenePhase) private var scenePhase
    let event: AthleteFanEvent
    let athleteName: String
    let clerk: Clerk
    let hasActiveLiveTapsElsewhere: Bool
    @State private var grant: Grant?
    @State private var fanURL: URL?
    @State private var links: [AccessLink] = []
    @State private var busy = false
    @State private var loadingHypeCard = false
    @State private var startingLiveTaps = false
    @State private var error: String?
    @State private var liveTapsStartError: String?
    @State private var hypeCard: NativePublicHypeCard?
    @State private var soccerPeriodFormat: String?
    @State private var pendingRevocation: String?

    private struct Grant: Decodable {
        let id: String
        let accessToken: String
        let inviteToken: String
    }
    private struct AccessLink: Decodable, Identifiable {
        let id: String
        let createdAt: String
    }
    private struct LinkList: Decodable { let links: [AccessLink] }
    private struct CreatedShare: Decodable { let shareToken: String }
    private struct StartedLiveSession: Decodable { let shareToken: String }
    private struct StartLiveBody: Encodable { let shareToken: String }

    private struct LiveTapsOnlyShareInput: Encodable {
        let athleteName: String
        let teamName: String
        let game: Game
    }

    private struct Game: Encodable {
        struct Play: Encodable {
            let id: String
            let statId: String
            let createdAt: Date
            let period: Int
            let attribution: String
            let yards: Int?
        }

        let id: String
        let sourceEventId: String
        let liveTapsOnly: Bool
        let sport: String
        let status: String
        let date: String
        let opponent: String
        let period: Int
        let soccerPeriodFormat: String?
        let score: Int
        let opponentScore: Int
        let possessionSide: String?
        let stats: [String: Int]
        let opponentStats: [String: Int]?
        let athleteStats: [String: Int]
        let athleteYardStats: [String: Int]
        let trackYards: Bool
        let yardStats: [String: Int]
        let opponentYardStats: [String: Int]?
        let events: [Play]

        init(event: AthleteFanEvent, sport: String, soccerPeriodFormat: String?) {
            id = "tracker-game-\(UUID().uuidString.lowercased())"
            sourceEventId = event.eventId
            liveTapsOnly = true
            self.sport = sport
            status = "live"
            date = event.date
            opponent = event.opponent
            period = 1
            self.soccerPeriodFormat = sport == "soccer" ? soccerPeriodFormat : nil
            score = 0
            opponentScore = 0
            possessionSide = sport == "football" ? "athlete" : nil
            stats = [:]
            opponentStats = sport == "football" ? [:] : nil
            athleteStats = [:]
            athleteYardStats = [:]
            trackYards = sport == "football"
            yardStats = [:]
            opponentYardStats = sport == "football" ? [:] : nil
            events = []
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Label("Fans at the game", systemImage: "qrcode")
                .font(.headline)
            Text("Fans with this QR can send cheers when your athlete is live—not edit stats or account data. QR access remains valid until you revoke it.")
                .font(.caption)
                .foregroundStyle(SupporterHomeColors.muted)
            if let grant, let fanURL, event.liveTapsActive, event.liveTapsOnly {
                if let image = Self.qrImage(fanURL) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 250)
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel("Fan Live Taps access QR. Show it to fans at the game.")
                        .accessibilityIdentifier("native-live-taps-qr")
                    ShareLink(
                        item: Image(uiImage: image),
                        preview: SharePreview("PIXL Sports · Fan Live Taps QR", image: Image(uiImage: image))
                    ) {
                        Label("Share QR image", systemImage: "square.and.arrow.up")
                    }
                    .frame(minHeight: 44)
                } else {
                    Text("The QR image couldn’t be rendered. You can still share the fan link.")
                        .foregroundStyle(.orange)
                }
                ShareLink(item: fanURL) {
                    Label("Share fan link", systemImage: "link")
                }
                .frame(minHeight: 44)
                Button("Revoke this QR", role: .destructive) { pendingRevocation = grant.id }
                    .frame(minHeight: 44)
                    .disabled(busy)
            } else {
                Button {
                    Task { await perform("create") }
                } label: {
                    Label("Create fan QR", systemImage: "qrcode")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || !event.liveTapsActive || !event.liveTapsOnly)
                .accessibilityIdentifier("native-live-taps-create-qr")
            }
            if busy { ProgressView("Updating fan access…") }
            Button("Refresh fan access") { Task { await perform("list") } }
                .font(.caption)
                .frame(minHeight: 44)
                .disabled(busy)
            if let error {
                Text(error).font(.subheadline).foregroundStyle(.orange)
                Button("Reload fan access") { Task { await perform("list") } }
                    .frame(minHeight: 44)
                    .disabled(busy)
            }
            if !links.isEmpty {
                DisclosureGroup("Existing family QR access for this athlete") {
                    ForEach(links) { link in
                        HStack {
                            Text("QR · \(String(link.createdAt.prefix(10))) · \(String(link.id.prefix(6)))")
                                .font(.caption)
                            Spacer(minLength: 8)
                            Button("Revoke", role: .destructive) { pendingRevocation = link.id }
                                .frame(minHeight: 44)
                                .disabled(busy)
                        }
                    }
                }
                .font(.subheadline)
            }
            Divider().overlay(Color.white.opacity(0.12))
            if event.liveTapsActive, event.liveTapsOnly,
               let inviteToken = event.liveTapsInviteToken,
               let sport = event.liveTapsSport {
                SupporterLiveTapsView(
                    inviteToken: inviteToken, sport: sport,
                    athleteName: athleteName, eventTitle: event.title,
                    embedded: true, suppliedAccessToken: grant?.accessToken
                )
            } else if event.liveTapsActive {
                Label(
                    event.liveTapsOnly ? "Live Taps is active" : "Stat tracking is active",
                    systemImage: event.liveTapsOnly ? "hands.clap.fill" : "chart.bar.fill"
                )
                    .font(.subheadline)
                Text(event.liveTapsOnly
                    ? "Refresh this Event Card to reopen the fan taps."
                    : "Finish this stats game before starting a separate Live Taps-only session.")
                    .font(.caption)
                    .foregroundStyle(SupporterHomeColors.muted)
            } else if hasActiveLiveTapsElsewhere {
                Label("Live Taps is already active for another Event Card.", systemImage: "pause.circle")
                    .font(.subheadline)
                Text("End or finish that game before starting a separate Live Taps-only session.")
                    .font(.caption)
                    .foregroundStyle(SupporterHomeColors.muted)
            } else {
                Label("No active Live Taps session for this Event Card.", systemImage: "pause.circle")
                    .font(.subheadline)
                Text("Start a cheer-only session for fans at the game. It will not record player stats.")
                    .font(.caption)
                    .foregroundStyle(SupporterHomeColors.muted)
                if loadingHypeCard {
                    ProgressView("Checking your HYPE Card…")
                } else if let hypeCard {
                    if hypeCard.sport == "soccer" {
                        HStack(spacing: 8) {
                            soccerFormatButton("Halves", value: "halves")
                            soccerFormatButton("Quarters", value: "quarters")
                        }
                        .accessibilityIdentifier("native-live-taps-soccer-format")
                    }
                    Button {
                        Task { await startLiveTapsOnly(sport: hypeCard.sport) }
                    } label: {
                        Label("Start Live Taps only", systemImage: "hands.clap")
                            .frame(maxWidth: .infinity, minHeight: 46)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(startingLiveTaps || (hypeCard.sport == "soccer" && soccerPeriodFormat == nil))
                    .accessibilityIdentifier("native-live-taps-start")
                } else {
                    Text("Set up a Player Showcase before starting Live Taps.")
                        .font(.caption)
                        .foregroundStyle(SupporterHomeColors.muted)
                }
                if startingLiveTaps { ProgressView("Starting cheer-only Live Taps…") }
                if let liveTapsStartError {
                    Text(liveTapsStartError).font(.subheadline).foregroundStyle(.orange)
                }
            }
        }
        .tint(SupporterHomeColors.accent)
        .task {
            await perform("list")
            if !event.liveTapsActive && !hasActiveLiveTapsElsewhere { await loadHypeCard() }
        }
        .onChange(of: event.liveTapsActive) { _, isActive in
            if isActive {
                Task { await perform("list") }
            } else if hypeCard == nil && !hasActiveLiveTapsElsewhere {
                Task { await loadHypeCard() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await perform("list") } }
        }
        .confirmationDialog(
            "Revoke this fan QR?", isPresented: Binding(
                get: { pendingRevocation != nil },
                set: { if !$0 { pendingRevocation = nil } }
            ), titleVisibility: .visible
        ) {
            Button("Revoke QR access", role: .destructive) {
                if let id = pendingRevocation { Task { await perform("revoke", id: id) } }
                pendingRevocation = nil
            }
        } message: {
            Text("Anyone using this QR will lose Live Taps access. Other family QR codes will keep working.")
        }
    }

    private func soccerFormatButton(_ title: String, value: String) -> some View {
        Button {
            soccerPeriodFormat = value
        } label: {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 42)
                .background(
                    soccerPeriodFormat == value ? SupporterHomeColors.blue.opacity(0.35) : Color.white.opacity(0.06),
                    in: RoundedRectangle(cornerRadius: 12)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(Color.white.opacity(soccerPeriodFormat == value ? 0.48 : 0.12), lineWidth: 1)
                }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(soccerPeriodFormat == value ? .isSelected : [])
    }

    private func loadHypeCard() async {
        guard !loadingHypeCard, !event.liveTapsActive else { return }
        loadingHypeCard = true
        defer { loadingHypeCard = false }
        do {
            hypeCard = try await SupporterHomeAPI.fetchPublicHypeCard(clerk: clerk)
            if hypeCard == nil || hypeCard?.inviteToken == nil {
                liveTapsStartError = "No active Player Showcase is available for Live Taps."
            }
        } catch {
            liveTapsStartError = error.localizedDescription
        }
    }

    private func startLiveTapsOnly(sport: String) async {
        guard !startingLiveTaps, !event.liveTapsActive, !hasActiveLiveTapsElsewhere,
              let hypeCard, let inviteToken = hypeCard.inviteToken else { return }
        guard sport != "soccer" || soccerPeriodFormat != nil else { return }
        startingLiveTaps = true
        liveTapsStartError = nil
        defer { startingLiveTaps = false }
        do {
            let client = NativeAccountLinkClient()
            let shareBody = LiveTapsOnlyShareInput(
                athleteName: hypeCard.athleteName,
                teamName: hypeCard.teamName,
                game: Game(event: event, sport: sport, soccerPeriodFormat: soccerPeriodFormat)
            )
            let createdData = try await client.postData(
                "stat-tracker-shares", body: shareBody, apiRoot: true, clerk: clerk
            )
            let created = try JSONDecoder().decode(CreatedShare.self, from: createdData)
            let startedData = try await client.postData(
                "athlete-invites/\(inviteToken)/live",
                body: StartLiveBody(shareToken: created.shareToken),
                apiRoot: true,
                clerk: clerk
            )
            let started = try JSONDecoder().decode(StartedLiveSession.self, from: startedData)
            guard started.shareToken == created.shareToken else {
                throw NativeAccountLinkError.message("Live Taps could not be connected to this Event Card.")
            }
            NotificationCenter.default.post(name: .nativeEventToolsSaved, object: nil)
        } catch {
            liveTapsStartError = error.localizedDescription
        }
    }

    private func perform(_ action: String, id: String? = nil) async {
        guard !busy, let userID = clerk.user?.id else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            var body = ["shareToken": event.shareToken, "action": action]
            if let id { body["accessId"] = id }
            let data = try await NativeAccountLinkClient().postData("supporter/live-taps-access", body: body, clerk: clerk)
            guard !Task.isCancelled, clerk.user?.id == userID else { return }
            if action == "create" {
                let result = try JSONDecoder().decode(Grant.self, from: data)
                guard result.inviteToken == event.liveTapsInviteToken else {
                    throw NativeAccountLinkError.message("The active athlete changed. Reopen this Event Card.")
                }
                let origin = try NativeAccountLinkClient.apiOrigin()
                guard var components = URLComponents(
                    url: origin.appendingPathComponent("fan").appendingPathComponent(result.inviteToken),
                    resolvingAgainstBaseURL: false
                ) else { throw NativeAccountLinkError.message("Check the app’s API address.") }
                components.fragment = "live-taps=\(result.accessToken)"
                guard let url = components.url else {
                    throw NativeAccountLinkError.message("Couldn’t create the fan link.")
                }
                grant = result
                fanURL = url
            } else if action == "revoke", grant?.id == id {
                grant = nil
                fanURL = nil
            }
            if action == "list" {
                links = try JSONDecoder().decode(LinkList.self, from: data).links
            } else {
                let list = try await NativeAccountLinkClient().postData(
                    "supporter/live-taps-access", body: ["shareToken": event.shareToken, "action": "list"], clerk: clerk
                )
                guard !Task.isCancelled, clerk.user?.id == userID else { return }
                links = try JSONDecoder().decode(LinkList.self, from: list).links
            }
            if let current = grant, !links.contains(where: { $0.id == current.id }) {
                grant = nil
                fanURL = nil
            }
        } catch is CancellationError {
        } catch {
            guard clerk.user?.id == userID else { return }
            self.error = error.localizedDescription
        }
    }

    private static func qrImage(_ url: URL) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(url.absoluteString.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let image = CIContext().createCGImage(output, from: output.extent) else { return nil }
        let source = UIImage(cgImage: image)
        // Include the quiet zone in the shared image, not only in the on-screen view.
        let size = CGSize(width: source.size.width + 64, height: source.size.height + 64)
        return UIGraphicsImageRenderer(size: size).image { context in
            UIColor.white.setFill()
            context.cgContext.fill(CGRect(origin: .zero, size: size))
            context.cgContext.interpolationQuality = .none
            source.draw(at: CGPoint(x: 32, y: 32))
        }
    }
}
