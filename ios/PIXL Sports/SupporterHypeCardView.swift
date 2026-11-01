import SwiftUI
import ClerkKit
import UIKit

@MainActor
struct SupporterHypeCardView: View {
    @Environment(\.scenePhase) private var scenePhase
    let clerk: Clerk?

    @State private var card: NativePublicHypeCard?
    @State private var privateCard: NativePrivateHypeCard?
    @State private var privatePhoto: UIImage?
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
                    SupporterEyebrow(text: "Player Showcase")
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
                        .accessibilityIdentifier("native-hype-card-refresh-error")
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
                .disabled(loading || isRefreshing)
                .accessibilityLabel("Refresh HYPE Card")
                .accessibilityHint("Reload the preview from your linked PIXL account.")
                .accessibilityIdentifier("native-hype-card-refresh")
            }
        }
        .task { await loadCard() }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await loadCard() }
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
            hypeCard(
                athleteName: card.athleteName,
                teamName: card.teamName,
                seasonName: card.seasonName,
                favoriteMoment: card.favoriteMoment,
                photoURL: photoURL,
                privatePhoto: nil
            )
            if let shareURL = card.shareURL {
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
                .foregroundStyle(SupporterHomeColors.accent)
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
        } else if unavailable {
            ContentUnavailableView(
                "No HYPE Card is available",
                systemImage: "sportscourt",
                description: Text("The linked PIXL account doesn’t have a HYPE Card for its selected athlete yet.")
            )
            .foregroundStyle(SupporterHomeColors.muted)
            .padding(.vertical, 36)
        }
    }

    private var photoURL: URL? {
        guard let photo = card?.cutoutUrl ?? card?.photoUrl,
              let url = URL(string: photo),
              url.scheme == "https" else {
            return nil
        }
        return url
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
            GeometryReader { geometry in
                ZStack(alignment: .bottomLeading) {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [SupporterHomeColors.blue.opacity(0.9), SupporterHomeColors.panel, SupporterHomeColors.background],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )

                    if let privatePhoto {
                        Image(uiImage: privatePhoto)
                            .resizable()
                            .scaledToFill()
                            .frame(width: geometry.size.width, height: geometry.size.height)
                            .clipped()
                            .accessibilityLabel("\(athleteName)’s photo")
                    } else if let url = photoURL {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            athleteSilhouette
                        }
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .clipped()
                        .accessibilityLabel("\(athleteName)’s photo")
                    } else {
                        athleteSilhouette
                    }

                    LinearGradient(
                        colors: [.clear, .black.opacity(0.05), .black.opacity(0.82)],
                        startPoint: .center,
                        endPoint: .bottom
                    )

                    VStack(alignment: .leading, spacing: 4) {
                        Text("PIXL SPORTS · HYPE CARD")
                            .font(.caption2.weight(.black))
                            .tracking(1.6)
                            .foregroundStyle(SupporterHomeColors.accent)
                        Text(athleteName)
                            .font(.largeTitle.weight(.black))
                            .fontDesign(.rounded)
                            .foregroundStyle(.white)
                            .lineLimit(2)
                            .minimumScaleFactor(0.7)
                        Text([teamName, seasonName].filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.subheadline.weight(.bold))
                            .foregroundStyle(.white.opacity(0.88))
                            .lineLimit(2)
                    }
                    .padding(20)
                }
                .frame(width: geometry.size.width, height: geometry.size.height)
            }
            .aspectRatio(2.0 / 3.0, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(SupporterHomeColors.blue.opacity(0.85), lineWidth: 2)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("\(athleteName), \(teamName), \(seasonName), HYPE Card")
            .accessibilityIdentifier("native-hype-card")

            if let favoriteMoment = favoriteMoment?.trimmingCharacters(in: .whitespacesAndNewlines),
               !favoriteMoment.isEmpty {
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
            }
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
            unavailable = false
        }
        defer {
            if refresh { isRefreshing = false }
        }

        guard let clerk else {
            loading = false
            if refresh {
                card = nil
                privateCard = nil
                privatePhoto = nil
                unavailable = false
                refreshErrorMessage = "Sign in to the iPhone app again."
            } else {
                unavailable = true
            }
            return
        }
        do {
            let result = try await SupporterHomeAPI.fetchOwnerHypeCardPreview(clerk: clerk)
            guard !Task.isCancelled else { return }
            card = result.publicCard
            privateCard = result.privateCard
            if let imageData = result.privatePhoto {
                privatePhoto = UIImage(data: imageData)
            }
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
                refreshErrorMessage = error.localizedDescription
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }
}
