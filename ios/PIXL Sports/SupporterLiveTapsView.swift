import SwiftUI
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
        fixture: Fixture? = nil
    ) {
        self.inviteToken = inviteToken
        self.sport = sport
        self.athleteName = athleteName
        self.eventTitle = eventTitle
        self.fixture = fixture
        self._summary = State(initialValue: fixture?.summary)
        self._loading = State(initialValue: fixture.map { _ in false } ?? true)
        self._error = State(initialValue: fixture?.error)
        self._accessToken = State(initialValue: fixture?.accessToken)
    }

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [SupporterHomeColors.background, Color(red: 0.04, green: 0.11, blue: 0.22)],
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
                    .accessibilityElement(children: .combine)

                    accessCard

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
        .navigationTitle("Live Taps")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
        .task { await loadSummary() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, case nil = fixture {
                Task { await loadSummary() }
            }
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
                        .background(SupporterHomeColors.background)
                    }
                }
                .navigationTitle("Scan family QR")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button("Done") { isScanning = false }
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
                    .foregroundStyle(.white.opacity(0.86))
            }

            Spacer()

            if !dynamicTypeSize.isAccessibilitySize {
                Text("SUPPORTER HUB")
                    .font(.system(size: brandCaptionSize, weight: .heavy))
                    .tracking(1.5)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .background(.white.opacity(0.06), in: Capsule())
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
                .disabled(accessToken == nil || !pendingCheerKeys.isEmpty)
                .opacity(accessToken == nil ? 0.56 : 1)
                .accessibilityLabel("\(cheer.label), \(cheer.count) cheers")
                .accessibilityHint(accessToken == nil
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
    }

    private func loadSummary() async {
        guard case nil = fixture else { return }
        loading = true
        summary = nil
        error = nil
        defer { loading = false }
        do {
            let result = try await SupporterHomeAPI.fetchLiveTapSummary(inviteToken: inviteToken)
            guard !Task.isCancelled else { return }
            guard result.sport == sport else {
                summary = nil
                error = "This Event Card’s sport doesn’t match its Live Taps session."
                return
            }
            summary = result.summary
            error = nil
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled else { return }
            self.error = error.localizedDescription
        }
    }

    private func send(_ cheerKey: String) async {
        guard let accessToken, pendingCheerKeys.isEmpty else { return }
        pendingCheerKeys.insert(cheerKey)
        error = nil
        defer { pendingCheerKeys.remove(cheerKey) }
        do {
            let updated = try await SupporterHomeAPI.sendLiveTap(
                inviteToken: inviteToken,
                accessToken: accessToken,
                cheerKey: cheerKey
            )
            summary = updated
        } catch is CancellationError {
        } catch {
            let message = error.localizedDescription
            if message.localizedCaseInsensitiveContains("valid family Live Taps link") {
                self.accessToken = nil
            }
            if message.localizedCaseInsensitiveContains("available only while Game Day Live is active") {
                await loadSummary()
                return
            }
            self.error = message
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
