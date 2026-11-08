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
    var isActive: Bool = true
    var sessionManagementOnly: Bool = false
    @State private var grant: Grant?
    @State private var fanURL: URL?
    @State private var links: [AccessLink] = []
    @State private var busy = false
    @State private var loadingHypeCard = false
    @State private var startingLiveTaps = false
    @State private var endingLiveTaps = false
    @State private var showingEndConfirmation = false
    @State private var endedLiveTaps = false
    @State private var liveTapsEndError: String?
    @State private var error: String?
    @State private var liveTapsStartError: String?
    @State private var hypeCard: NativeOwnerLiveTapsContext?
    @State private var soccerPeriodFormat: String?
    @State private var pendingRevocation: String?
    @State private var celebration: NativeLiveTapCelebration?
    @AccessibilityFocusState private var endFocused: Bool

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
    private struct StartedLiveSession: Decodable { let shareToken: String }
    private struct StartLiveBody: Encodable {
        let eventId: String
        let soccerPeriodFormat: String?
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if !sessionManagementOnly {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Label("Fan QR handoff", systemImage: "qrcode")
                        .font(.headline)
                    Spacer(minLength: 8)
                    Text(fanAccessStatus)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(hasReadyFanQR ? SupporterHomeColors.accent : SupporterHomeColors.muted)
                        .multilineTextAlignment(.trailing)
                        .accessibilityIdentifier("native-live-taps-qr-status")
                }
                Text("Fans can use this QR to send cheers when Live Taps is active—not edit stats or account data. QR access remains valid until you revoke it.")
                    .font(.caption)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("native-live-taps-qr-lifetime")
            }
            .accessibilityIdentifier("native-live-taps-fan-handoff")

            if hasReadyFanQR, let grant, let fanURL {
                if let image = Self.qrImage(fanURL) {
                    Image(uiImage: image)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 250)
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel("Fan Live Taps access QR. Show it to fans at the game.")
                        // Keep a stable, grant-specific identity so UI checks can
                        // confirm that switching tools did not create a new QR.
                        .accessibilityIdentifier("native-live-taps-qr-\(grant.id)")
                    ShareLink(
                        item: Image(uiImage: image),
                        preview: SharePreview("PIXL Sports · Fan Live Taps QR", image: Image(uiImage: image))
                    ) {
                        Label("Share QR image", systemImage: "square.and.arrow.up")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("native-live-taps-share-qr")
                } else {
                    Text("The QR image couldn’t be rendered. Share the fan link instead.")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ShareLink(item: fanURL) {
                    Label("Share fan link", systemImage: "link")
                }
                .frame(minHeight: 44)
                .accessibilityIdentifier("native-live-taps-share-link")
                Button("Revoke this QR", role: .destructive) { pendingRevocation = grant.id }
                    .frame(minHeight: 44)
                    .disabled(busy)
                    .accessibilityIdentifier("native-live-taps-revoke-qr")
            } else {
                if !links.isEmpty {
                    Text("An earlier QR is still active, but its image and link can’t be recovered on this device. Create a new QR for this handoff, or revoke the older access below.")
                        .font(.caption)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button {
                    Task { await perform("create") }
                } label: {
                    Label(links.isEmpty ? "Create fan QR" : "Create another fan QR", systemImage: "qrcode")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || endingLiveTaps || endedLiveTaps || !event.liveTapsActive || hypeCard?.ownerOnly == true)
                .accessibilityIdentifier("native-live-taps-create-qr")
                if !event.liveTapsActive {
                    Text("Start Live Taps for this Event Card before creating fan access.")
                        .font(.caption)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if hypeCard?.ownerOnly == true {
                    Text("Your starter HYPE Card is private. Owner cheers work here; fan QR sharing stays off while the public page is paused.")
                        .font(.caption)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
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
            let otherLinks = links.filter { $0.id != grant?.id }
            if !otherLinks.isEmpty {
                DisclosureGroup(hasReadyFanQR ? "Other active family QR codes" : "Active family QR codes") {
                    ForEach(otherLinks) { link in
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
            }
            Divider().overlay(Color.white.opacity(0.12))
            Label("Live Taps session", systemImage: "hands.clap")
                .font(.headline)
                .accessibilityIdentifier("native-live-taps-session-heading")
            if event.liveTapsActive, !endedLiveTaps,
               let inviteToken = event.liveTapsInviteToken,
               let sport = event.liveTapsSport {
                if !sessionManagementOnly {
                SupporterLiveTapsView(
                    inviteToken: inviteToken, sport: sport,
                    athleteName: athleteName, eventTitle: event.title,
                    embedded: true, ownerClerk: clerk, expectedEventId: event.eventId,
                    isActive: isActive
                )
                .disabled(endingLiveTaps)
                Text("Fans can keep cheering while stat tracking is paused. Cheers stay separate from official stats.")
                    .font(.caption)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("native-live-taps-stats-pause-note")
                }
                Button(role: .destructive) {
                    showingEndConfirmation = true
                } label: {
                    HStack {
                        if endingLiveTaps { ProgressView() }
                        Label(endingLiveTaps ? "Ending Live Taps…" : "End Live Taps", systemImage: "stop.circle")
                            .frame(maxWidth: .infinity, minHeight: 46)
                    }
                }
                .buttonStyle(.bordered)
                .disabled(endingLiveTaps || busy)
                .accessibilityIdentifier("native-live-taps-end")
                .accessibilityFocused($endFocused)
                if let liveTapsEndError {
                    Text(liveTapsEndError)
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .accessibilityIdentifier("native-live-taps-end-error")
                }
            } else if endedLiveTaps {
                Label("Live Taps ended", systemImage: "checkmark.circle.fill")
                    .font(.headline)
                    .accessibilityFocused($endFocused)
                Text("Your cheers are saved. Your Event Card and any stat tracking are unchanged.")
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .accessibilityIdentifier("native-live-taps-ended")
            } else if event.liveTapsActive {
                Label("Live Taps is active", systemImage: "hands.clap.fill")
                    .font(.subheadline)
                Text("Refresh this Event Card to reopen the fan taps.")
                    .font(.caption)
                    .foregroundStyle(SupporterHomeColors.muted)
            } else if sessionManagementOnly {
                Text("Use Share to end an existing Live Taps session. New game-day tools open 10 minutes before game time.")
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
                Text("Fans can cheer while you track stats. Cheers stay separate from official stats.")
                    .font(.caption)
                    .foregroundStyle(SupporterHomeColors.muted)
                if loadingHypeCard {
                    ProgressView("Checking your athlete’s Live Taps access…")
                } else if let hypeCard {
                    if hypeCard.sport == "soccer" {
                        HStack(spacing: 8) {
                            soccerFormatButton("Halves", value: "halves")
                            soccerFormatButton("Quarters", value: "quarters")
                        }
                        .accessibilityIdentifier("native-live-taps-soccer-format")
                    }
                    Button {
                        Task { await startLiveTaps(sport: hypeCard.sport) }
                    } label: {
                        Label("Start Live Taps", systemImage: "hands.clap")
                            .frame(maxWidth: .infinity, minHeight: 46)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(startingLiveTaps || (hypeCard.sport == "soccer" && soccerPeriodFormat == nil))
                    .accessibilityIdentifier("native-live-taps-start")
                } else {
                    Button("Refresh athlete access") { Task { await loadHypeCard() } }
                        .font(.caption)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .disabled(loadingHypeCard)
                }
                if startingLiveTaps { ProgressView("Starting Live Taps…") }
                if let liveTapsStartError {
                    Text(liveTapsStartError).font(.subheadline).foregroundStyle(.orange)
                }
            }
        }
        .tint(SupporterHomeColors.accent)
        .task {
            await perform("list")
            if !sessionManagementOnly && !hasActiveLiveTapsElsewhere { await loadHypeCard() }
            await recoverCelebration()
        }
        .onChange(of: event.liveTapsActive) { _, isActive in
            if isActive {
                endedLiveTaps = false
                Task { await perform("list") }
            } else if !sessionManagementOnly && hypeCard == nil && !hasActiveLiveTapsElsewhere {
                Task { await loadHypeCard() }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await perform("list"); await recoverCelebration() } }
        }
        .onChange(of: isActive) { _, active in
            if active { Task { await recoverCelebration() } }
        }
        .onChange(of: event.eventId) { _, _ in
            endedLiveTaps = false
            liveTapsEndError = nil
        }
        .confirmationDialog(
            showingEndConfirmation ? "End Live Taps?" : "Revoke this fan QR?", isPresented: Binding(
                get: { showingEndConfirmation || pendingRevocation != nil },
                set: {
                    if !$0 {
                        showingEndConfirmation = false
                        pendingRevocation = nil
                    }
                }
            ), titleVisibility: .visible
        ) {
            if showingEndConfirmation {
                Button("End Live Taps", role: .destructive) {
                    Task { await endLiveTaps() }
                }
                Button("Keep cheering", role: .cancel) {}
            } else {
                Button("Revoke QR access", role: .destructive) {
                    if let id = pendingRevocation { Task { await perform("revoke", id: id) } }
                    pendingRevocation = nil
                }
            }
        } message: {
            Text(showingEndConfirmation
                 ? "New cheers will stop. Your cheer totals and Event Card will stay saved, and stat tracking will continue if it’s running."
                 : "Anyone using this QR will lose Live Taps access. Other family QR codes will keep working.")
        }
        .sheet(item: $celebration, onDismiss: {
            endFocused = true
            notifyLiveTapsEnded()
        }) { value in
            NativeLiveTapCelebrationView(celebration: value)
        }
    }

    private var hasReadyFanQR: Bool {
        grant != nil && fanURL != nil
    }

    private var fanAccessStatus: String {
        FamilyLiveTapQR.handoffReadiness(
            hasLocalQR: hasReadyFanQR,
            activeQRCount: links.count
        ).rawValue
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
        guard !sessionManagementOnly, !loadingHypeCard,
              let subject = clerk.user?.id else { return }
        loadingHypeCard = true
        hypeCard = nil
        liveTapsStartError = nil
        defer { loadingHypeCard = false }
        do {
            let context = try await SupporterHomeAPI.fetchOwnerLiveTapsContext(clerk: clerk)
            guard clerk.user?.id == subject, !Task.isCancelled else { return }
            hypeCard = context
        } catch {
            guard clerk.user?.id == subject else { return }
            liveTapsStartError = error.localizedDescription
        }
    }

    private func endLiveTaps() async {
        guard !endingLiveTaps, !endedLiveTaps, event.liveTapsActive,
              let inviteToken = event.liveTapsInviteToken else { return }
        endingLiveTaps = true
        liveTapsEndError = nil
        defer { endingLiveTaps = false }
        do {
            guard let sport = event.liveTapsSport else { return }
            let outbox = NativeLiveTapOutbox.shared
            let scope = try outbox.prepare(
                inviteToken: inviteToken, sport: sport, ownerClerk: clerk,
                accessToken: nil, eventId: event.eventId
            )
            await NativeLiveTapOutbox.shared.flushAll()
            if let subject = clerk.user?.id,
               NativeLiveTapOutbox.shared.pendingCount(inviteToken: inviteToken, ownerSubject: subject, eventId: event.eventId) > 0 {
                liveTapsEndError = "Your cheers are waiting to send. Let them finish before ending Live Taps."
                return
            }
            let current = try await SupporterHomeAPI.fetchLiveTapSummary(inviteToken: inviteToken, ownerClerk: clerk)
            let gameID = outbox.snapshot(scope)?.endingGameID ?? current.summary.gameId
            guard let gameID else {
                await recoverCelebration()
                return
            }
            try outbox.beginEnding(gameID: gameID, scope: scope)
            let data = try await NativeAccountLinkClient().postData(
                "athlete-invites/\(inviteToken)/live",
                body: ["eventId": event.eventId, "gameId": gameID],
                method: "DELETE", apiRoot: true, clerk: clerk
            )
            let result = try JSONDecoder().decode(NativeLiveTapEndResult.self, from: data)
            endedLiveTaps = true
            if let completion = result.completion, isActive, scenePhase == .active {
                celebration = try outbox.claimCelebration(completion, scope: scope, ownerEnded: true)
            }
            if celebration == nil { notifyLiveTapsEnded() }
        } catch {
            liveTapsEndError = "Couldn’t confirm Live Taps ended. Try again."
        }
    }

    private func recoverCelebration() async {
        guard isActive, scenePhase == .active, celebration == nil, !endingLiveTaps,
              !showingEndConfirmation, pendingRevocation == nil,
              let inviteToken = event.liveTapsInviteToken ?? hypeCard?.inviteToken,
              let sport = event.liveTapsSport ?? hypeCard?.sport else { return }
        do {
            let outbox = NativeLiveTapOutbox.shared
            let scope = try outbox.prepare(inviteToken: inviteToken, sport: sport, ownerClerk: clerk, accessToken: nil, eventId: event.eventId)
            guard let gameID = outbox.snapshot(scope)?.endingGameID else { return }
            // Retry only the explicit saved End intent. The authenticated,
            // game-bound response retains owner context even when Events is hidden.
            let data = try await NativeAccountLinkClient().postData(
                "athlete-invites/\(inviteToken)/live", body: ["eventId": event.eventId, "gameId": gameID],
                method: "DELETE", apiRoot: true, clerk: clerk
            )
            let result = try JSONDecoder().decode(NativeLiveTapEndResult.self, from: data)
            guard let completion = result.completion else { return }
            celebration = try outbox.claimCelebration(completion, scope: scope, ownerEnded: true)
            endedLiveTaps = true
        } catch {
            // Keep the saved end intent so a later connection can confirm it.
        }
    }

    private func notifyLiveTapsEnded() {
        let reason = NativeEventScheduleChangeReason.liveTapsEnded
        NotificationCenter.default.post(
            name: .nativeEventScheduleChanged, object: nil,
            userInfo: [NativeEventScheduleChangeReason.userInfoKey: reason.rawValue]
        )
    }

    private func startLiveTaps(sport: String) async {
        guard !sessionManagementOnly, !startingLiveTaps, !event.liveTapsActive, !hasActiveLiveTapsElsewhere,
              let hypeCard, let inviteToken = hypeCard.inviteToken else { return }
        guard sport != "soccer" || soccerPeriodFormat != nil else { return }
        startingLiveTaps = true
        liveTapsStartError = nil
        defer { startingLiveTaps = false }
        do {
            let client = NativeAccountLinkClient()
            let startedData = try await client.postData(
                "athlete-invites/\(inviteToken)/live",
                body: StartLiveBody(
                    eventId: event.eventId,
                    soccerPeriodFormat: sport == "soccer" ? soccerPeriodFormat : nil
                ),
                apiRoot: true,
                clerk: clerk
            )
            let started = try JSONDecoder().decode(StartedLiveSession.self, from: startedData)
            guard !started.shareToken.isEmpty else {
                throw NativeAccountLinkError.message("Live Taps could not be connected to this Event Card.")
            }
            let reason = NativeEventScheduleChangeReason.liveTapsStarted
            NotificationCenter.default.post(
                name: .nativeEventScheduleChanged,
                object: nil,
                userInfo: [NativeEventScheduleChangeReason.userInfoKey: reason.rawValue]
            )
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
