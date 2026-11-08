import SwiftUI
import ClerkKit
import UIKit
import AVKit

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
    @State private var settingsRevisionConflict: NativeHypeCardSettings?
    @State private var settingsDraftRevision: String?
    @State private var settingsRecoveryAfterRestart = false
    @State private var settingsRecoveryMarkerFound = false
    @State private var settingsRecoverySnapshot: NativeHypeCardSettings?
    @State private var settingsMessage: String?
    @State private var mediaErrorMessage: String?
    @State private var showPublishConfirmation = false
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

    init(
        clerk: Clerk?,
        publicInviteToken: String? = nil,
        cachedOwnerPreview: NativeSupporterHypeCardPreview? = nil
    ) {
        self.clerk = clerk
        self.publicInviteToken = publicInviteToken
        let subject = clerk?.user?.id
        let offline = NativeOfflineRuntime.shared
        let canUseOwnerCache = publicInviteToken == nil
            && subject.map { offline.vault.canContinue(subject: $0) } == true
        var storedPreview = cachedOwnerPreview
        if storedPreview == nil, canUseOwnerCache, let subject,
           let data = try? offline.vault.read("dashboard-preview", subject: subject) {
            storedPreview = try? JSONDecoder().decode(NativeSupporterHypeCardPreview.self, from: data)
        }
        let preview = canUseOwnerCache ? storedPreview : nil
        var cachedProfile: NativeSupporterProfile?
        if canUseOwnerCache, let subject,
           let data = try? offline.vault.read("get/supporter/profile", subject: subject) {
            cachedProfile = try? JSONDecoder().decode(NativeSupporterProfile.self, from: data)
        }
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
        let savedDraft: NativeHypeCardSettings?
        if canUseOwnerCache, let subject {
            savedDraft = try? NativeAccountLinkClient().loadHypeCardSettingsDraft(subject: subject)
        } else {
            savedDraft = nil
        }
        let editorSettings = savedDraft ?? cachedSettings
        var cachedConflict: NativeHypeCardSettings?
        if let savedDraft, let cachedSettings, savedDraft.revision != cachedSettings.revision {
            cachedConflict = cachedSettings
        }
        _card = State(initialValue: preview?.publicCard)
        _privateCard = State(initialValue: preview?.privateCard)
        _privatePhoto = State(initialValue: preview?.privatePhoto.flatMap(UIImage.init(data:)))
        _athleteProfile = State(initialValue: cachedProfile)
        _settings = State(initialValue: preview?.settings)
        _settingsAccountSubject = State(initialValue: preview == nil ? nil : subject)
        _settingsDraftRevision = State(initialValue: editorSettings?.revision)
        _draftShowHypeCard = State(initialValue: editorSettings?.showHypeCard ?? false)
        _draftShowStats = State(initialValue: editorSettings?.showStats ?? false)
        _draftShowEvents = State(initialValue: editorSettings?.showEvents ?? false)
        _draftPaused = State(initialValue: editorSettings?.paused ?? false)
        _draftFavoriteMoment = State(initialValue: editorSettings?.favoriteMoment ?? "")
        _settingsRevisionConflict = State(initialValue: cachedConflict)
        _settingsMessage = State(initialValue: savedDraft == nil
            ? nil
            : "Your HYPE Card changes are saved on this iPhone. Review or sync them when PIXL is reachable.")
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
        self.fixturePublicCard = fixturePublicCard
    }
#endif

    private var isPublicRecipient: Bool { publicInviteToken != nil }

    var body: some View {
        ZStack {
            NativePageBackground()

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
        }
        .navigationTitle("HYPE Card")
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
            Button("Publish HYPE Card") {
                Task { await saveSettings(confirmPublish: true) }
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
            Button("Update HYPE Card identity") {
                Task { await correctHypeCardIdentity() }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This updates only the saved card’s athlete and team name to match your linked profile. Privacy, pause, photo, media, saved artwork, and published snapshots stay unchanged.")
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
                  !isCheckingSettings, !hasUnsavedSettings else { return }
            Task { await loadCard() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeOfflineConnectionChanged)) { _ in
            guard !isPublicRecipient, offlineRuntime.online, hasUnsavedSettings,
                  settingsMessage?.hasPrefix("Saved on this iPhone.") == true else { return }
            settingsMessage = "Connection restored. Tap Save HYPE Card settings to sync your saved choices."
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
                        ? "The owner may have paused sharing or this link may no longer be active."
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
            Text("Edit these details in Settings. They do not change HYPE Card privacy.")
                .font(.caption)
                .foregroundStyle(SupporterHomeColors.muted)
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
            privatePhoto: nil,
            identityDetails: athleteProfile?.displayDetails ?? ""
        )
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(card.athleteName), \(card.teamName), \(card.seasonName), HYPE Card")
        .accessibilityIdentifier("native-hype-card")
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

            Toggle("Show HYPE Card", isOn: showHypeCardBinding)
                .foregroundStyle(.white)
                .accessibilityIdentifier("native-hype-card-toggle-public")
                .disabled(!canEditSettingsDraft)
            Toggle("Share finalized stats", isOn: showStatsBinding)
                .foregroundStyle(.white)
                .accessibilityIdentifier("native-hype-card-toggle-stats")
                .disabled(!canEditSettingsDraft)
            Toggle("Share Event Cards", isOn: showEventsBinding)
                .foregroundStyle(.white)
                .accessibilityIdentifier("native-hype-card-toggle-events")
                .disabled(!canEditSettingsDraft)
            Toggle("Pause public page", isOn: pausedBinding)
                .foregroundStyle(.white)
                .accessibilityIdentifier("native-hype-card-toggle-paused")
                .disabled(!canEditSettingsDraft)

            if let settingsRevisionConflict {
                settingsConflictNotice(settingsRevisionConflict)
            }

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

    private func settingsConflictNotice(_ latest: NativeHypeCardSettings) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("PIXL has newer HYPE Card settings", systemImage: "arrow.triangle.2.circlepath")
                .font(.headline.weight(.bold))
                .foregroundStyle(.white)
            Text("Your iPhone choices are still saved here. Compare them with the current PIXL version before continuing.")
                .font(.subheadline)
                .foregroundStyle(SupporterHomeColors.muted)
            Text(settingsSummary(latest))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                keepSettingsDraft(using: latest)
            } label: {
                HStack {
                    Text("Keep my iPhone draft")
                    Spacer()
                }
                .frame(minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            .tint(SupporterHomeColors.accent)
            .foregroundStyle(SupporterHomeColors.background)
            .disabled(isSaving || isCheckingSettings || settingsStatusUnknown)
            .accessibilityIdentifier("native-hype-card-review-settings-draft")
            Button {
                Task { await usePIXLSettingsVersion() }
            } label: {
                HStack {
                    if isCheckingSettings { ProgressView().controlSize(.small) }
                    Text(isCheckingSettings ? "Loading PIXL version…" : "Use PIXL version")
                    Spacer()
                }
                .frame(minHeight: 44)
            }
            .buttonStyle(.bordered)
            .tint(SupporterHomeColors.accent)
            .disabled(isSaving || isCheckingSettings)
            .accessibilityIdentifier("native-hype-card-use-pixl-version")
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.background, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityIdentifier("native-hype-card-revision-conflict")
    }

    private func settingsSummary(_ value: NativeHypeCardSettings) -> String {
        let card = value.showHypeCard ? (value.paused ? "paused" : "on") : "off"
        let stats = value.showStats ? "shared" : "not shared"
        let events = value.showEvents ? "shared" : "not shared"
        return "PIXL version: Card \(card), stats \(stats), Event Cards \(events)."
    }

    private var publicationDescription: String {
        if draftPaused {
            "Paused. Public access is suspended until you resume the page."
        } else if draftShowHypeCard {
            "The HYPE Card can be shared while the public page is active."
        } else {
            "The public HYPE Card preview is off; the linked owner can still review it."
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
        !settingsDraftRecoveryBlocked && settingsRevisionConflict == nil
            && settingsDraftRevision != nil && settingsAccountSubject != nil
            && settingsAccountSubject == clerk?.user?.id
            && settings?.revision?.isEmpty == false
            && !isSaving && !isCheckingSettings && !settingsStatusUnknown
    }

    private var showHypeCardBinding: Binding<Bool> {
        Binding(get: { draftShowHypeCard }, set: { draftShowHypeCard = $0; persistSettingsDraft() })
    }

    private var showStatsBinding: Binding<Bool> {
        Binding(get: { draftShowStats }, set: { draftShowStats = $0; persistSettingsDraft() })
    }

    private var showEventsBinding: Binding<Bool> {
        Binding(get: { draftShowEvents }, set: { draftShowEvents = $0; persistSettingsDraft() })
    }

    private var pausedBinding: Binding<Bool> {
        Binding(get: { draftPaused }, set: { draftPaused = $0; persistSettingsDraft() })
    }

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
              subject == clerk.user?.id, !isSaving, !isCheckingSettings else {
            settingsMessage = "Sign in to the same iPhone account before saving these HYPE Card changes."
            return
        }
        guard let expectedRevision = settingsDraftRevision else {
            settingsStatusUnknown = true
            settingsMessage = "Refresh the HYPE Card before saving these changes."
            return
        }
        isSaving = true
        settingsMessage = nil
        settingsStatusUnknown = false
        settingsRevisionConflict = nil
        defer { isSaving = false }
        let favorite = draftFavoriteMoment.trimmingCharacters(in: .whitespacesAndNewlines)
        let submittedDraft = currentSettingsDraft
        let update = NativeHypeCardSettingsUpdate(
            showHypeCard: draftShowHypeCard,
            showStats: draftShowStats,
            showEvents: draftShowEvents,
            paused: draftPaused,
            favoriteMoment: favorite.isEmpty ? nil : favorite,
            expectedRevision: expectedRevision,
            confirmPublish: confirmPublish
        )
        do {
            let saved = try await SupporterHomeAPI.updateNativeHypeCard(settings: update, clerk: clerk)
            if saved.hasSameSettings(as: submittedDraft) {
                settings = saved
                if currentSettingsDraft.hasSameSettings(as: submittedDraft) {
                    do {
                        try NativeAccountLinkClient().clearHypeCardSettingsDraft(subject: subject)
                    } catch {
                        // PIXL has confirmed the save; a retained local copy will
                        // be reconciled against the authoritative settings on reopening.
                    }
                }
                await loadCard(refresh: true)
                settings = saved
                if currentSettingsDraft.hasSameSettings(as: submittedDraft) {
                    applySettings(saved)
                    settingsMessage = "HYPE Card settings saved in PIXL."
                } else {
                    settingsMessage = "PIXL saved these settings. Your newer choices remain on this iPhone; review them before saving again."
                }
            } else {
                settings = saved
                settingsStatusUnknown = false
                settingsRevisionConflict = saved
                settingsMessage = "PIXL saved different settings. Your choices are still saved on this iPhone; review them before saving again."
            }
        } catch let error as NativeAccountLinkError where error.statusCode == 409 {
            await reconcileSettingsRevisionConflict(subject: subject)
        } catch {
            await reconcileSettingsAfterSaveFailure()
        }
    }

    private func keepSettingsDraft(using latest: NativeHypeCardSettings) {
        guard let subject = settingsAccountSubject,
              subject == clerk?.user?.id,
              settings?.revision == latest.revision,
              settingsRevisionConflict?.revision == latest.revision else {
            settingsMessage = "Reload the current PIXL settings before reviewing this draft."
            return
        }
        let favorite = draftFavoriteMoment.trimmingCharacters(in: .whitespacesAndNewlines)
        let reviewedDraft = NativeHypeCardSettings(
            revision: latest.revision,
            showHypeCard: draftShowHypeCard,
            showStats: draftShowStats,
            showEvents: draftShowEvents,
            paused: draftPaused,
            favoriteMoment: favorite.isEmpty ? nil : favorite
        )
        do {
            try NativeAccountLinkClient().saveHypeCardSettingsDraft(reviewedDraft, subject: subject)
            settingsDraftRevision = latest.revision
            settingsRevisionConflict = nil
            settingsMessage = "Your iPhone draft is ready. Review the settings above before saving them to PIXL."
        } catch {
            settingsMessage = "Your draft couldn’t be updated on this iPhone. It hasn’t been deleted."
        }
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
        guard let clerk else {
            settingsStatusUnknown = true
            settingsMessage = "We couldn’t confirm that your HYPE Card settings were saved. Your choices are still here. Check saved status when you can."
            return
        }
        guard let subject = settingsAccountSubject, subject == clerk.user?.id else {
            settingsStatusUnknown = true
            settingsMessage = "Sign in to the same iPhone account to check whether these HYPE Card settings were saved."
            return
        }
        do {
            let saved = try await SupporterHomeAPI.fetchAuthoritativeNativeHypeCardSettings(clerk: clerk)
            guard clerk.user?.id == subject else { return }
            try NativeAccountLinkClient().clearHypeCardSettingsConfirmation(subject: subject)
            settings = saved
            settingsStatusUnknown = false
            if draftMatches(saved) {
                let confirmedDraft = currentSettingsDraft
                do {
                    try NativeAccountLinkClient().clearHypeCardSettingsDraft(subject: subject)
                } catch {
                    // Keep the view usable; the server-confirmed match allows
                    // the stale local copy to be cleared the next time it loads.
                }
                await loadCard(refresh: true)
                settings = saved
                if currentSettingsDraft.hasSameSettings(as: confirmedDraft) {
                    applySettings(saved)
                    settingsMessage = "HYPE Card settings saved in PIXL."
                } else {
                    settingsMessage = "PIXL saved these settings. Your newer choices remain on this iPhone; review them before saving again."
                }
            } else {
                if settingsDraftRevision != saved.revision {
                    settingsRevisionConflict = saved
                    settingsMessage = nil
                } else {
                    settingsRevisionConflict = nil
                    settingsMessage = "PIXL hasn’t saved these choices yet. Your iPhone choices are still here; try saving again."
                }
                await loadCard(refresh: true)
                settings = saved
            }
        } catch {
            settingsStatusUnknown = true
            settingsMessage = "We couldn’t confirm that your HYPE Card settings were saved. Your choices are still here. Check saved status before trying again."
        }
    }

    private func reconcileSettingsRevisionConflict(subject: String) async {
        guard let clerk, clerk.user?.id == subject else {
            settingsStatusUnknown = true
            settingsMessage = "Sign in to the same iPhone account to check these HYPE Card changes."
            return
        }
        do {
            let latest = try await SupporterHomeAPI.fetchAuthoritativeNativeHypeCardSettings(clerk: clerk)
            guard clerk.user?.id == subject else { return }
            try NativeAccountLinkClient().clearHypeCardSettingsConfirmation(subject: subject)
            settings = latest
            settingsStatusUnknown = false
            settingsRecoveryAfterRestart = false
            settingsRecoveryMarkerFound = false
            settingsRecoverySnapshot = nil
            if settingsDraftRevision != latest.revision {
                settingsRevisionConflict = latest
                settingsMessage = nil
            } else {
                settingsRevisionConflict = nil
                settingsMessage = "PIXL settings are current. Your iPhone choices are still here; review and save again."
            }
            await loadCard(refresh: true)
            settings = latest
        } catch {
            settingsStatusUnknown = true
            settingsMessage = "We couldn’t confirm the current PIXL version. Your iPhone choices are still here. Check saved status before trying again."
        }
    }

    private func usePIXLSettingsVersion() async {
        guard let clerk, let subject = settingsAccountSubject,
              clerk.user?.id == subject, !isSaving, !isCheckingSettings else {
            settingsMessage = "Sign in to the same iPhone account to load the PIXL version."
            return
        }
        isCheckingSettings = true
        defer { isCheckingSettings = false }
        do {
            let latest = try await SupporterHomeAPI.fetchAuthoritativeNativeHypeCardSettings(clerk: clerk)
            guard clerk.user?.id == subject else { return }
            let client = NativeAccountLinkClient()
            try client.clearHypeCardSettingsDraft(subject: subject)
            try client.clearHypeCardSettingsConfirmation(subject: subject)
            settingsStatusUnknown = false
            settingsRevisionConflict = nil
            settingsRecoveryAfterRestart = false
            settingsRecoveryMarkerFound = false
            settingsRecoverySnapshot = nil
            settingsDraftRecoveryBlocked = false
            applySettings(latest)
            settingsMessage = "The PIXL version is loaded. Review it before making another change."
            await loadCard(refresh: true)
            applySettings(latest)
        } catch {
            settingsStatusUnknown = true
            settingsMessage = "We couldn’t load the PIXL version. Your iPhone choices are still here."
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
            var markerFound = settingsRecoveryMarkerFound
            if !markerFound {
                markerFound = try client.hasPendingHypeCardSettingsConfirmation(subject: subject)
            }
            let confirmedSnapshot: NativeHypeCardSettings?
            if let pendingSnapshot {
                confirmedSnapshot = pendingSnapshot
            } else if markerFound {
                confirmedSnapshot = try? client.loadPendingHypeCardSettingsConfirmation(subject: subject)
            } else {
                confirmedSnapshot = nil
            }
            let localDraft = try client.loadHypeCardSettingsDraft(subject: subject)
            let preservedDraft = confirmedSnapshot ?? localDraft
            try client.clearHypeCardSettingsConfirmation(subject: subject)
            settings = saved
            applySettings(saved)
            settingsStatusUnknown = false
            settingsRecoveryAfterRestart = false
            settingsRecoveryMarkerFound = false
            settingsRecoverySnapshot = nil
            if let preservedDraft, preservedDraft != saved {
                try client.saveHypeCardSettingsDraft(preservedDraft, subject: subject)
                applySettingsDraft(preservedDraft)
                if preservedDraft.revision != saved.revision {
                    settingsRevisionConflict = saved
                    settingsMessage = nil
                } else {
                    settingsRevisionConflict = nil
                    settingsMessage = "PIXL didn’t save these choices. Your iPhone choices are still here; review and save again."
                }
            } else {
                try client.clearHypeCardSettingsDraft(subject: subject)
                applySettings(saved)
                settingsRevisionConflict = nil
                if let confirmedSnapshot, confirmedSnapshot == saved {
                    settingsMessage = "HYPE Card settings saved in PIXL."
                } else if confirmedSnapshot != nil {
                    settingsMessage = "PIXL settings are current. Review them before making another change."
                } else {
                    settingsMessage = "PIXL settings are current. Review them before making another change."
                }
            }
            await loadCard(refresh: true)
            settings = saved
        } catch {
            settingsStatusUnknown = true
            settingsMessage = "We couldn’t confirm that your HYPE Card settings were saved. Your choices are still here. Check saved status before trying again."
        }
    }

    private func applySettings(_ saved: NativeHypeCardSettings) {
        settings = saved
        settingsDraftRevision = saved.revision
        settingsRevisionConflict = nil
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

    private func draftMatches(_ saved: NativeHypeCardSettings) -> Bool {
        let favorite = draftFavoriteMoment.trimmingCharacters(in: .whitespacesAndNewlines)
        return saved.showHypeCard == draftShowHypeCard
            && saved.showStats == draftShowStats
            && saved.showEvents == draftShowEvents
            && saved.paused == draftPaused
            && saved.favoriteMoment == (favorite.isEmpty ? nil : favorite)
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
                            Text(event.status.uppercased())
                        }
                        .font(.caption2.weight(.bold))
                        .tracking(0.8)
                        .foregroundStyle(SupporterHomeColors.accent)
                        Text(event.opponent.isEmpty ? event.title : "vs \(event.opponent)")
                            .font(.headline.weight(.bold))
                            .foregroundStyle(.white)
                        Text([formattedHypeDate(event.date), event.time, event.location]
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

    private func loadCard(refresh: Bool = false) async {
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
        guard let requestSubject = clerk.user?.id else {
            loading = false
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
            settingsRevisionConflict = nil
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
        do {
            let client = NativeAccountLinkClient()
            let markerFound = try client.hasPendingHypeCardSettingsConfirmation(subject: requestSubject)
            settingsRecoveryMarkerFound = markerFound
            settingsRecoveryAfterRestart = markerFound
            settingsStatusUnknown = markerFound
            if markerFound {
                settingsRecoverySnapshot = try? client.loadPendingHypeCardSettingsConfirmation(subject: requestSubject)
                settingsMessage = "A previous HYPE Card save needs confirmation before you can save again."
            } else {
                settingsRecoverySnapshot = nil
            }
        } catch {
            // A locked vault cannot tell us whether a prior request was in flight.
            // Check PIXL before allowing another settings save.
            settingsRecoveryMarkerFound = false
            settingsRecoveryAfterRestart = true
            settingsRecoverySnapshot = nil
            settingsStatusUnknown = true
            settingsMessage = "A previous HYPE Card save needs confirmation before you can save again."
        }
        do {
            let result = try await SupporterHomeAPI.fetchOwnerHypeCardPreview(clerk: clerk)
            let profile = try? await SupporterHomeAPI.fetchAthleteProfile(clerk: clerk)
            guard !Task.isCancelled, clerk.user?.id == requestSubject else { return }
            athleteProfile = profile
            identityMismatch = result.identityMismatch
            identityCorrectionId = result.correctionId
            let preserveUnsavedDraft = sameSettingsAccount && hasUnsavedSettings
            card = result.publicCard
            privateCard = result.privateCard
            settings = result.settings
            if preserveUnsavedDraft, let saved = result.settings {
                if settingsDraftRevision != saved.revision {
                    settingsRevisionConflict = saved
                    settingsMessage = nil
                } else if settingsRevisionConflict != nil {
                    settingsRevisionConflict = nil
                    settingsMessage = "PIXL settings are current. Your iPhone choices are still here; review and save again."
                }
            }
            if settingsRecoveryAfterRestart {
                if let saved = result.settings {
                    applySettings(saved)
                }
            } else if !preserveUnsavedDraft {
                settingsDraftRecoveryBlocked = false
                if let saved = result.settings {
                    applySettings(saved)
                    do {
                        if let recovered = try NativeAccountLinkClient().loadHypeCardSettingsDraft(subject: requestSubject) {
                            if recovered.hasSameSettings(as: saved) {
                                try NativeAccountLinkClient().clearHypeCardSettingsDraft(subject: requestSubject)
                                settingsRevisionConflict = nil
                            } else {
                                applySettingsDraft(recovered)
                                if recovered.revision != saved.revision {
                                    settingsRevisionConflict = saved
                                    settingsMessage = nil
                                } else {
                                    settingsRevisionConflict = nil
                                    settingsMessage = "Your previous choices are saved on this iPhone. Review and save them to PIXL."
                                }
                            }
                        }
                    } catch NativeOfflineError.corrupt {
                        settingsDraftRecoveryBlocked = true
                        settingsMessage = "Saved HYPE Card choices couldn’t be opened on this iPhone. They haven’t been deleted."
                    } catch {
                        // The online settings remain available even when this
                        // device cannot currently access its offline vault.
                    }
                } else {
                    draftShowHypeCard = false
                    draftShowStats = false
                    draftShowEvents = false
                    draftPaused = false
                    draftFavoriteMoment = ""
                    settingsDraftRevision = nil
                    settingsRevisionConflict = nil
                }
            }
            privatePhoto = result.privatePhoto.flatMap(UIImage.init(data:))
            unavailable = result.publicCard == nil && result.privateCard == nil
            loading = false
            errorMessage = nil
            refreshErrorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
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
                errorMessage = "We couldn’t load your HYPE Card right now. Please try again."
            }
        }
        if settingsRecoveryAfterRestart, settingsAccountSubject == requestSubject {
            await checkSavedSettingsStatus()
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
