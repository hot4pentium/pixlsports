import SwiftUI
import ClerkKit
import UIKit
import AVKit
import CoreImage.CIFilterBuiltins

private enum NativeHypeCardSide: String, CaseIterable, Identifiable, Equatable {
    case front = "Front"
    case stats = "Stats"
    case videos = "Videos"
    case events = "Events"

    var id: String { rawValue }

    var symbol: String {
        switch self {
        case .front: "rectangle.portrait"
        case .stats: "chart.bar.fill"
        case .videos: "play.rectangle"
        case .events: "calendar"
        }
    }
}

private struct NativeHypeCardSideTransition {
    let from: NativeHypeCardSide
    let to: NativeHypeCardSide
}

@MainActor
struct SupporterHypeCardView: View {
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var offlineRuntime = NativeOfflineRuntime.shared
    let clerk: Clerk?
    let publicInviteToken: String?
    private let showsAthleteDetailsShortcut: Bool
#if DEBUG
    private let fixturePublicCard: NativePublicHypeCard?
#endif

    @State private var card: NativePublicHypeCard?
    @State private var privateCard: NativePrivateHypeCard?
    @State private var privatePhoto: UIImage?
    @State private var athleteProfile: NativeSupporterProfile?
    @State private var settings: NativeHypeCardSettings?
    @State private var settingsAccountSubject: String?
    @State private var draftShowHypeCard = false
    @State private var draftShowStats = false
    @State private var draftShowEvents = false
    @State private var draftPaused = false
    @State private var draftFavoriteMoment = ""
    @State private var selectedSide: NativeHypeCardSide = .front
    @State private var backSideTransition: NativeHypeCardSideTransition?
    @State private var cardRotation = 0.0
    @State private var isFlipping = false
    @State private var flipTask: Task<Void, Never>?
    @State private var selectedVideoToken: String?
    @State private var videoPlayer: AVPlayer?
    @State private var isSaving = false
    @State private var isCheckingSettings = false
    @State private var settingsStatusUnknown = false
    @State private var settingsDraftRecoveryBlocked = false
    @State private var settingsDraftRevision: String?
    @State private var settingsRecoveryAfterRestart = false
    @State private var settingsRecoveryMarkerFound = false
    @State private var settingsRecoverySnapshot: NativeHypeCardSettings?
    @State private var settingsMessage: String?
    @State private var mediaErrorMessage: String?
    @State private var showPublishConfirmation = false
    @State private var showShareQR = false
    @State private var showIdentityCorrectionConfirmation = false
    @State private var identityMismatch = false
    @State private var identityCorrectionId: String?
    @State private var isCorrectingIdentity = false
    @State private var identityCorrectionMessage: String?
    @State private var unavailable = false
    @State private var errorMessage: String?
    @State private var refreshErrorMessage: String?
    @State private var loading = true
    @State private var isRefreshing = false
    @State private var focusPauseSettingOnOpen = false

    init(
        clerk: Clerk?,
        publicInviteToken: String? = nil,
        cachedOwnerPreview: NativeSupporterHypeCardPreview? = nil,
        focusPauseSetting: Bool = false,
        showsAthleteDetailsShortcut: Bool = false
    ) {
        self.clerk = clerk
        self.publicInviteToken = publicInviteToken
        self.showsAthleteDetailsShortcut = showsAthleteDetailsShortcut
        _focusPauseSettingOnOpen = State(initialValue: focusPauseSetting)
        let subject = Self.ownerSubject(clerk: clerk)
        let offline = NativeOfflineRuntime.shared
        let canUseOwnerCache = publicInviteToken == nil
            && subject.map { offline.vault.canContinue(subject: $0) } == true
        var storedPreview = cachedOwnerPreview
        if storedPreview == nil, canUseOwnerCache, let subject,
           let data = try? offline.vault.read("dashboard-preview", subject: subject) {
            storedPreview = try? JSONDecoder().decode(NativeSupporterHypeCardPreview.self, from: data)
        }
        var preview = canUseOwnerCache ? storedPreview : nil
        var cachedProfile: NativeSupporterProfile?
        if canUseOwnerCache, let subject,
           let data = try? offline.vault.read("get/supporter/profile", subject: subject) {
            cachedProfile = try? JSONDecoder().decode(NativeSupporterProfile.self, from: data)
        }
        if let cachedProfile { preview = preview?.followingProfile(cachedProfile) }
        var cachedIdentityMismatch = preview?.identityMismatch ?? false
        let cachedCardName = preview?.publicCard?.athleteName ?? preview?.privateCard?.athleteName
        let normalize: (String) -> String = { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        if let cachedCardName, let cachedProfile {
            let expectedTeam = normalize(cachedProfile.teamName)
            let cardTeam = normalize(preview?.publicCard?.teamName ?? preview?.privateCard?.teamName ?? "")
            if normalize(cachedProfile.athleteName) != normalize(cachedCardName)
                || (!expectedTeam.isEmpty && expectedTeam != cardTeam) {
                cachedIdentityMismatch = true
            }
        }
        let cachedSettings = preview?.settings
        var savedDraft: NativeHypeCardSettings?
        var draftRecoveryBlocked = false
        var confirmationPending = false
        var queuedSavePending = false
        if canUseOwnerCache, let subject {
            do {
                let client = NativeAccountLinkClient()
                savedDraft = try client.loadHypeCardSettingsDraft(subject: subject)
                confirmationPending = try client.hasPendingHypeCardSettingsConfirmation(subject: subject)
                queuedSavePending = try client.loadHypeCardSettingsSaveIntent(subject: subject) != nil
            } catch {
                savedDraft = nil
                draftRecoveryBlocked = true
            }
        } else {
            savedDraft = nil
        }
        let editorSettings = savedDraft ?? cachedSettings
        _card = State(initialValue: preview?.publicCard)
        _privateCard = State(initialValue: preview?.privateCard)
        _privatePhoto = State(initialValue: cachedIdentityMismatch ? nil : preview?.privatePhoto.flatMap(UIImage.init(data:)))
        _athleteProfile = State(initialValue: cachedProfile)
        _settings = State(initialValue: preview?.settings)
        _settingsAccountSubject = State(initialValue: preview == nil ? nil : subject)
        _settingsDraftRevision = State(initialValue: editorSettings?.revision)
        _draftShowHypeCard = State(initialValue: editorSettings?.showHypeCard ?? false)
        _draftShowStats = State(initialValue: editorSettings?.showStats ?? false)
        _draftShowEvents = State(initialValue: editorSettings?.showEvents ?? false)
        _draftPaused = State(initialValue: editorSettings?.paused ?? false)
        _draftFavoriteMoment = State(initialValue: editorSettings?.favoriteMoment ?? "")
        _settingsDraftRecoveryBlocked = State(initialValue: draftRecoveryBlocked)
        _settingsStatusUnknown = State(initialValue: confirmationPending)
        _settingsMessage = State(initialValue: draftRecoveryBlocked
            ? "Saved HYPE Card choices couldn’t be opened on this iPhone. They haven’t been deleted."
            : confirmationPending ? "Checking your saved HYPE Card changes with PIXL."
                : queuedSavePending ? "Your HYPE Card changes are saved on this iPhone and will sync automatically."
                : savedDraft == nil ? nil
                : "Your HYPE Card edits are saved on this iPhone. Tap Save when you’re ready to sync them.")
        _identityMismatch = State(initialValue: cachedIdentityMismatch)
        _identityCorrectionId = State(initialValue: preview?.correctionId)
        _loading = State(initialValue: preview == nil)
        _unavailable = State(initialValue: preview.map {
            $0.publicCard == nil && $0.privateCard == nil
        } ?? false)
#if DEBUG
        self.fixturePublicCard = nil
#endif
    }

#if DEBUG
    init(publicInviteToken: String, fixturePublicCard: NativePublicHypeCard) {
        self.clerk = nil
        self.publicInviteToken = publicInviteToken
        self.showsAthleteDetailsShortcut = false
        self.fixturePublicCard = fixturePublicCard
    }
#endif

    private var isPublicRecipient: Bool { publicInviteToken != nil }

    // Match the authenticated root's bounded continuation lease while Clerk
    // restores offline. A loaded, signed-out online session never uses it.
    private static func ownerSubject(clerk: Clerk?) -> String? {
        guard let clerk else { return nil }
        if let subject = clerk.user?.id { return subject }
        let offline = NativeOfflineRuntime.shared
        guard !offline.online || !clerk.isLoaded,
              offline.vault.canContinue(subject: nil) else { return nil }
        return offline.vault.subject
    }

    private var ownerSubject: String? { Self.ownerSubject(clerk: clerk) }

    var body: some View {
        ZStack {
            NativePageBackground()

            ScrollViewReader { scrollProxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        SupporterEyebrow(
                            text: isPublicRecipient ? "Shared HYPE Card" : "Player Showcase",
                            color: SupporterHomeColors.accentText
                        )
                        Text("HYPE Card")
                            .font(.largeTitle.weight(.black))
                            .fontDesign(.rounded)
                            .foregroundStyle(SupporterHomeColors.background)
                            .accessibilityAddTraits(.isHeader)

                        if !isPublicRecipient, !offlineRuntime.online, card != nil || privateCard != nil {
                            Label {
                                Text("Showing the last saved HYPE Card. Settings changes stay on this iPhone until you can sync them to PIXL.")
                            } icon: {
                                Image(systemName: "wifi.slash")
                            }
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(SupporterHomeColors.accentText)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(.white.opacity(0.84), in: RoundedRectangle(cornerRadius: 14))
                            .accessibilityIdentifier("native-hype-card-offline-status")
                        }

                        if isRefreshing {
                            HStack(spacing: 10) {
                                ProgressView()
                                    .tint(SupporterHomeColors.accent)
                                Text("Refreshing preview…")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(SupporterHomeColors.muted)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityElement(children: .combine)
                            .accessibilityIdentifier("native-hype-card-refreshing")
                        }

                        if let refreshErrorMessage {
                            VStack(alignment: .leading, spacing: 10) {
                                Label(
                                    isPublicRecipient ? "This HYPE Card couldn’t refresh" : "The preview couldn’t refresh",
                                    systemImage: "exclamationmark.triangle.fill"
                                )
                                    .font(.headline.weight(.bold))
                                    .foregroundStyle(.white)
                                Text(refreshErrorMessage)
                                    .font(.body)
                                    .foregroundStyle(SupporterHomeColors.muted)
                                Button("Try again") {
                                    Task { await loadCard(refresh: true) }
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(SupporterHomeColors.accent)
                                .foregroundStyle(SupporterHomeColors.background)
                                .disabled(isRefreshing)
                                .accessibilityIdentifier("hype-card-refresh-retry")
                            }
                            .padding(18)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
                            .supporterSurfaceShadow()
                            .accessibilityIdentifier("native-hype-card-refresh-error")
                        }

                        if !isPublicRecipient, identityMismatch {
                            identityMismatchRecovery
                        }
                        if !isPublicRecipient, let identityCorrectionMessage {
                            Text(identityCorrectionMessage)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(identityCorrectionMessage.lowercased().contains("couldn’t")
                                                 || identityCorrectionMessage.lowercased().contains("unable")
                                                 ? .red : SupporterHomeColors.accentText)
                                .accessibilityIdentifier("native-hype-card-identity-message")
                        }

                        content
                        if settingsStatusUnknown && settings == nil {
                            settingsStatusRecoveryNotice
                        }
                    }
                    .frame(maxWidth: 520, alignment: .leading)
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .top)
                }
                .scrollIndicators(.hidden)
                .task(id: "\(settings?.revision ?? "")|\(identityMismatch)") {
                    guard focusPauseSettingOnOpen, settings?.revision != nil, !identityMismatch else { return }
                    await Task.yield()
                    guard !Task.isCancelled, focusPauseSettingOnOpen else { return }
                    withAnimation(.easeInOut(duration: 0.25)) {
                        scrollProxy.scrollTo("native-hype-card-toggle-public", anchor: .center)
                    }
                    focusPauseSettingOnOpen = false
                }
            }
        }
        .navigationTitle("HYPE Card")
        .tint(NativeMenuAppearance.actionTint)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await loadCard(refresh: true) }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .nativeToolbarLabel(iconOnly: true)
                }
                .disabled(loading || isRefreshing || isSaving || isCheckingSettings || hasUnsavedSettings)
                .accessibilityLabel("Refresh HYPE Card")
                .accessibilityHint(
                    isPublicRecipient
                        ? "Check for the latest shared HYPE Card."
                        : "Reload the preview from your linked PIXL account."
                )
                .accessibilityIdentifier("native-hype-card-refresh")
            }
        }
        .confirmationDialog(
            "Make this HYPE Card public?",
            isPresented: $showPublishConfirmation,
            titleVisibility: .visible
        ) {
            Button {
                Task { await saveSettings(confirmPublish: true) }
            } label: {
                Label("Publish HYPE Card", systemImage: "globe")
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Anyone with the HYPE Card link will be able to view the sections you have enabled.")
        }
        .confirmationDialog(
            "Correct this HYPE Card identity?",
            isPresented: $showIdentityCorrectionConfirmation,
            titleVisibility: .visible
        ) {
            Button {
                Task { await correctHypeCardIdentity() }
            } label: {
                Label("Update HYPE Card identity", systemImage: "person.crop.rectangle")
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This updates only the saved card’s athlete and team name to match your linked profile. Privacy, photo, media, saved artwork, and published snapshots stay unchanged.")
        }
        .task { await loadCard() }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(5)) } catch { return }
                guard !Task.isCancelled, scenePhase == .active else { return }
                // Refresh aggregates without replacing the card or editing drafts.
                guard let token = card?.inviteToken ?? publicInviteToken,
                      !loading, !isSaving, !isCheckingSettings else { continue }
                if let result = try? await SupporterHomeAPI.fetchLiveTapSummary(inviteToken: token) {
                    guard !Task.isCancelled, token == (card?.inviteToken ?? publicInviteToken) else { continue }
                    card?.liveTaps = result.summary
                }
            }
        }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, !loading, !isRefreshing, !isSaving,
                  !isCheckingSettings else { return }
            Task { await loadCard() }
        }
        .onChange(of: clerk?.user?.id) { _, _ in
            athleteProfile = nil
            card = nil
            privateCard = nil
            privatePhoto = nil
            settings = nil
            settingsAccountSubject = nil
            loading = true
            Task { await loadCard() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeOfflineConnectionChanged)) { _ in
            guard !isPublicRecipient, offlineRuntime.online, !loading, !isRefreshing,
                  !isSaving, !isCheckingSettings else { return }
            Task { await loadCard(refresh: true) }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeHypeCardSettingsQueueSynced)) { _ in
            guard !isPublicRecipient, offlineRuntime.online else { return }
            Task { @MainActor in
                for _ in 0..<20 {
                    guard !Task.isCancelled else { return }
                    if !loading, !isRefreshing, !isSaving, !isCheckingSettings {
                        await loadCard(refresh: true, syncQueued: false)
                        return
                    }
                    try? await Task.sleep(for: .milliseconds(250))
                }
            }
        }
        .onDisappear {
            flipTask?.cancel()
            flipTask = nil
            isFlipping = false
            backSideTransition = nil
            selectedSide = .front
            cardRotation = 0
            videoPlayer?.pause()
            videoPlayer = nil
        }
    }

    @ViewBuilder
    private var content: some View {
        if loading {
            ProgressView("Loading the HYPE Card…")
                .tint(SupporterHomeColors.accent)
                .foregroundStyle(SupporterHomeColors.muted)
                .frame(maxWidth: .infinity, minHeight: 240)
        } else if let card {
            publicCardContent(card)
            editAthleteDetailsButton
            if let cheers = card.liveTaps {
                NativeFanCheersView(summary: cheers)
            }
            if let shareURL = card.shareURL,
               (isPublicRecipient || (settings?.showHypeCard == true && settings?.paused == false)) {
                ShareLink(item: shareURL) {
                    Label("Share HYPE Card", systemImage: "square.and.arrow.up")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.borderedProminent)
                .tint(SupporterHomeColors.accent)
                .foregroundStyle(SupporterHomeColors.background)
                .accessibilityIdentifier("native-hype-card-share")
                Button {
                    showShareQR.toggle()
                } label: {
                    Label(showShareQR ? "Hide QR code" : "Show QR code", systemImage: "qrcode")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.bordered)
                .tint(SupporterHomeColors.accentText)
                .accessibilityValue(showShareQR ? "Expanded" : "Collapsed")
                .accessibilityIdentifier("native-hype-card-show-qr")
                if showShareQR {
                    NativeHypeCardShareQR(url: shareURL, athleteName: card.athleteName)
                }
            }
        } else if !isPublicRecipient, let privateCard {
            Text("Private preview · only visible to your linked account")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(SupporterHomeColors.accentText)
                .accessibilityIdentifier("native-hype-card-private-preview")
            hypeCard(
                athleteName: privateCard.athleteName,
                teamName: privateCard.teamName,
                seasonName: privateCard.seasonName,
                photoURL: nil,
                privatePhoto: privatePhoto
            )
            editAthleteDetailsButton
            if let cheers = privateCard.liveTaps {
                NativeFanCheersView(summary: cheers)
            }
        } else if let errorMessage {
            VStack(alignment: .leading, spacing: 12) {
                Label(
                    isPublicRecipient ? "This HYPE Card couldn’t load" : "The HYPE Card couldn’t load",
                    systemImage: "exclamationmark.triangle.fill"
                )
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                Text(isPublicRecipient
                     ? "Please check your connection and try again."
                     : errorMessage)
                    .font(.body)
                    .foregroundStyle(SupporterHomeColors.muted)
                Button("Try again") {
                    Task { await loadCard() }
                }
                .buttonStyle(.borderedProminent)
                .tint(SupporterHomeColors.accent)
                .foregroundStyle(SupporterHomeColors.background)
                .accessibilityIdentifier("hype-card-retry")
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
            .supporterSurfaceShadow()
        } else if unavailable {
            ContentUnavailableView(
                isPublicRecipient ? "This HYPE Card isn’t available" : "No HYPE Card is available",
                systemImage: "sportscourt",
                description: Text(
                    isPublicRecipient
                        ? "The card may be Private or this link may no longer be active."
                        : "The linked PIXL account doesn’t have a HYPE Card for its selected athlete yet."
                )
            )
            .foregroundStyle(SupporterHomeColors.muted)
            .padding(.vertical, 36)
        }

        if !isPublicRecipient, settings != nil {
            if let athleteProfile {
                athleteProfileSummary(athleteProfile)
            }
            if !identityMismatch {
                settingsEditor
            }
        }
    }

    private var identityMismatchRecovery: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Saved HYPE Card doesn’t match", systemImage: "exclamationmark.triangle.fill")
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
            if let privateCard, let athleteProfile {
                Text("This saved card is for \(privateCard.athleteName)\(privateCard.teamName.isEmpty ? "" : " · \(privateCard.teamName)"), but your linked profile is \(athleteProfile.athleteName)\(athleteProfile.teamName.isEmpty ? "" : " · \(athleteProfile.teamName)"). It wasn’t changed automatically.")
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
            } else {
                Text("This saved card doesn’t match your linked athlete profile. It wasn’t changed automatically.")
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            Text("If this saved card is for the selected athlete, confirm to update its identity. The card’s other settings and saved work will stay unchanged.")
                .font(.caption)
                .foregroundStyle(SupporterHomeColors.muted)
            Button {
                showIdentityCorrectionConfirmation = true
            } label: {
                HStack {
                    if isCorrectingIdentity { ProgressView().tint(SupporterHomeColors.background) }
                    Text(isCorrectingIdentity ? "Updating…" : "Confirm identity update")
                    Spacer()
                    Image(systemName: "person.crop.circle.badge.checkmark")
                }
                .font(.headline.weight(.bold))
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(SupporterHomeColors.accent)
            .foregroundStyle(SupporterHomeColors.background)
            .disabled(isCorrectingIdentity || athleteProfile == nil)
            .accessibilityIdentifier("native-hype-card-correct-identity")
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(SupporterHomeColors.accent.opacity(0.6), lineWidth: 1)
        }
        .supporterSurfaceShadow()
        .accessibilityIdentifier("native-hype-card-identity-mismatch")
    }

    private func correctHypeCardIdentity() async {
        guard let clerk, let identityCorrectionId, !isCorrectingIdentity else { return }
        isCorrectingIdentity = true
        identityCorrectionMessage = nil
        defer { isCorrectingIdentity = false }
        do {
            let corrected = try await SupporterHomeAPI.correctNativeHypeCardIdentity(
                correctionId: identityCorrectionId,
                clerk: clerk
            )
            await loadCard(refresh: true)
            identityCorrectionMessage = "HYPE Card identity updated to \(corrected.athleteName)\(corrected.teamName.isEmpty ? "" : " · \(corrected.teamName)")."
        } catch {
            identityCorrectionMessage = "We couldn’t update the HYPE Card details. Please try again."
        }
    }

    private func athleteProfileSummary(_ profile: NativeSupporterProfile) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SupporterEyebrow(text: "Linked athlete profile", color: SupporterHomeColors.accent)
            Text(profile.athleteName)
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
            let details = [profile.teamName, profile.displayDetails]
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            if !details.isEmpty {
                Text(details.joined(separator: " · "))
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            Text("Edit these details here or in Settings. HYPE Card privacy stays unchanged.")
                .font(.caption)
                .foregroundStyle(SupporterHomeColors.muted)
            if let pending = pendingAthleteProfileChange {
                Label(
                    pending.isConflicted
                        ? "Profile edits need review before they can sync."
                        : "Profile edits are saved on this iPhone and waiting to sync.",
                    systemImage: pending.isConflicted ? "exclamationmark.triangle.fill" : "arrow.triangle.2.circlepath"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(pending.isConflicted ? .orange : SupporterHomeColors.accent)
                .accessibilityIdentifier("native-hype-card-athlete-profile-pending")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(.white.opacity(0.14), lineWidth: 1)
        }
        .supporterSurfaceShadow()
        .accessibilityIdentifier("native-hype-card-athlete-profile")
    }

    private var pendingAthleteProfileChange: NativePendingAthleteProfileChange? {
        guard let subject = clerk?.user?.id,
              offlineRuntime.vault.canContinue(subject: subject) else { return nil }
        return try? NativeAccountLinkClient().pendingAthleteProfileChange(subject: subject)
    }

    @ViewBuilder
    private var editAthleteDetailsButton: some View {
        if showsAthleteDetailsShortcut, !isPublicRecipient, let clerk, settings != nil {
            NavigationLink {
                NativeAthleteProfileView(clerk: clerk, onSaved: { savedProfile in
                    athleteProfile = savedProfile
                    Task { await loadCard(refresh: true) }
                })
            } label: {
                Label("Edit Athlete Details", systemImage: "person.text.rectangle")
                    .frame(maxWidth: .infinity, minHeight: 46)
            }
            .buttonStyle(.bordered)
            .accessibilityIdentifier("native-hype-card-edit-athlete-details")
        }
    }

    private var availableSides: [NativeHypeCardSide] {
        if isPublicRecipient {
            guard let card else { return [.front] }
            var sides: [NativeHypeCardSide] = [.front, .videos]
            if card.stats != nil {
                sides.append(.stats)
            }
            if card.showEvents {
                sides.append(.events)
            }
            return sides
        }
        guard let card, settings?.showHypeCard == true, settings?.paused == false else {
            return [.front]
        }
        var sides: [NativeHypeCardSide] = [.front, .videos]
        if settings?.showStats == true, card.stats != nil {
            sides.append(.stats)
        }
        if settings?.showEvents == true, card.showEvents {
            sides.append(.events)
        }
        return sides
    }

    @ViewBuilder
    private func publicCardContent(_ card: NativePublicHypeCard) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(spacing: 0) {
                ZStack {
                    flipFrontContent(card)
                        .rotation3DEffect(
                            .degrees(cardRotation),
                            axis: (x: 0, y: 1, z: 0),
                            perspective: 0.65
                        )
                        .opacity(cardRotation < 90 ? 1 : 0)
                        .accessibilityHidden(cardRotation >= 90)
                        .allowsHitTesting(cardRotation < 90)

                    sectionFace(backSideTransition?.to ?? selectedSide, card: card)
                        .rotation3DEffect(
                            .degrees(cardRotation - 180),
                            axis: (x: 0, y: 1, z: 0),
                            perspective: 0.65
                        )
                        .opacity(cardRotation >= 90 ? 1 : 0)
                        .accessibilityHidden(cardRotation < 90)
                        .allowsHitTesting(cardRotation >= 90)
                }
                .aspectRatio(2.0 / 3.0, contentMode: .fit)
                .accessibilityIdentifier("native-hype-card-flip-face")

                Rectangle()
                    .fill(.white.opacity(0.12))
                    .frame(height: 1)
                cardSectionTabs
            }
            .background(SupporterHomeColors.panel)
            .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder(SupporterHomeColors.blue.opacity(0.85), lineWidth: 1.5)
            }
            .supporterSurfaceShadow()
            .accessibilityElement(children: .contain)
            .accessibilityValue(selectedSide.rawValue)
            .accessibilityIdentifier("native-hype-card-flip-container")

        }
        .onChange(of: availableSides) { _, sides in
            let transitionTargetUnavailable = backSideTransition.map { !sides.contains($0.to) } ?? false
            guard transitionTargetUnavailable || !sides.contains(selectedSide) else { return }
            flipTask?.cancel()
            flipTask = nil
            isFlipping = false
            backSideTransition = nil
            selectedSide = .front
            cardRotation = 0
        }
    }

    private var cardSectionTabs: some View {
        HStack(spacing: 4) {
            ForEach(availableSides) { side in
                Button {
                    selectCardSide(side)
                } label: {
                    Label(side.rawValue, systemImage: side.symbol)
                        .font(.caption.weight(.bold))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .foregroundStyle(
                            selectedSide == side ? .white : SupporterHomeColors.muted
                        )
                        .background {
                            if selectedSide == side {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(SupporterHomeColors.blue)
                            }
                        }
                }
                .buttonStyle(.plain)
                .disabled(isFlipping)
                .accessibilityAddTraits(selectedSide == side ? .isSelected : [])
                .accessibilityHint("Flip the HYPE Card to show this section.")
                .accessibilityIdentifier("native-hype-card-side-\(side.rawValue.lowercased())")
            }
        }
        .padding(8)
        .background(SupporterHomeColors.panel)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("HYPE Card sections")
    }

    private func frontCardFace(_ card: NativePublicHypeCard) -> some View {
        NativeHypeCardFront(
            athleteName: card.athleteName,
            teamName: card.teamName,
            seasonName: card.seasonName,
            photoURL: photoURL,
            privatePhoto: isPublicRecipient ? nil : privatePhoto,
            identityDetails: athleteProfile?.displayDetails ?? ""
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(card.athleteName), \(card.teamName), \(card.seasonName), HYPE Card")
        .accessibilityIdentifier("native-hype-card")
        .accessibilityValue(
            isPublicRecipient ? "Photo loads from PIXL"
                : privatePhoto != nil ? "Photo saved on this iPhone"
                    : photoURL != nil ? "Photo loads from PIXL"
                        : "No photo is saved"
        )
    }

    @ViewBuilder
    private func flipFrontContent(_ card: NativePublicHypeCard) -> some View {
        if let backSideTransition {
            sectionFace(backSideTransition.from, card: card)
        } else {
            frontCardFace(card)
        }
    }

    private func sectionFace(_ side: NativeHypeCardSide, card: NativePublicHypeCard) -> some View {
        ScrollView {
            cardSideContent(side, card: card)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .scrollIndicators(.hidden)
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SupporterHomeColors.background)
    }

    @ViewBuilder
    private func cardSideContent(_ side: NativeHypeCardSide, card: NativePublicHypeCard) -> some View {
        switch side {
        case .front:
            emptySide(title: "HYPE Card", detail: "Choose Front to return to the athlete’s card.")
        case .stats:
            if (isPublicRecipient || settings?.showStats == true), let stats = card.stats {
                statsSide(stats)
            } else {
                emptySide(title: "Stats are unavailable", detail: "The card owner has not enabled finalized stats.")
            }
        case .videos:
            videosSide(card)
        case .events:
            if (isPublicRecipient || settings?.showEvents == true), card.showEvents {
                eventsSide(card)
            } else {
                emptySide(title: "Events are private", detail: "The card owner has turned off Event Card sharing.")
            }
        }
    }

    private func selectCardSide(_ side: NativeHypeCardSide) {
        guard availableSides.contains(side), side != selectedSide, !isFlipping else { return }
        flipTask?.cancel()
        isFlipping = true
        let duration: Double = 0.44
        let delay: UInt64 = 440_000_000

        if side == .front {
            withAnimation(.easeInOut(duration: duration)) {
                cardRotation = 0
            }
            flipTask = Task { @MainActor in
                do {
                    try await Task.sleep(nanoseconds: delay)
                    selectedSide = .front
                    isFlipping = false
                    flipTask = nil
                } catch {
                    return
                }
            }
            return
        }

        if selectedSide == .front {
            selectedSide = side
            withAnimation(.easeInOut(duration: duration)) {
                cardRotation = 180
            }
            flipTask = Task { @MainActor in
                do {
                    try await Task.sleep(nanoseconds: delay)
                    isFlipping = false
                    flipTask = nil
                } catch {
                    return
                }
            }
            return
        }

        // Use the current reverse section as the outgoing face and the new
        // section as the incoming face, so the flip never passes through Front.
        let transition = NativeHypeCardSideTransition(from: selectedSide, to: side)
        var resetTransaction = Transaction()
        resetTransaction.disablesAnimations = true
        withTransaction(resetTransaction) {
            backSideTransition = transition
            selectedSide = side
            cardRotation = 0
        }
        flipTask = Task { @MainActor in
            do {
                await Task.yield()
                try Task.checkCancellation()
                withAnimation(.easeInOut(duration: duration)) {
                    cardRotation = 180
                }
                try await Task.sleep(nanoseconds: delay)
                backSideTransition = nil
                isFlipping = false
                flipTask = nil
            } catch {
                return
            }
        }
    }

    private var settingsEditor: some View {
        VStack(alignment: .leading, spacing: 14) {
            SupporterEyebrow(text: "Owner controls", color: SupporterHomeColors.accent)
            Text("HYPE Card settings")
                .font(.title3.weight(.black))
                .foregroundStyle(.white)
            Text(publicationDescription)
                .font(.subheadline)
                .foregroundStyle(SupporterHomeColors.muted)

            Toggle(isOn: publicVisibilityBinding) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Public / Private")
                    Text(draftShowHypeCard && !draftPaused ? "Public" : "Private")
                        .font(.subheadline)
                        .foregroundStyle(SupporterHomeColors.muted)
                }
            }
                .foregroundStyle(.white)
                .accessibilityIdentifier("native-hype-card-toggle-public")
                .accessibilityValue(draftShowHypeCard && !draftPaused ? "Public" : "Private")
                .accessibilityHint("On is Public. Off is Private. Tap Save to apply your choice.")
                .id("native-hype-card-toggle-public")
                .disabled(!canEditSettingsDraft)
            Toggle("Share finalized stats", isOn: showStatsBinding)
                .foregroundStyle(.white)
                .accessibilityIdentifier("native-hype-card-toggle-stats")
                .disabled(!canEditSettingsDraft)
            Toggle("Share Event Cards", isOn: showEventsBinding)
                .foregroundStyle(.white)
                .accessibilityIdentifier("native-hype-card-toggle-events")
                .disabled(!canEditSettingsDraft)

#if DEBUG
            if ProcessInfo.processInfo.arguments.contains("--ui-testing-hype-card-settings-conflict") {
                Button("Simulate other-device settings change", action: simulateOtherDeviceSettingsChange)
                    .accessibilityIdentifier("native-hype-card-simulate-remote-settings-change")
            }
#endif

            Button(action: requestSettingsSave) {
                HStack {
                    if isSaving { ProgressView().tint(SupporterHomeColors.background) }
                    Text(isSaving ? "Saving…" : "Save HYPE Card settings")
                    Spacer()
                    Image(systemName: "checkmark")
                }
                .font(.headline.weight(.bold))
                .frame(maxWidth: .infinity, minHeight: 48)
            }
            .buttonStyle(.borderedProminent)
            .tint(SupporterHomeColors.accent)
            .foregroundStyle(SupporterHomeColors.background)
            .disabled(isSaving || isCheckingSettings || settingsStatusUnknown
                      || !canEditSettingsDraft || !hasUnsavedSettings)
            .accessibilityIdentifier("native-hype-card-save-settings")

            if settingsStatusUnknown {
                settingsStatusCheckButton
            }

            if let settingsMessage {
                Text(settingsMessage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(settingsMessage.lowercased().contains("couldn’t")
                                     || settingsMessage.lowercased().contains("unable")
                                     ? .red : SupporterHomeColors.muted)
                    .accessibilityIdentifier("native-hype-card-settings-message")
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .toggleStyle(SwitchToggleStyle(tint: SupporterHomeColors.accent))
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
        .supporterSurfaceShadow()
        .accessibilityIdentifier("native-hype-card-owner-settings")
    }

    private var settingsStatusCheckButton: some View {
        Button {
            Task { await checkSavedSettingsStatus() }
        } label: {
            HStack(spacing: 8) {
                if isCheckingSettings { ProgressView().controlSize(.small) }
                Text(isCheckingSettings ? "Checking saved status…" : "Check saved status")
            }
        }
        .font(.subheadline.weight(.bold))
        .foregroundStyle(SupporterHomeColors.accent)
        .disabled(isSaving || isCheckingSettings)
        .accessibilityIdentifier("native-hype-card-check-saved-status")
    }

    private var settingsStatusRecoveryNotice: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("HYPE Card save status needs checking", systemImage: "exclamationmark.triangle.fill")
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
            if let settingsMessage {
                Text(settingsMessage)
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            settingsStatusCheckButton
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
        .supporterSurfaceShadow()
        .accessibilityIdentifier("native-hype-card-settings-status-recovery")
    }

    private var publicationDescription: String {
        if draftShowHypeCard && !draftPaused {
            "Public lets anyone with the link view your shared sections. Tap Save to apply changes."
        } else {
            "Private keeps the card visible only to your linked account. Tap Save to apply changes."
        }
    }

    private var hasUnsavedSettings: Bool {
        guard let settings else { return false }
        return settings.showHypeCard != draftShowHypeCard
            || settings.showStats != draftShowStats
            || settings.showEvents != draftShowEvents
            || settings.paused != draftPaused
            || settings.favoriteMoment != (draftFavoriteMoment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                           ? nil
                                           : draftFavoriteMoment.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private var currentSettingsDraft: NativeHypeCardSettings {
        let favorite = draftFavoriteMoment.trimmingCharacters(in: .whitespacesAndNewlines)
        return NativeHypeCardSettings(
            revision: settingsDraftRevision,
            showHypeCard: draftShowHypeCard,
            showStats: draftShowStats,
            showEvents: draftShowEvents,
            paused: draftPaused,
            favoriteMoment: favorite.isEmpty ? nil : favorite
        )
    }

    private var canEditSettingsDraft: Bool {
        !settingsDraftRecoveryBlocked
            && settingsDraftRevision != nil && settingsAccountSubject != nil
            && settingsAccountSubject == ownerSubject
            && offlineRuntime.vault.canContinue(subject: settingsAccountSubject)
            && settings?.revision?.isEmpty == false
            && !isSaving && !isCheckingSettings
    }

    private var publicVisibilityBinding: Binding<Bool> {
        Binding(get: { draftShowHypeCard && !draftPaused }, set: {
            // Only an explicit visibility choice normalizes legacy raw flags.
            draftShowHypeCard = $0
            draftPaused = !$0
            persistSettingsDraft()
        })
    }

    private var showStatsBinding: Binding<Bool> {
        Binding(get: { draftShowStats }, set: { draftShowStats = $0; persistSettingsDraft() })
    }

    private var showEventsBinding: Binding<Bool> {
        Binding(get: { draftShowEvents }, set: { draftShowEvents = $0; persistSettingsDraft() })
    }


#if DEBUG
    private func simulateOtherDeviceSettingsChange() {
        guard let clerk else {
            settingsMessage = "The other-device test change couldn’t be applied."
            return
        }
        Task {
            do {
                _ = try await SupporterHomeAPI.applyNativeHypeCardConflictEditForUITest(
                    clerk: clerk
                )
                settingsMessage = "Other-device settings change applied on PIXL."
            } catch {
                settingsMessage = "The other-device test change couldn’t be applied."
            }
        }
    }
#endif

    private func persistSettingsDraft() {
        guard canEditSettingsDraft, let subject = settingsAccountSubject else {
            settingsMessage = "Sign in to the same iPhone account to save these HYPE Card changes."
            return
        }
        do {
            try NativeAccountLinkClient().saveHypeCardSettingsDraft(currentSettingsDraft, subject: subject)
            settingsMessage = "Your changes are saved on this iPhone. Save them to PIXL when you’re ready."
        } catch {
            settingsMessage = "These HYPE Card changes couldn’t be saved on this iPhone. Reconnect and try again."
        }
    }

    private func requestSettingsSave() {
        guard !settingsStatusUnknown else {
            settingsMessage = "Check your saved HYPE Card changes before saving another update."
            return
        }
        guard let settings, canEditSettingsDraft else {
            settingsMessage = "Sign in to the same iPhone account before saving these HYPE Card changes."
            return
        }
        let becomesPublic = draftShowHypeCard && !draftPaused
            && (!settings.showHypeCard || settings.paused)
        if becomesPublic {
            showPublishConfirmation = true
        } else {
            Task { await saveSettings(confirmPublish: false) }
        }
    }

    private func saveSettings(confirmPublish: Bool) async {
        guard let clerk, let subject = settingsAccountSubject,
              subject == ownerSubject, !isSaving, !isCheckingSettings, !settingsStatusUnknown,
              let base = settings else {
            settingsMessage = "Sign in to the same iPhone account before saving these HYPE Card changes."
            return
        }
        guard settingsDraftRevision != nil else {
            settingsMessage = "Refresh the HYPE Card before saving these changes."
            return
        }
        let submittedDraft = currentSettingsDraft
        do {
            let client = NativeAccountLinkClient()
            let previousIntent = try client.loadHypeCardSettingsSaveIntent(subject: subject)
            let confirmedPublish = submittedDraft.showHypeCard && !submittedDraft.paused
                && (confirmPublish || previousIntent?.confirmPublish == true)
            let intent = NativeHypeCardSettingsSaveIntent(
                base: base,
                desired: submittedDraft,
                confirmPublish: confirmedPublish
            )
            try client.queueHypeCardSettingsSave(intent, draft: submittedDraft, subject: subject)
        } catch {
            settingsMessage = "These choices couldn’t be saved on this iPhone. Keep this screen open and try again."
            return
        }
        settingsMessage = "Saved on this iPhone. It will sync automatically when PIXL is reachable."
        guard offlineRuntime.online, clerk.isLoaded, !settingsStatusUnknown else { return }
        await syncQueuedSettings(subject: subject)
    }

    private func syncQueuedSettings(subject: String) async {
        guard let clerk, clerk.user?.id == subject, settingsAccountSubject == subject,
              offlineRuntime.online, clerk.isLoaded, !isSaving, !settingsStatusUnknown else { return }
        let client = NativeAccountLinkClient()
        do {
            guard try client.loadHypeCardSettingsSaveIntent(subject: subject) != nil else { return }
        } catch {
            settingsDraftRecoveryBlocked = true
            settingsMessage = "Saved HYPE Card changes couldn’t be opened on this iPhone. They haven’t been deleted."
            return
        }

        isSaving = true
        defer { isSaving = false }
        let saved = await offlineRuntime.syncPendingHypeCardSettings(
            clerk: clerk,
            notifyWhenFinished: false
        )
        guard clerk.user?.id == subject else { return }
        do {
            let remainingIntent = try client.loadHypeCardSettingsSaveIntent(subject: subject)
            if let saved, remainingIntent == nil {
                settings = saved
                settingsStatusUnknown = false
                settingsRecoveryAfterRestart = false
                settingsRecoveryMarkerFound = false
                settingsRecoverySnapshot = nil
                if let draft = try client.loadHypeCardSettingsDraft(subject: subject),
                   !draft.hasSameSettings(as: saved) {
                    applySettingsDraft(draft)
                    settingsMessage = "Earlier changes synced. Your newer choices remain on this iPhone; tap Save to sync them."
                } else {
                    applySettings(saved)
                    settingsMessage = "HYPE Card changes synced to PIXL."
                }
            } else {
                settingsStatusUnknown = try client.hasPendingHypeCardSettingsConfirmation(subject: subject)
                settingsMessage = settingsStatusUnknown
                    ? "Your HYPE Card changes are safe on this iPhone. PIXL will confirm the sync when it is reachable."
                    : "Your HYPE Card changes are saved on this iPhone and will sync automatically."
            }
        } catch {
            settingsDraftRecoveryBlocked = true
            settingsMessage = "Saved HYPE Card changes couldn’t be opened on this iPhone. They haven’t been deleted."
        }
    }

    private func mergeSettings(
        base: NativeHypeCardSettings,
        local: NativeHypeCardSettings,
        latest: NativeHypeCardSettings
    ) -> NativeHypeCardSettings {
        let localHasKnownBase = base.revision != nil
            && local.revision != nil
            && local.revision == base.revision
        let visibilityEdited = !localHasKnownBase
            || local.showHypeCard != base.showHypeCard || local.paused != base.paused
        return NativeHypeCardSettings(
            revision: latest.revision,
            showHypeCard: visibilityEdited
                ? local.showHypeCard : latest.showHypeCard,
            showStats: !localHasKnownBase || local.showStats != base.showStats
                ? local.showStats : latest.showStats,
            showEvents: !localHasKnownBase || local.showEvents != base.showEvents
                ? local.showEvents : latest.showEvents,
            paused: visibilityEdited
                ? local.paused : latest.paused,
            favoriteMoment: !localHasKnownBase || local.favoriteMoment != base.favoriteMoment
                ? local.favoriteMoment : latest.favoriteMoment
        )
    }

    private func checkSavedSettingsStatus() async {
        guard clerk != nil, !isSaving, !isCheckingSettings else { return }
        isCheckingSettings = true
        defer { isCheckingSettings = false }
        if settingsRecoveryAfterRestart, let subject = settingsAccountSubject {
            await reconcileSettingsAfterRestart(subject: subject, pendingSnapshot: settingsRecoverySnapshot)
        } else {
            await reconcileSettingsAfterSaveFailure()
        }
    }

    private func reconcileSettingsAfterSaveFailure() async {
        guard let clerk, let subject = settingsAccountSubject, clerk.user?.id == subject else {
            settingsStatusUnknown = true
            settingsMessage = "Your HYPE Card changes are safe on this iPhone. Sign in again to finish syncing."
            return
        }
        do {
            let saved = try await SupporterHomeAPI.fetchAuthoritativeNativeHypeCardSettings(clerk: clerk)
            guard clerk.user?.id == subject else { return }
            let client = NativeAccountLinkClient()
            try client.clearHypeCardSettingsConfirmation(subject: subject)
            settings = saved
            settingsStatusUnknown = false
            settingsRecoveryAfterRestart = false
            settingsRecoveryMarkerFound = false
            settingsRecoverySnapshot = nil
            if try client.loadHypeCardSettingsSaveIntent(subject: subject) != nil {
                await syncQueuedSettings(subject: subject)
            } else if let draft = try client.loadHypeCardSettingsDraft(subject: subject),
                      !draft.hasSameSettings(as: saved) {
                let rebased = mergeSettings(base: settings ?? saved, local: draft, latest: saved)
                try client.saveHypeCardSettingsDraft(rebased, subject: subject)
                applySettingsDraft(rebased)
                settingsMessage = "Your HYPE Card changes are still on this iPhone. Tap Save to sync them."
            } else {
                try? client.clearHypeCardSettingsDraft(subject: subject)
                applySettings(saved)
                settingsMessage = "HYPE Card settings are synced."
            }
        } catch {
            settingsStatusUnknown = true
            settingsMessage = "Your HYPE Card changes are safe on this iPhone. PIXL will confirm the sync when it is reachable."
        }
    }

    private func reconcileSettingsAfterRestart(
        subject: String,
        pendingSnapshot: NativeHypeCardSettings?
    ) async {
        guard let clerk, clerk.user?.id == subject else {
            settingsStatusUnknown = true
            settingsMessage = "Sign in to the same iPhone account to check whether these HYPE Card settings were saved."
            return
        }
        do {
            let saved = try await SupporterHomeAPI.fetchAuthoritativeNativeHypeCardSettings(clerk: clerk)
            guard clerk.user?.id == subject else { return }
            let client = NativeAccountLinkClient()
            let confirmedSnapshot = pendingSnapshot
                ?? (try? client.loadPendingHypeCardSettingsConfirmation(subject: subject))
            let localDraft = try client.loadHypeCardSettingsDraft(subject: subject)
            let queuedIntent = try client.loadHypeCardSettingsSaveIntent(subject: subject)
            let oldSettings = settings ?? saved
            try client.clearHypeCardSettingsConfirmation(subject: subject)
            settings = saved
            settingsStatusUnknown = false
            settingsRecoveryAfterRestart = false
            settingsRecoveryMarkerFound = false
            settingsRecoverySnapshot = nil
            if let queuedIntent {
                if saved.hasSameSettings(as: queuedIntent.desired) {
                    try? client.clearHypeCardSettingsSaveIntent(subject: subject)
                    if let localDraft, !localDraft.hasSameSettings(as: queuedIntent.desired) {
                        let base = localDraft.revision == queuedIntent.base.revision
                            ? queuedIntent.base : saved
                        let rebased = mergeSettings(base: base, local: localDraft, latest: saved)
                        try client.saveHypeCardSettingsDraft(rebased, subject: subject)
                        applySettingsDraft(rebased)
                        settingsMessage = "Earlier changes synced. Your newer choices remain on this iPhone; tap Save to sync them."
                    } else {
                        try? client.clearHypeCardSettingsDraft(subject: subject)
                        applySettings(saved)
                        settingsMessage = "HYPE Card changes synced to PIXL."
                    }
                } else {
                    await syncQueuedSettings(subject: subject)
                }
            } else if let confirmedSnapshot, !confirmedSnapshot.hasSameSettings(as: saved) {
                let base = oldSettings.revision == confirmedSnapshot.revision ? oldSettings : saved
                let intent = NativeHypeCardSettingsSaveIntent(
                    base: base,
                    desired: confirmedSnapshot,
                    confirmPublish: confirmedSnapshot.showHypeCard && !confirmedSnapshot.paused
                        && (!saved.showHypeCard || saved.paused)
                )
                try client.saveHypeCardSettingsSaveIntent(intent, subject: subject)
                let draftToPreserve = localDraft ?? confirmedSnapshot
                try client.saveHypeCardSettingsDraft(draftToPreserve, subject: subject)
                applySettingsDraft(draftToPreserve)
                settingsMessage = "Your HYPE Card changes are saved on this iPhone and will sync automatically."
                await syncQueuedSettings(subject: subject)
            } else if let localDraft, !localDraft.hasSameSettings(as: saved) {
                let rebased = mergeSettings(base: oldSettings, local: localDraft, latest: saved)
                try client.saveHypeCardSettingsDraft(rebased, subject: subject)
                applySettingsDraft(rebased)
                settingsMessage = "Your HYPE Card changes are still on this iPhone. Tap Save to sync them."
            } else {
                try? client.clearHypeCardSettingsDraft(subject: subject)
                applySettings(saved)
                settingsMessage = "HYPE Card settings are synced."
            }
        } catch {
            settingsStatusUnknown = true
            settingsMessage = "Your HYPE Card changes are safe on this iPhone. PIXL will check the sync when it is reachable."
        }
    }

    private func applySettings(_ saved: NativeHypeCardSettings) {
        settings = saved
        settingsDraftRevision = saved.revision
        draftShowHypeCard = saved.showHypeCard
        draftShowStats = saved.showStats
        draftShowEvents = saved.showEvents
        draftPaused = saved.paused
        draftFavoriteMoment = saved.favoriteMoment ?? ""
    }

    private func applySettingsDraft(_ draft: NativeHypeCardSettings) {
        settingsDraftRevision = draft.revision
        draftShowHypeCard = draft.showHypeCard
        draftShowStats = draft.showStats
        draftShowEvents = draft.showEvents
        draftPaused = draft.paused
        draftFavoriteMoment = draft.favoriteMoment ?? ""
    }

    private func statsSide(_ stats: NativeHypeStats) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            SupporterEyebrow(text: "Finalized stats", color: SupporterHomeColors.accent)
            Text("Season record")
                .font(.title2.weight(.black))
                .foregroundStyle(.white)
            HStack(spacing: 8) {
                recordValue("Wins", stats.record.wins)
                recordValue("Losses", stats.record.losses)
                recordValue("Ties", stats.record.ties)
            }
            HStack {
                Label("\(stats.gamesPlayed) completed games", systemImage: "sportscourt")
                Spacer()
                Text("\(stats.score) points")
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(SupporterHomeColors.muted)

            if !stats.stats.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Season totals")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                    ForEach(stats.stats.keys.sorted(), id: \.self) { key in
                        HStack {
                            Text(key.replacingOccurrences(of: "_", with: " ").capitalized)
                            Spacer()
                            Text("\(stats.stats[key, default: 0])")
                                .fontWeight(.bold)
                        }
                        .foregroundStyle(SupporterHomeColors.muted)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(SupporterHomeColors.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 16))
            }

            if !stats.games.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Recent games")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                    ForEach(stats.games.prefix(5)) { game in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(game.opponent.isEmpty ? "Game" : "vs \(game.opponent)")
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(.white)
                                Text(formattedHypeDate(game.date))
                                    .font(.caption)
                                    .foregroundStyle(SupporterHomeColors.muted)
                            }
                            Spacer()
                            Text(game.scoreRecorded ? "\(game.score)–\(game.opponentScore)" : "Score not saved")
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(SupporterHomeColors.accent)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
        .supporterSurfaceShadow()
        .accessibilityIdentifier("native-hype-card-stats")
    }

    private func recordValue(_ title: String, _ value: Int) -> some View {
        VStack(spacing: 4) {
            Text("\(value)")
                .font(.title2.weight(.black))
                .foregroundStyle(SupporterHomeColors.accent)
            Text(title.uppercased())
                .font(.caption2.weight(.bold))
                .tracking(0.7)
                .foregroundStyle(SupporterHomeColors.muted)
        }
        .frame(maxWidth: .infinity, minHeight: 72)
        .background(SupporterHomeColors.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 16))
    }

    private func videosSide(_ card: NativePublicHypeCard) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SupporterEyebrow(text: "Shared moments", color: SupporterHomeColors.accent)
            Text("Videos")
                .font(.title2.weight(.black))
                .foregroundStyle(.white)

            if let videoPlayer {
                VideoPlayer(player: videoPlayer)
                    .frame(height: 240)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    .accessibilityIdentifier("native-hype-card-video-player")
            }
            if let mediaErrorMessage {
                Text(mediaErrorMessage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.red)
            }
            if card.videos.isEmpty {
                emptySide(title: "Videos will appear here", detail: "Shared athlete videos will be available on this side of the HYPE Card.")
            } else {
                ForEach(card.videos) { video in
                    Button {
                        play(video)
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: selectedVideoToken == video.id ? "pause.fill" : "play.fill")
                                .font(.headline)
                                .foregroundStyle(SupporterHomeColors.accent)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(video.title)
                                    .font(.subheadline.weight(.bold))
                                    .foregroundStyle(.white)
                                    .multilineTextAlignment(.leading)
                                Text(video.mediaName)
                                    .font(.caption)
                                    .foregroundStyle(SupporterHomeColors.muted)
                            }
                            Spacer()
                            Image(systemName: "arrow.up.right")
                                .foregroundStyle(SupporterHomeColors.muted)
                        }
                        .padding(14)
                        .background(SupporterHomeColors.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("native-hype-card-video-\(video.id)")
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
        .supporterSurfaceShadow()
        .accessibilityIdentifier("native-hype-card-videos")
    }

    private func play(_ video: NativeHypeVideo) {
        guard let url = publicMediaURL(video.videoUrl) else {
            mediaErrorMessage = "This video can’t be opened from the configured PIXL server."
            return
        }
        mediaErrorMessage = nil
        videoPlayer?.pause()
        selectedVideoToken = video.id
        videoPlayer = AVPlayer(url: url)
        videoPlayer?.play()
    }

    private func eventsSide(_ card: NativePublicHypeCard) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SupporterEyebrow(text: "Shared Event Cards", color: SupporterHomeColors.accent)
            Text("Events")
                .font(.title2.weight(.black))
                .foregroundStyle(.white)
            if card.events.isEmpty {
                emptySide(title: "Game days will land here", detail: "Eligible Event Cards will appear after the owner shares them.")
            } else {
                ForEach(card.events) { event in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(event.type.uppercased())
                            Spacer()
                            Text(event.status == "final" ? "COMPLETE" : event.status.uppercased())
                        }
                        .font(.caption2.weight(.bold))
                        .tracking(0.8)
                        .foregroundStyle(SupporterHomeColors.accent)
                        Text(event.opponent.isEmpty ? event.title : "vs \(event.opponent)")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(.white)
                        Text([formattedHypeDate(event.date), nativeEventTimeDisplay(event.time), event.location]
                            .filter { !$0.isEmpty }
                            .joined(separator: " · "))
                            .font(.subheadline)
                            .foregroundStyle(SupporterHomeColors.muted)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SupporterHomeColors.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 16))
                    .accessibilityIdentifier("native-hype-card-event-\(event.id)")
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
        .supporterSurfaceShadow()
        .accessibilityIdentifier("native-hype-card-events")
    }

    private func emptySide(title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(SupporterHomeColors.muted)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.background.opacity(0.55), in: RoundedRectangle(cornerRadius: 16))
    }

    private func formattedHypeDate(_ value: String) -> String {
        let input = DateFormatter()
        input.locale = Locale(identifier: "en_US_POSIX")
        input.dateFormat = "yyyy-MM-dd"
        guard let date = input.date(from: value) else { return value }
        let output = DateFormatter()
        output.locale = Locale.current
        output.dateFormat = "MMM d, yyyy"
        return output.string(from: date)
    }

    private func publicMediaURL(_ value: String) -> URL? {
        guard let origin = try? NativeAccountLinkClient.apiOrigin(),
              origin.scheme?.lowercased() == "https" else { return nil }
        if let url = URL(string: value), url.scheme != nil {
            return url.scheme?.lowercased() == "https" && url.host?.lowercased() == origin.host?.lowercased()
                ? url
                : nil
        }
        guard let url = URL(string: value, relativeTo: origin)?.absoluteURL,
              url.scheme?.lowercased() == "https",
              url.host?.lowercased() == origin.host?.lowercased() else { return nil }
        return url
    }

    private var photoURL: URL? {
        guard let photo = card?.photoUrl ?? card?.cutoutUrl else { return nil }
        return publicMediaURL(photo)
    }

    private func hypeCard(
        athleteName: String,
        teamName: String,
        seasonName: String,
        photoURL: URL?,
        privatePhoto: UIImage?
    ) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            NativeHypeCardFront(
                athleteName: athleteName, teamName: teamName, seasonName: seasonName,
                photoURL: photoURL, privatePhoto: privatePhoto,
                identityDetails: athleteProfile?.displayDetails ?? ""
            )
            .supporterSurfaceShadow()
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(athleteName), \(teamName), \(seasonName), HYPE Card")
            .accessibilityIdentifier("native-hype-card")
            .accessibilityValue(
                privatePhoto != nil ? "Photo saved on this iPhone"
                    : photoURL != nil ? "Photo loads from PIXL"
                        : "No photo is saved"
            )

        }
    }

    private var athleteSilhouette: some View {
        Image(systemName: "person.fill")
            .resizable()
            .scaledToFit()
            .foregroundStyle(.white.opacity(0.18))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(.horizontal, 34)
            .accessibilityHidden(true)
    }

    private func loadCard(refresh: Bool = false, syncQueued: Bool = true) async {
        if let publicInviteToken {
            await loadPublicCard(inviteToken: publicInviteToken, refresh: refresh)
            return
        }
        guard let clerk else {
            loading = false
            athleteProfile = nil
            settingsAccountSubject = nil
            card = nil
            privateCard = nil
            privatePhoto = nil
            settings = nil
            unavailable = true
            errorMessage = "Sign in to the iPhone app again."
            return
        }
        guard let requestSubject = Self.ownerSubject(clerk: clerk) else {
            loading = false
            athleteProfile = nil
            unavailable = true
            card = nil
            privateCard = nil
            privatePhoto = nil
            settings = nil
            settingsAccountSubject = nil
            return
        }
        let sameSettingsAccount = settingsAccountSubject == requestSubject
        if !sameSettingsAccount {
            athleteProfile = nil
            card = nil
            privateCard = nil
            privatePhoto = nil
            settings = nil
            unavailable = false
            errorMessage = nil
            refreshErrorMessage = nil
            loading = true
            isRefreshing = false
            settingsDraftRecoveryBlocked = false
            settingsDraftRevision = nil
            settingsStatusUnknown = false
            settingsRecoveryAfterRestart = false
            settingsRecoveryMarkerFound = false
            settingsRecoverySnapshot = nil
            settingsMessage = nil
        }
        if !refresh, sameSettingsAccount, isRefreshing { return }
        let hasCachedOwnerPreview = sameSettingsAccount && (card != nil || privateCard != nil)
        if refresh {
            guard !loading, !isRefreshing else { return }
            isRefreshing = true
            refreshErrorMessage = nil
        } else if hasCachedOwnerPreview {
            loading = false
            isRefreshing = true
            errorMessage = nil
            refreshErrorMessage = nil
        } else {
            guard !isRefreshing else { return }
            loading = true
            errorMessage = nil
            refreshErrorMessage = nil
            card = nil
            privateCard = nil
            privatePhoto = nil
            settings = nil
            unavailable = false
        }
        defer { isRefreshing = false }
        settingsAccountSubject = requestSubject
        var queuedSaveIntent: NativeHypeCardSettingsSaveIntent?
        do {
            let client = NativeAccountLinkClient()
            let markerFound = try client.hasPendingHypeCardSettingsConfirmation(subject: requestSubject)
            queuedSaveIntent = try client.loadHypeCardSettingsSaveIntent(subject: requestSubject)
            settingsRecoveryMarkerFound = markerFound
            settingsRecoveryAfterRestart = markerFound
            settingsStatusUnknown = markerFound
            if markerFound {
                settingsRecoverySnapshot = try? client.loadPendingHypeCardSettingsConfirmation(subject: requestSubject)
                settingsMessage = "Checking your saved HYPE Card changes with PIXL."
            } else if queuedSaveIntent != nil {
                settingsRecoverySnapshot = nil
                settingsMessage = "Your HYPE Card changes are saved on this iPhone and will sync automatically."
            } else {
                settingsRecoverySnapshot = nil
            }
        } catch {
            // A locked vault cannot tell us whether a prior request was in flight.
            // Preserve the local state and check PIXL before changing it.
            settingsRecoveryMarkerFound = false
            settingsRecoveryAfterRestart = true
            settingsRecoverySnapshot = nil
            settingsStatusUnknown = true
            settingsMessage = "Checking your saved HYPE Card changes with PIXL."
        }
        do {
            var result = try await SupporterHomeAPI.fetchOwnerHypeCardPreview(clerk: clerk)
            let profile = try? await SupporterHomeAPI.fetchAthleteProfile(clerk: clerk)
            guard !Task.isCancelled, Self.ownerSubject(clerk: clerk) == requestSubject else { return }
            athleteProfile = profile ?? athleteProfile
            if let athleteProfile { result = result.followingProfile(athleteProfile) }
            let normalize: (String) -> String = { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            let previewName = result.publicCard?.athleteName ?? result.privateCard?.athleteName
            let previewTeam = result.publicCard?.teamName ?? result.privateCard?.teamName ?? ""
            let matchesProfile = previewName.map { name in
                guard let profile = athleteProfile else { return true }
                let expectedTeam = normalize(profile.teamName)
                return !normalize(profile.athleteName).isEmpty
                    && normalize(name) == normalize(profile.athleteName)
                    && (expectedTeam.isEmpty || normalize(previewTeam) == expectedTeam)
            } ?? true
            identityMismatch = result.identityMismatch || !matchesProfile
            identityCorrectionId = result.correctionId
            let preserveUnsavedDraft = sameSettingsAccount && hasUnsavedSettings
            let previousSettings = settings
            let previousDraft = currentSettingsDraft
            card = result.publicCard
            privateCard = result.privateCard
            settings = result.settings
            if settingsRecoveryAfterRestart {
                if let queuedSaveIntent {
                    let client = NativeAccountLinkClient()
                    let recovered = try client.loadHypeCardSettingsDraft(subject: requestSubject)
                        ?? queuedSaveIntent.desired
                    try client.saveHypeCardSettingsDraft(recovered, subject: requestSubject)
                    applySettingsDraft(recovered)
                }
            } else if preserveUnsavedDraft, let saved = result.settings {
                if queuedSaveIntent == nil, previousDraft.hasSameSettings(as: saved) {
                    try? NativeAccountLinkClient().clearHypeCardSettingsDraft(subject: requestSubject)
                    applySettings(saved)
                    settingsMessage = "HYPE Card changes synced to PIXL."
                } else if queuedSaveIntent != nil {
                    settingsMessage = "Your HYPE Card changes are saved on this iPhone and will sync automatically."
                } else {
                    let rebased = mergeSettings(
                        base: previousSettings ?? saved,
                        local: previousDraft,
                        latest: saved
                    )
                    try NativeAccountLinkClient().saveHypeCardSettingsDraft(rebased, subject: requestSubject)
                    applySettingsDraft(rebased)
                    settingsMessage = "Your HYPE Card changes are saved on this iPhone. Tap Save to sync them."
                }
            } else {
                settingsDraftRecoveryBlocked = false
                if let saved = result.settings {
                    do {
                        let client = NativeAccountLinkClient()
                        if let queuedSaveIntent {
                            let recovered = try client.loadHypeCardSettingsDraft(subject: requestSubject)
                                ?? queuedSaveIntent.desired
                            try client.saveHypeCardSettingsDraft(recovered, subject: requestSubject)
                            applySettingsDraft(recovered)
                            settingsMessage = "Your HYPE Card changes are saved on this iPhone and will sync automatically."
                        } else if let recovered = try client.loadHypeCardSettingsDraft(subject: requestSubject) {
                            if recovered.hasSameSettings(as: saved) {
                                try client.clearHypeCardSettingsDraft(subject: requestSubject)
                                applySettings(saved)
                            } else {
                                let rebased = mergeSettings(base: saved, local: recovered, latest: saved)
                                try client.saveHypeCardSettingsDraft(rebased, subject: requestSubject)
                                applySettingsDraft(rebased)
                                settingsMessage = "Your HYPE Card changes are still on this iPhone. Tap Save to sync them."
                            }
                        } else {
                            applySettings(saved)
                            if settingsMessage?.contains("will sync automatically") == true {
                                settingsMessage = "HYPE Card changes synced to PIXL."
                            }
                        }
                    } catch NativeOfflineError.corrupt {
                        settingsDraftRecoveryBlocked = true
                        settingsMessage = "Saved HYPE Card choices couldn’t be opened on this iPhone. They haven’t been deleted."
                    } catch {
                        settingsDraftRecoveryBlocked = true
                        settingsMessage = "Saved HYPE Card choices couldn’t be opened on this iPhone. They haven’t been deleted."
                    }
                } else {
                    draftShowHypeCard = false
                    draftShowStats = false
                    draftShowEvents = false
                    draftPaused = false
                    draftFavoriteMoment = ""
                    settingsDraftRevision = nil
                }
            }
            privatePhoto = identityMismatch ? nil : result.privatePhoto.flatMap(UIImage.init(data:))
            // The owner screen must prepare its own complete offline copy,
            // even when it was opened before the dashboard finished loading.
            if !identityMismatch, let data = try? JSONEncoder().encode(result) {
                offlineRuntime.cache(data, key: "dashboard-preview")
            }
            unavailable = result.publicCard == nil && result.privateCard == nil
            loading = false
            errorMessage = nil
            refreshErrorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled, Self.ownerSubject(clerk: clerk) == requestSubject else { return }
            loading = false
            let status = (error as? NativeAccountLinkError)?.statusCode
            let accessWasRevoked = [401, 403, 404, 409, 410, 423].contains(status ?? 0)
                || (error as? NativeOfflineError) == .locked
            if accessWasRevoked {
                card = nil
                privateCard = nil
                privatePhoto = nil
                settings = nil
                unavailable = true
                errorMessage = status == 404 || status == 409
                    ? "This HYPE Card isn’t available right now. Refresh and try again."
                    : "Sign in again to view your HYPE Card."
                refreshErrorMessage = nil
            } else if card != nil || privateCard != nil {
                refreshErrorMessage = "Your saved HYPE Card is shown. It couldn’t be refreshed right now."
                errorMessage = nil
            } else if refresh {
                refreshErrorMessage = "Your HYPE Card preview couldn’t refresh right now. Please try again."
            } else {
                errorMessage = "PIXL couldn’t be reached, and this iPhone doesn’t have a saved HYPE Card yet. Load it once while PIXL is available to keep a copy for offline use."
            }
        }
        if syncQueued {
            if settingsRecoveryAfterRestart, settingsAccountSubject == requestSubject {
                await checkSavedSettingsStatus()
            } else {
                await syncQueuedSettings(subject: requestSubject)
            }
        }
    }

    private func loadPublicCard(inviteToken: String, refresh: Bool) async {
        if refresh {
            guard !loading, !isRefreshing else { return }
            isRefreshing = true
            refreshErrorMessage = nil
        } else {
            guard !isRefreshing else { return }
            loading = true
            errorMessage = nil
            refreshErrorMessage = nil
            card = nil
            unavailable = false
        }
        defer {
            if refresh { isRefreshing = false }
        }

        do {
#if DEBUG
            let result: NativePublicHypeCard
            if let fixturePublicCard {
                result = fixturePublicCard
            } else {
                result = try await SupporterHomeAPI.fetchPublicHypeCard(inviteToken: inviteToken)
            }
#else
            let result = try await SupporterHomeAPI.fetchPublicHypeCard(inviteToken: inviteToken)
#endif
            guard !Task.isCancelled else { return }
            card = result
            privateCard = nil
            privatePhoto = nil
            athleteProfile = nil
            settings = nil
            identityMismatch = false
            identityCorrectionId = nil
            unavailable = false
            loading = false
            errorMessage = nil
            refreshErrorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            loading = false
            if (error as? NativeAccountLinkError)?.statusCode == 404 {
                card = nil
                unavailable = true
                errorMessage = nil
                refreshErrorMessage = nil
            } else if refresh {
                refreshErrorMessage = "Please try again when your connection is available."
            } else {
                errorMessage = "We couldn’t load this HYPE Card right now."
            }
        }
    }
}

private struct NativeHypeCardShareQR: View {
    let url: URL
    let athleteName: String

    var body: some View {
        VStack(spacing: 12) {
            if let image = Self.qrImage(url) {
                Image(uiImage: image)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: 320)
                    .accessibilityLabel("QR code for \(athleteName)'s HYPE Card")
                    .accessibilityIdentifier("native-hype-card-share-qr")
                Text("Scan to open \(athleteName)’s HYPE Card.")
                    .font(.subheadline)
                    .foregroundStyle(Color.black)
                    .multilineTextAlignment(.center)
            } else {
                Text("The QR code couldn’t be created. You can still share the link.")
                    .foregroundStyle(Color.black)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity)
        .background(Color.white, in: RoundedRectangle(cornerRadius: 16))
    }

    private static func qrImage(_ url: URL) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(url.absoluteString.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let bitmap = CIContext().createCGImage(output, from: output.extent) else { return nil }
        let source = UIImage(cgImage: bitmap)
        // White quiet zone keeps the code scannable against either app theme.
        let size = CGSize(width: source.size.width + 64, height: source.size.height + 64)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).image { context in
            UIColor.white.setFill()
            context.cgContext.fill(CGRect(origin: .zero, size: size))
            context.cgContext.interpolationQuality = .none
            source.draw(at: CGPoint(x: 32, y: 32))
        }
    }
}
