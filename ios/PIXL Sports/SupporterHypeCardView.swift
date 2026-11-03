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

@MainActor
struct SupporterHypeCardView: View {
    @Environment(\.scenePhase) private var scenePhase
    let clerk: Clerk?

    @State private var card: NativePublicHypeCard?
    @State private var privateCard: NativePrivateHypeCard?
    @State private var privatePhoto: UIImage?
    @State private var athleteProfile: NativeSupporterProfile?
    @State private var settings: NativeHypeCardSettings?
    @State private var draftShowHypeCard = false
    @State private var draftShowStats = false
    @State private var draftShowEvents = false
    @State private var draftPaused = false
    @State private var draftFavoriteMoment = ""
    @State private var selectedSide: NativeHypeCardSide = .front
    @State private var cardRotation = 0.0
    @State private var isFlipping = false
    @State private var flipTask: Task<Void, Never>?
    @State private var selectedVideoToken: String?
    @State private var videoPlayer: AVPlayer?
    @State private var isSaving = false
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

    var body: some View {
        ZStack {
            NativePageBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    SupporterEyebrow(text: "Player Showcase", color: SupporterHomeColors.accentText)
                    Text("HYPE Card")
                        .font(.largeTitle.weight(.black))
                        .fontDesign(.rounded)
                        .foregroundStyle(SupporterHomeColors.background)
                        .accessibilityAddTraits(.isHeader)

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
                            Label("The preview couldn’t refresh", systemImage: "exclamationmark.triangle.fill")
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

                    if identityMismatch {
                        identityMismatchRecovery
                    }
                    if let identityCorrectionMessage {
                        Text(identityCorrectionMessage)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(identityCorrectionMessage.lowercased().contains("couldn’t")
                                             || identityCorrectionMessage.lowercased().contains("unable")
                                             ? .red : SupporterHomeColors.accentText)
                            .accessibilityIdentifier("native-hype-card-identity-message")
                    }

                    content
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
                }
                .disabled(loading || isRefreshing || hasUnsavedSettings)
                .accessibilityLabel("Refresh HYPE Card")
                .accessibilityHint("Reload the preview from your linked PIXL account.")
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
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active, !loading, !isRefreshing, !hasUnsavedSettings else { return }
            Task { await loadCard() }
        }
        .onDisappear {
            flipTask?.cancel()
            flipTask = nil
            isFlipping = false
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
            if let shareURL = card.shareURL,
               settings?.showHypeCard == true,
               settings?.paused == false {
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
        } else if let privateCard {
            Text("Private preview · only visible to your linked account")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(SupporterHomeColors.accentText)
                .accessibilityIdentifier("native-hype-card-private-preview")
            hypeCard(
                athleteName: privateCard.athleteName,
                teamName: privateCard.teamName,
                seasonName: privateCard.seasonName,
                favoriteMoment: privateCard.favoriteMoment,
                photoURL: nil,
                privatePhoto: privatePhoto
            )
        } else if let errorMessage {
            VStack(alignment: .leading, spacing: 12) {
                Label("The HYPE Card couldn’t load", systemImage: "exclamationmark.triangle.fill")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(.white)
                Text(errorMessage)
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
                "No HYPE Card is available",
                systemImage: "sportscourt",
                description: Text("The linked PIXL account doesn’t have a HYPE Card for its selected athlete yet.")
            )
            .foregroundStyle(SupporterHomeColors.muted)
            .padding(.vertical, 36)
        }

        if settings != nil {
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
                    frontCardFace(card)
                        .rotation3DEffect(
                            .degrees(cardRotation),
                            axis: (x: 0, y: 1, z: 0),
                            perspective: 0.65
                        )
                        .opacity(cardRotation < 90 ? 1 : 0)
                        .accessibilityHidden(cardRotation >= 90)
                        .allowsHitTesting(cardRotation < 90)

                    ScrollView {
                        cardSideContent(selectedSide, card: card)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .scrollIndicators(.hidden)
                    .padding(12)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(SupporterHomeColors.background)
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

            if selectedSide == .front,
               let moment = card.favoriteMoment?.trimmingCharacters(in: .whitespacesAndNewlines),
               !moment.isEmpty {
                favoriteMomentPanel(moment)
            }
        }
        .onChange(of: availableSides) { _, sides in
            guard !sides.contains(selectedSide) else { return }
            flipTask?.cancel()
            flipTask = nil
            isFlipping = false
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
    private func cardSideContent(_ side: NativeHypeCardSide, card: NativePublicHypeCard) -> some View {
        switch side {
        case .front:
            emptySide(title: "HYPE Card", detail: "Choose Front to return to the athlete’s card.")
        case .stats:
            if settings?.showStats == true, let stats = card.stats {
                statsSide(stats)
            } else {
                emptySide(title: "Stats are unavailable", detail: "The card owner has not enabled finalized stats.")
            }
        case .videos:
            videosSide(card)
        case .events:
            if settings?.showEvents == true, card.showEvents {
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

        withAnimation(.easeInOut(duration: duration)) {
            cardRotation = 0
        }
        flipTask = Task { @MainActor in
            do {
                try await Task.sleep(nanoseconds: delay)
                selectedSide = side
                withAnimation(.easeInOut(duration: duration)) {
                    cardRotation = 180
                }
                try await Task.sleep(nanoseconds: delay)
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

            VStack(alignment: .leading, spacing: 12) {
                TextField("Favorite moment", text: $draftFavoriteMoment)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Favorite moment")
                    .accessibilityIdentifier("native-hype-card-favorite-moment")
                    .onChange(of: draftFavoriteMoment) { _, value in
                        if value.count > 160 {
                            draftFavoriteMoment = String(value.prefix(160))
                        }
                    }
                Text("\(draftFavoriteMoment.count) / 160")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }

            Toggle("Show HYPE Card", isOn: $draftShowHypeCard)
                .foregroundStyle(.white)
                .accessibilityIdentifier("native-hype-card-toggle-public")
            Toggle("Share finalized stats", isOn: $draftShowStats)
                .foregroundStyle(.white)
                .accessibilityIdentifier("native-hype-card-toggle-stats")
            Toggle("Share Event Cards", isOn: $draftShowEvents)
                .foregroundStyle(.white)
                .accessibilityIdentifier("native-hype-card-toggle-events")
            Toggle("Pause public page", isOn: $draftPaused)
                .foregroundStyle(.white)
                .accessibilityIdentifier("native-hype-card-toggle-paused")

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
            .disabled(isSaving || !hasUnsavedSettings)
            .accessibilityIdentifier("native-hype-card-save-settings")

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

    private func requestSettingsSave() {
        guard let settings else { return }
        let becomesPublic = draftShowHypeCard && !draftPaused
            && (!settings.showHypeCard || settings.paused)
        if becomesPublic {
            showPublishConfirmation = true
        } else {
            Task { await saveSettings(confirmPublish: false) }
        }
    }

    private func saveSettings(confirmPublish: Bool) async {
        guard let clerk, !isSaving else { return }
        isSaving = true
        settingsMessage = nil
        defer { isSaving = false }
        let favorite = draftFavoriteMoment.trimmingCharacters(in: .whitespacesAndNewlines)
        let update = NativeHypeCardSettingsUpdate(
            showHypeCard: draftShowHypeCard,
            showStats: draftShowStats,
            showEvents: draftShowEvents,
            paused: draftPaused,
            favoriteMoment: favorite.isEmpty ? nil : favorite,
            confirmPublish: confirmPublish
        )
        do {
            let saved = try await SupporterHomeAPI.updateNativeHypeCard(settings: update, clerk: clerk)
            settings = saved
            draftShowHypeCard = saved.showHypeCard
            draftShowStats = saved.showStats
            draftShowEvents = saved.showEvents
            draftPaused = saved.paused
            draftFavoriteMoment = saved.favoriteMoment ?? ""
            await loadCard(refresh: true)
            settingsMessage = "HYPE Card settings saved."
        } catch {
            settingsMessage = "We couldn’t confirm that your HYPE Card settings were saved. Please check and try again if needed."
        }
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
        favoriteMoment: String?,
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

            if let favoriteMoment = favoriteMoment?.trimmingCharacters(in: .whitespacesAndNewlines),
               !favoriteMoment.isEmpty {
                favoriteMomentPanel(favoriteMoment)
            }
        }
    }

    private func favoriteMomentPanel(_ favoriteMoment: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SupporterEyebrow(text: "Favorite moment", color: SupporterHomeColors.muted)
            Text(favoriteMoment)
                .font(.body.weight(.semibold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 18))
        .supporterSurfaceShadow()
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
            privateCard = nil
            privatePhoto = nil
            settings = nil
            unavailable = false
        }
        defer {
            if refresh { isRefreshing = false }
        }

        guard let clerk else {
            loading = false
            athleteProfile = nil
            if refresh {
                card = nil
                privateCard = nil
                privatePhoto = nil
                settings = nil
                unavailable = false
                refreshErrorMessage = "Sign in to the iPhone app again."
            } else {
                unavailable = true
            }
            return
        }
        do {
            let result = try await SupporterHomeAPI.fetchOwnerHypeCardPreview(clerk: clerk)
            let profile = try? await SupporterHomeAPI.fetchAthleteProfile(clerk: clerk)
            guard !Task.isCancelled else { return }
            athleteProfile = profile
            identityMismatch = result.identityMismatch
            identityCorrectionId = result.correctionId
            let preserveUnsavedDraft = hasUnsavedSettings
            card = result.publicCard
            privateCard = result.privateCard
            settings = result.settings
            if !preserveUnsavedDraft {
                draftShowHypeCard = result.settings?.showHypeCard ?? false
                draftShowStats = result.settings?.showStats ?? false
                draftShowEvents = result.settings?.showEvents ?? false
                draftPaused = result.settings?.paused ?? false
                draftFavoriteMoment = result.settings?.favoriteMoment ?? ""
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
            if refresh {
                refreshErrorMessage = "Your HYPE Card preview couldn’t refresh right now. Please try again."
            } else {
                errorMessage = "We couldn’t load your HYPE Card right now. Please try again."
            }
        }
    }
}
