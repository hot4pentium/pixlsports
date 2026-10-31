import SwiftUI
import ClerkKit

@MainActor
struct SupporterHypeCardView: View {
    @Environment(\.scenePhase) private var scenePhase
    let clerk: Clerk?

    @State private var card: NativePublicHypeCard?
    @State private var unavailable = false
    @State private var errorMessage: String?
    @State private var loading = true

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [SupporterHomeColors.background, Color(red: 0.035, green: 0.10, blue: 0.20)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    SupporterEyebrow(text: "Player Showcase")
                    Text("HYPE Card")
                        .font(.largeTitle.weight(.black))
                        .fontDesign(.rounded)
                        .foregroundStyle(.white)
                        .accessibilityAddTraits(.isHeader)

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
            hypeCard(card)
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
                description: Text("The connected PIXL account doesn’t have a shared HYPE Card for this athlete.")
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

    private func hypeCard(_ card: NativePublicHypeCard) -> some View {
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

                    if let url = photoURL {
                        AsyncImage(url: url) { image in
                            image.resizable().scaledToFill()
                        } placeholder: {
                            athleteSilhouette
                        }
                        .frame(width: geometry.size.width, height: geometry.size.height)
                        .clipped()
                        .accessibilityLabel("\(card.athleteName)’s photo")
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
                        Text(card.athleteName)
                            .font(.largeTitle.weight(.black))
                            .fontDesign(.rounded)
                            .foregroundStyle(.white)
                            .lineLimit(2)
                            .minimumScaleFactor(0.7)
                        Text([card.teamName, card.seasonName].filter { !$0.isEmpty }.joined(separator: " · "))
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
            .accessibilityLabel("\(card.athleteName), \(card.teamName), \(card.seasonName), HYPE Card")
            .accessibilityIdentifier("native-hype-card")

            if let favoriteMoment = card.favoriteMoment?.trimmingCharacters(in: .whitespacesAndNewlines),
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

    private func loadCard() async {
        guard let clerk else {
            loading = false
            unavailable = true
            return
        }
        loading = true
        errorMessage = nil
        do {
            let result = try await SupporterHomeAPI.fetchPublicHypeCard(clerk: clerk)
            guard !Task.isCancelled else { return }
            card = result
            unavailable = result == nil
            loading = false
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            loading = false
            errorMessage = error.localizedDescription
        }
    }
}
