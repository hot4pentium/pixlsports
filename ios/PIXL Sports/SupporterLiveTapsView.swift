import SwiftUI
import UIKit
import VisionKit

@MainActor
struct SupporterLiveTapsView: View {
    @Environment(\.scenePhase) private var scenePhase

    let inviteToken: String
    let sport: String
    let athleteName: String
    let eventTitle: String

    @State private var summary: LiveTapSummary?
    @State private var loading = true
    @State private var error: String?
    @State private var accessToken: String?
    @State private var isScanning = false
    @State private var pendingCheerKeys = Set<String>()

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [SupporterHomeColors.background, Color(red: 0.04, green: 0.11, blue: 0.22)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Label("GAME DAY LIVE", systemImage: "dot.radiowaves.left.and.right")
                            .font(.system(size: 11, weight: .black))
                            .tracking(1.5)
                            .foregroundStyle(SupporterHomeColors.accent)
                        Text(eventTitle)
                            .font(.system(size: 28, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                        Text("Cheer for \(athleteName). Live Taps do not record player stats.")
                            .font(.system(size: 14))
                            .foregroundStyle(SupporterHomeColors.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityElement(children: .combine)

                    accessCard

                    if loading {
                        ProgressView("Checking the active cheer session…")
                            .tint(SupporterHomeColors.accent)
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(20)
                            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
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
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(SupporterHomeColors.background)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 11)
                                    .background(SupporterHomeColors.accent, in: Capsule())
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    if summary != nil, let error {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.orange)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityAddTraits(.isError)
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
            if phase == .active {
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

    private var accessCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(
                accessToken == nil ? "PRIVATE FAMILY ACCESS REQUIRED" : "FAMILY ACCESS READY",
                systemImage: accessToken == nil ? "lock.fill" : "checkmark.shield.fill"
            )
            .font(.system(size: 11, weight: .heavy))
            .tracking(1.2)
            .foregroundStyle(accessToken == nil ? SupporterHomeColors.muted : SupporterHomeColors.accent)

            Text(accessToken == nil
                 ? "Scan the private family QR shown by the card owner. The public Event Card link is view-only."
                 : "This device is authorized by the owner’s private QR. The owner can revoke access.")
                .font(.system(size: 14))
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)

            Button {
                error = nil
                isScanning = true
            } label: {
                Label(
                    accessToken == nil ? "Scan private family QR" : "Scan another family QR",
                    systemImage: "qrcode.viewfinder"
                )
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(SupporterHomeColors.background)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 13)
                .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 14))
            }
            .buttonStyle(.plain)
        }
        .padding(18)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
    }

    private func cheersCard(_ summary: LiveTapSummary) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("SEND A CHEER")
                .font(.system(size: 11, weight: .black))
                .tracking(1.5)
                .foregroundStyle(SupporterHomeColors.accent)

            ForEach(summary.cheers) { cheer in
                Button {
                    Task { await send(cheer.key) }
                } label: {
                    HStack(spacing: 12) {
                        Text(cheer.emoji)
                            .font(.system(size: 23))
                            .frame(width: 34)
                        Text(cheer.label)
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                        Spacer()
                        Text("\(cheer.count)")
                            .font(.system(size: 18, weight: .heavy, design: .rounded))
                            .foregroundStyle(SupporterHomeColors.accent)
                        if pendingCheerKeys.contains(cheer.key) {
                            ProgressView()
                                .tint(SupporterHomeColors.accent)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 13)
                    .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 15))
                }
                .buttonStyle(.plain)
                .disabled(accessToken == nil || !pendingCheerKeys.isEmpty)
                .opacity(accessToken == nil ? 0.56 : 1)
                .accessibilityLabel("\(cheer.label), \(cheer.count) cheers")
                .accessibilityHint(accessToken == nil
                    ? "Scan the owner’s private family QR before sending a cheer."
                    : "Send one \(cheer.label) cheer.")
            }
        }
        .padding(18)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
    }

    private func messageCard(icon: String, title: String, message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
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
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
    }

    private func loadSummary() async {
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
