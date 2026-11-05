import SwiftUI
import ClerkKit
import UIKit
import Vision
import VisionKit

@MainActor
struct SupporterLiveTapsView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    let inviteToken: String
    let sport: String
    let athleteName: String
    let eventTitle: String
    let embedded: Bool
    let suppliedAccessToken: String?
    let ownerClerk: Clerk?
    let expectedEventId: String?
    private let fixture: Fixture?

    @ScaledMetric(relativeTo: .largeTitle) private var eventTitleSize = 28
    @ScaledMetric(relativeTo: .body) private var bodySize = 14
    @ScaledMetric(relativeTo: .body) private var buttonSize = 14
    @ScaledMetric(relativeTo: .body) private var cheerLabelSize = 16
    @ScaledMetric(relativeTo: .title3) private var cheerCountSize = 18
    @ScaledMetric(relativeTo: .title2) private var messageTitleSize = 18
    @ScaledMetric(relativeTo: .title2) private var messageIconSize = 22
    @ScaledMetric(relativeTo: .body) private var sectionLabelSize = 11
    @ScaledMetric(relativeTo: .caption) private var supportingLabelSize = 12
    @ScaledMetric(relativeTo: .caption) private var statusLabelSize = 10
    @ScaledMetric(relativeTo: .caption2) private var brandCaptionSize = 9
    @ScaledMetric(relativeTo: .headline) private var brandTitleSize = 16
    @ScaledMetric(relativeTo: .title2) private var cheerEmojiSize = 23

    @State private var summary: LiveTapSummary?
    @State private var loading: Bool
    @State private var error: String?
    @State private var accessToken: String?
    @State private var isScanning = false
    @State private var pendingCheerKeys = Set<String>()
    @ObservedObject private var outbox = NativeLiveTapOutbox.shared
    @ObservedObject private var offline = NativeOfflineRuntime.shared
    @State private var outboxScope: String?
    @State private var showingDiscard = false

    struct Fixture {
        let summary: LiveTapSummary?
        let accessToken: String?
        let error: String?
    }

    init(
        inviteToken: String,
        sport: String,
        athleteName: String,
        eventTitle: String,
        fixture: Fixture? = nil,
        embedded: Bool = false,
        suppliedAccessToken: String? = nil,
        ownerClerk: Clerk? = nil,
        expectedEventId: String? = nil
    ) {
        self.inviteToken = inviteToken
        self.sport = sport
        self.athleteName = athleteName
        self.eventTitle = eventTitle
        self.fixture = fixture
        self.embedded = embedded
        self.suppliedAccessToken = suppliedAccessToken
        self.ownerClerk = ownerClerk
        self.expectedEventId = expectedEventId
        self._summary = State(initialValue: fixture?.summary)
        self._loading = State(initialValue: fixture.map { _ in false } ?? true)
        self._error = State(initialValue: fixture?.error)
        self._accessToken = State(initialValue: fixture?.accessToken ?? suppliedAccessToken)
    }

    var body: some View {
        Group {
            if embedded {
                inlineContent
            } else {
        ZStack {
            NativePageBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    brandHeader

                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .top, spacing: 7) {
                            Image(systemName: "dot.radiowaves.left.and.right")
                            Text("GAME DAY LIVE")
                                .fixedSize(horizontal: false, vertical: true)
                        }
                            .font(.system(size: sectionLabelSize, weight: .black))
                            .tracking(dynamicTypeSize.isAccessibilitySize ? 0 : 1.5)
                            .foregroundStyle(SupporterHomeColors.accent)
                        Text(eventTitle)
                            .font(.system(size: eventTitleSize, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Cheer for \(athleteName). Live Taps do not record player stats.")
                            .font(.system(size: bodySize))
                            .foregroundStyle(SupporterHomeColors.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .overlay {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(SupporterHomeColors.blue.opacity(0.28), lineWidth: 1)
                    }
                    .supporterSurfaceShadow()
                    .accessibilityElement(children: .combine)

                    if ownerClerk == nil { accessCard }
                    deliveryStatus

                    if loading {
                        ProgressView("Checking the active cheer session…")
                            .font(.body)
                            .tint(SupporterHomeColors.accent)
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(20)
                            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
                            .overlay {
                                RoundedRectangle(cornerRadius: 20)
                                    .stroke(.white.opacity(0.1), lineWidth: 1)
                            }
                            .supporterSurfaceShadow()
                    } else if let summary {
                        if summary.active {
                            cheersCard(summary)
                        } else {
                            messageCard(
                                icon: "pause.circle",
                                title: "Live Taps aren’t active",
                                message: "Ask the card owner to start Live Taps for this Event Card."
                            )
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                            messageCard(
                                icon: "wifi.slash",
                                title: "Couldn’t check Live Taps",
                                message: error ?? "Try again to check this Event Card’s active session."
                            )
                            Button {
                                Task { await loadSummary() }
                            } label: {
                                Label("Try again", systemImage: "arrow.clockwise")
                                    .font(.system(size: buttonSize, weight: .bold))
                                    .foregroundStyle(SupporterHomeColors.background)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 11)
                                    .frame(minHeight: 44)
                                    .background(SupporterHomeColors.accent, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("live-taps-retry")
                        }
                    }

                    if summary != nil, let error {
                        HStack(alignment: .top, spacing: 9) {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .accessibilityHidden(true)
                            Text(error)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                            .font(.system(size: bodySize, weight: .medium))
                            .foregroundStyle(Color.orange.opacity(0.95))
                            .padding(13)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.orange.opacity(0.11), in: RoundedRectangle(cornerRadius: 14))
                            .overlay {
                                RoundedRectangle(cornerRadius: 14)
                                    .stroke(Color.orange.opacity(0.28), lineWidth: 1)
                            }
                    }
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(.horizontal, 22)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
            }
        }
            }
        }
        .eventToolNavigationTitle("Live Taps", embedded: embedded)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .task { await loadSummary() }
        .onChange(of: suppliedAccessToken) { _, token in accessToken = token }
        .onChange(of: outbox.revision) { _, _ in
            guard let outboxScope, let session = outbox.snapshot(outboxScope) else { return }
            if ownerClerk == nil { accessToken = session.accessToken }
            if let saved = session.summary, summary == nil || summary?.gameId == saved.gameId { summary = saved }
        }
        .onChange(of: offline.vault.namespace) { _, _ in
            guard ownerClerk != nil else { return }
            outboxScope = nil
            summary = nil
            Task { await loadSummary() }
        }
        .onChange(of: offline.revocationGeneration) { _, _ in
            guard ownerClerk != nil else { return }
            outboxScope = nil
            summary = nil
            error = "Sign in again to open your saved cheers. They have not been removed."
        }
        .onChange(of: ownerClerk?.user?.id) { _, _ in
            outboxScope = nil
            summary = nil
            Task { await loadSummary() }
        }
        .onChange(of: offline.online) { _, online in
            if online {
                Task {
                    await outbox.flushAll()
                    await loadSummary()
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, case nil = fixture {
                Task { await loadSummary() }
            }
        }
        .confirmationDialog("Remove unsent cheers?", isPresented: $showingDiscard, titleVisibility: .visible) {
            Button("Remove unsent cheers", role: .destructive) {
                guard let outboxScope else { return }
                do { try outbox.discard(outboxScope) }
                catch { self.error = error.localizedDescription }
            }
            Button("Keep them saved", role: .cancel) {}
        } message: {
            Text("These cheers have not been confirmed by PIXL. Removing them means this iPhone will no longer try to send them. Cheers already delivered will stay saved.")
        }
        .sheet(isPresented: $isScanning) {
            NavigationStack {
                Group {
                    if DataScannerViewController.isSupported && DataScannerViewController.isAvailable {
                        FamilyLiveTapQRScanner(
                            onCode: handleScannedCode,
                            onStartFailure: {
                                error = "The camera couldn’t start. Check camera access and try again."
                                isScanning = false
                            }
                        )
                        .ignoresSafeArea()
                    } else {
                        ContentUnavailableView(
                            "QR scanning isn’t available",
                            systemImage: "qrcode.viewfinder",
                            description: Text("Use an iPhone with camera access to scan the owner’s private family QR.")
                        )
                        .background { NativePageBackground() }
                    }
                }
                .navigationTitle("Scan family QR")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            isScanning = false
                        } label: {
                            Text("Done").nativeToolbarLabel()
                        }
                    }
                }
            }
        }
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
                    .font(.system(size: brandTitleSize, weight: .black, design: .rounded))
                    .tracking(1.4)
                    .foregroundStyle(SupporterHomeColors.blue)
                Text("SPORTS")
                    .font(.system(size: brandCaptionSize, weight: .heavy, design: .rounded))
                    .tracking(3.3)
                    .foregroundStyle(SupporterHomeColors.background)
            }

            Spacer()

            if !dynamicTypeSize.isAccessibilitySize {
                Text("SUPPORTER HUB")
                    .font(.system(size: brandCaptionSize, weight: .heavy))
                    .tracking(1.5)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(SupporterHomeColors.panel, in: Capsule())
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var accessCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: accessToken == nil ? "lock.fill" : "checkmark.shield.fill")
                Text(accessToken == nil ? "PRIVATE FAMILY ACCESS REQUIRED" : "FAMILY ACCESS READY")
                    .fixedSize(horizontal: false, vertical: true)
            }
            .font(.system(size: sectionLabelSize, weight: .heavy))
            .tracking(dynamicTypeSize.isAccessibilitySize ? 0 : 1.2)
            .foregroundStyle(accessToken == nil ? SupporterHomeColors.muted : SupporterHomeColors.accent)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("live-taps-access-status")

            Text(accessToken == nil
                 ? "Scan the private family QR shown by the card owner. The public Event Card link is view-only."
                 : "This device is authorized by the owner’s private QR. The owner can revoke access.")
                .font(.system(size: bodySize))
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("live-taps-qr-instructions")

            Button {
                error = nil
                isScanning = true
            } label: {
                Label(
                    accessToken == nil ? "Scan private family QR" : "Scan another family QR",
                    systemImage: "qrcode.viewfinder"
                )
                .font(.system(size: buttonSize, weight: .bold))
                .foregroundStyle(SupporterHomeColors.background)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .frame(minHeight: 44)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.center)
                .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("live-taps-scan-qr")
        }
        .padding(18)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(
                    LinearGradient(
                        colors: [
                            SupporterHomeColors.blue.opacity(0.65),
                            .white.opacity(0.1),
                            SupporterHomeColors.accent.opacity(0.35)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        }
        .supporterSurfaceShadow()
    }

    @ViewBuilder
    private var inlineContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            if ownerClerk == nil && suppliedAccessToken == nil { accessCard }
            deliveryStatus
            if loading {
                ProgressView("Loading Live Taps…")
            } else if let summary, summary.active {
                cheersCard(summary)
                Button("Refresh cheers") { Task { await loadSummary() } }
                    .frame(minHeight: 44)
            } else {
                messageCard(
                    icon: "hands.clap",
                    title: "Live Taps aren’t available",
                    message: error ?? "There is no active cheer session for this Event Card."
                )
                Button("Check again") { Task { await loadSummary() } }
                    .frame(minHeight: 44)
            }
            if let error, summary != nil {
                Text(error).font(.caption).foregroundStyle(.orange)
            }
        }
        .tint(SupporterHomeColors.accent)
    }

    private func cheersCard(_ summary: LiveTapSummary) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 10) {
                Text("SEND A CHEER")
                    .font(.system(size: sectionLabelSize, weight: .black))
                    .tracking(dynamicTypeSize.isAccessibilitySize ? 0 : 1.5)
                    .foregroundStyle(SupporterHomeColors.accent)
                Text("Cheer counts only · no player stats")
                    .font(.system(size: supportingLabelSize, weight: .medium))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Circle()
                        .fill(SupporterHomeColors.accent)
                        .frame(width: 7, height: 7)
                    Text("SESSION ACTIVE")
                        .font(.system(size: statusLabelSize, weight: .black))
                        .tracking(dynamicTypeSize.isAccessibilitySize ? 0 : 0.9)
                        .foregroundStyle(SupporterHomeColors.accent)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 9)
                .padding(.vertical, 7)
                .background(SupporterHomeColors.accent.opacity(0.11), in: Capsule())
                .accessibilityLabel("Live Taps session active")
                .accessibilityIdentifier("live-taps-session-status")
            }

            ForEach(summary.cheers) { cheer in
                Button {
                    Task { await send(cheer.key) }
                } label: {
                    Group {
                        if dynamicTypeSize.isAccessibilitySize {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(alignment: .top, spacing: 12) {
                                    cheerEmoji(cheer.emoji)
                                    Text(cheer.label)
                                        .font(.system(size: cheerLabelSize, weight: .bold))
                                        .foregroundStyle(.white)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                }
                                HStack(spacing: 8) {
                                    Text("\(cheer.count) cheers")
                                        .font(.system(size: supportingLabelSize, weight: .heavy, design: .rounded))
                                        .foregroundStyle(SupporterHomeColors.accent)
                                    Spacer(minLength: 8)
                                    if pendingCheerKeys.contains(cheer.key) {
                                        ProgressView()
                                            .tint(SupporterHomeColors.accent)
                                        Text("Sending…")
                                            .font(.system(size: supportingLabelSize, weight: .medium))
                                            .foregroundStyle(SupporterHomeColors.muted)
                                    }
                                }
                            }
                        } else {
                            HStack(spacing: 12) {
                                cheerEmoji(cheer.emoji)
                                Text(cheer.label)
                                    .font(.system(size: cheerLabelSize, weight: .bold))
                                    .foregroundStyle(.white)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 8)
                                Text("\(cheer.count)")
                                    .font(.system(size: cheerCountSize, weight: .heavy, design: .rounded))
                                    .foregroundStyle(SupporterHomeColors.accent)
                                if queuedCount(cheer.key, gameId: summary.gameId) > 0 {
                                    Text("+\(queuedCount(cheer.key, gameId: summary.gameId)) saved here")
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                }
                                if pendingCheerKeys.contains(cheer.key) {
                                    ProgressView()
                                        .tint(SupporterHomeColors.accent)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 13)
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 15))
                }
                .buttonStyle(.plain)
                .disabled(!hasCheerAccess || !pendingCheerKeys.isEmpty)
                .opacity(hasCheerAccess ? 1 : 0.56)
                .accessibilityLabel("\(cheer.label), \(cheer.count) confirmed cheers, \(queuedCount(cheer.key, gameId: summary.gameId)) saved on this iPhone")
                .accessibilityHint(!hasCheerAccess
                    ? "Scan the owner’s private family QR before sending a cheer."
                    : "Send one \(cheer.label) cheer.")
                .accessibilityIdentifier("live-taps-cheer-\(cheer.key)")
            }
        }
        .padding(18)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(SupporterHomeColors.blue.opacity(0.42), lineWidth: 1)
        }
        .supporterSurfaceShadow()
    }

    private func cheerEmoji(_ emoji: String) -> some View {
        Text(emoji)
            .font(.system(size: cheerEmojiSize))
            .frame(minWidth: 34, minHeight: 34)
            .accessibilityHidden(true)
    }

    private func messageCard(icon: String, title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: messageIconSize, weight: .semibold))
                .foregroundStyle(SupporterHomeColors.accent)
            Text(title)
                .font(.system(size: messageTitleSize, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("live-taps-message-title")
            Text(message)
                .font(.system(size: bodySize))
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("live-taps-message")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(.white.opacity(0.1), lineWidth: 1)
        }
        .supporterSurfaceShadow()
    }

    private func loadSummary() async {
        guard case nil = fixture else { return }
        if summary == nil { loading = true }
        error = nil
        defer { loading = false }
        do {
            let scope = try outbox.prepare(
                inviteToken: inviteToken, sport: sport, ownerClerk: ownerClerk, accessToken: accessToken,
                eventId: expectedEventId
            )
            outboxScope = scope
            if let saved = outbox.snapshot(scope) {
                if summary == nil { summary = saved.summary }
                if ownerClerk == nil, accessToken == nil { accessToken = saved.accessToken }
            }
            if summary != nil { loading = false }
            if !offline.online {
                if summary == nil { error = "Open this game with a connection first so it’s ready for offline cheers." }
                return
            }
            let result = try await SupporterHomeAPI.fetchLiveTapSummary(inviteToken: inviteToken)
            guard !Task.isCancelled else { return }
            guard result.sport == sport else {
                summary = nil
                error = "This Event Card’s sport doesn’t match its Live Taps session."
                return
            }
            summary = result.summary
            try outbox.remember(result.summary, scope: scope, accessToken: accessToken)
            error = nil
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled else { return }
            self.error = summary == nil ? "Couldn’t open Live Taps. Try again. Existing saved cheers have not been removed."
                : "Couldn’t refresh the totals. You can keep saving cheers on this iPhone."
        }
    }

    private var hasCheerAccess: Bool {
        (ownerClerk != nil || accessToken != nil) && (fixture != nil || outboxScope != nil)
    }

    private func queuedCount(_ cheerKey: String, gameId: String?) -> Int {
        guard let outboxScope else { return 0 }
        return outbox.snapshot(outboxScope)?.pending.filter { $0.gameId == gameId && $0.cheerKey == cheerKey }.count ?? 0
    }

    @ViewBuilder
    private var deliveryStatus: some View {
        if let outboxScope, let saved = outbox.snapshot(outboxScope), !saved.pending.isEmpty {
            let waiting = saved.pending.filter { !$0.needsAttention }.count
            let attention = saved.pending.count - waiting
            VStack(alignment: .leading, spacing: 10) {
                if waiting > 0 {
                    Label("\(waiting) \(waiting == 1 ? "cheer" : "cheers") waiting to send",
                          systemImage: "clock.arrow.circlepath")
                        .font(.subheadline.weight(.semibold))
                }
                if attention > 0 {
                    Label("\(attention) \(attention == 1 ? "cheer needs" : "cheers need") attention",
                          systemImage: "exclamationmark.circle")
                        .font(.subheadline.weight(.semibold))
                }
                Text(outbox.messages[outboxScope] ?? (attention > 0
                    ? "These cheers are saved here but haven’t been delivered. Try sending again, or remove them if you no longer want them."
                    : "Saved on this iPhone. They’ll send when a connection is available and this game’s Live Taps session is still open."))
                    .font(.caption)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Try sending") { Task { await outbox.retry(outboxScope) } }
                    .disabled(!offline.online || outbox.sending.contains(outboxScope))
                    .frame(minHeight: 44)
                Button("Remove unsent cheers", role: .destructive) { showingDiscard = true }
                    .disabled(outbox.sending.contains(outboxScope))
                    .frame(minHeight: 44)
            }
            .foregroundStyle(SupporterHomeColors.muted)
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 14))
            .accessibilityIdentifier("live-taps-delivery-status")
        }
    }

    private func send(_ cheerKey: String) async {
        guard case nil = fixture, hasCheerAccess, let outboxScope, pendingCheerKeys.isEmpty else { return }
        pendingCheerKeys.insert(cheerKey)
        error = nil
        defer { pendingCheerKeys.remove(cheerKey) }
        do {
            try outbox.enqueue(cheerKey, scope: outboxScope, accessToken: accessToken)
        } catch is CancellationError {
        } catch {
            self.error = error is NativeOfflineError || error is NativeAccountLinkError
                ? error.localizedDescription
                : "Couldn’t save this cheer on your iPhone. It hasn’t been sent. Try again."
        }
    }

    private func handleScannedCode(_ value: String) {
        isScanning = false
        guard let origin = try? NativeAccountLinkClient.apiOrigin(),
              let token = FamilyLiveTapQR.accessToken(
                from: value,
                inviteToken: inviteToken,
                apiOrigin: origin
              ) else {
            error = "That QR code is not a valid family Live Taps link for this Event Card."
            return
        }
        accessToken = token
        error = nil
        if let outboxScope, let summary {
            do { try outbox.remember(summary, scope: outboxScope, accessToken: token) }
            catch { self.error = "Couldn’t securely save this family QR. Try scanning it again." }
        }
        isScanning = false
    }
}

private struct FamilyLiveTapQRScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void
    let onStartFailure: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onCode: onCode, onStartFailure: onStartFailure)
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .accurate,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        scanner.delegate = context.coordinator
        do {
            try scanner.startScanning()
        } catch {
            context.coordinator.onStartFailure()
        }
        return scanner
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {}

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void
        let onStartFailure: () -> Void
        private var handledCode = false

        init(onCode: @escaping (String) -> Void, onStartFailure: @escaping () -> Void) {
            self.onCode = onCode
            self.onStartFailure = onStartFailure
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            guard !handledCode,
                  let barcode = addedItems.compactMap({ item -> String? in
                      if case let .barcode(value) = item { return value.payloadStringValue }
                      return nil
                  }).first else { return }
            handledCode = true
            dataScanner.stopScanning()
            onCode(barcode)
        }
    }
}
