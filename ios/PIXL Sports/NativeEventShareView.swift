import SwiftUI
import ClerkKit

struct NativeEventShareView: View {
    let schedule: NativeSupporterSchedule
    let event: AthleteFanEvent
    let clerk: Clerk
    var embedded: Bool = false

    @State private var hypeCardShareURL: URL?
    @State private var isCheckingHypeCardShare = true
    @State private var hypeCardShareError = false

    var body: some View {
        Group {
            if embedded {
                VStack(alignment: .leading, spacing: 36) {
                    eventShareCard
                    VStack(spacing: 12) {
                        hypeCardShareCard
                        hypeCardShareAction
                    }
                }
            } else {
                ZStack {
                    NativePageBackground()
                    Form { shareSections }
                        .foregroundStyle(.white)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .tint(NativeEventToolColors.share)
        .preferredColorScheme(.light)
        .eventToolNavigationTitle("Share", embedded: embedded)
        .navigationBarTitleDisplayMode(.inline)
        .task(id: clerk.user?.id) {
            await refreshHypeCardShareURL()
        }
    }

    private var eventShareCard: some View {
        ShareLink(item: shareText) {
            HStack(spacing: 12) {
                Image(systemName: "calendar")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(NativeEventToolColors.share)
                    .frame(width: 40, height: 40)
                    .background(
                        NativeEventToolColors.share.opacity(0.14),
                        in: RoundedRectangle(cornerRadius: 13, style: .continuous)
                    )
                    .accessibilityHidden(true)
                Text("Share event details")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Image(systemName: "square.and.arrow.up")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(NativeEventToolColors.share)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, minHeight: 62, alignment: .leading)
            .background(SupporterCardBackground(cornerRadius: 17))
            .overlay {
                RoundedRectangle(cornerRadius: 17, style: .continuous)
                    .strokeBorder(NativeEventToolColors.share.opacity(0.28), lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
            .accessibilityIdentifier("native-event-share-details-card")
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Share event details")
        .accessibilityIdentifier("native-event-share-details")
    }

    private var hypeCardShareCard: some View {
        NavigationLink {
            SupporterHypeCardView(clerk: clerk)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "person.crop.rectangle")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(NativeEventToolColors.share)
                    .frame(width: 44, height: 44)
                    .background(NativeEventToolColors.share.opacity(0.13), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 5) {
                    SupporterEyebrow(text: "Athlete Showcase")
                    Text("Review & share HYPE Card")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Review the card before sharing. A private HYPE Card stays private.")
                        .font(.subheadline)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Image(systemName: "arrow.right")
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(NativeEventToolColors.share)
                    .padding(.top, 3)
                    .accessibilityHidden(true)
            }
            .padding(15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 19, style: .continuous)
                    .strokeBorder(NativeEventToolColors.share.opacity(0.30), lineWidth: 1)
            }
            .supporterSurfaceShadow()
            .contentShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("native-event-share-hype-card")
    }

    @ViewBuilder
    private var hypeCardShareAction: some View {
        if let shareURL = hypeCardShareURL {
            ShareLink(item: shareURL) {
                Label("Share HYPE Card", systemImage: "square.and.arrow.up")
                    .font(.subheadline.weight(.bold))
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .background(
                        NativeEventToolColors.share,
                        in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                    )
                    .foregroundStyle(SupporterHomeColors.background)
                    .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("native-event-share-hype-direct")
        } else if isCheckingHypeCardShare {
            HStack(spacing: 10) {
                ProgressView()
                    .tint(NativeEventToolColors.share)
                Text("Checking HYPE Card availability…")
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .accessibilityIdentifier("native-event-hype-share-checking")
        } else if hypeCardShareError {
            Button {
                Task { await refreshHypeCardShareURL() }
            } label: {
                Label("Try sharing the HYPE Card again", systemImage: "arrow.clockwise")
                    .font(.subheadline.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            }
            .buttonStyle(.plain)
            .foregroundStyle(NativeEventToolColors.share)
            .accessibilityIdentifier("native-event-hype-share-retry")
        } else {
            Text("This HYPE Card is private or paused. Review its settings before sharing.")
                .font(.subheadline)
                .foregroundStyle(SupporterHomeColors.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("native-event-hype-share-unavailable")
        }
    }

    @ViewBuilder
    private var shareSections: some View {
            Section("Event details") {
                VStack(alignment: .leading, spacing: 6) {
                    Text(event.title).font(.headline)
                    Text("\(event.formattedFullDate(timezone: zone)) · \(event.formattedTime(timezone: zone))")
                        .font(.subheadline)
                        .foregroundStyle(SupporterHomeColors.muted)
                    if let location {
                        Text(location).font(.subheadline)
                    }
                }
                ShareLink(item: shareText) {
                    Label("Share event details", systemImage: "square.and.arrow.up")
                }
                .accessibilityIdentifier("native-event-share-details")
            }
            .listRowBackground(SupporterHomeColors.panel)

            Section {
                NavigationLink {
                    SupporterHypeCardView(clerk: clerk)
                } label: {
                    Label("Review & share HYPE Card", systemImage: "person.crop.rectangle")
                }
                .accessibilityIdentifier("native-event-share-hype-card")
                hypeCardShareAction
            } header: {
                Text("Athlete HYPE Card")
            } footer: {
                Text("Share is available only while the HYPE Card is public and active. Review its settings before sharing.")
            }
            .listRowBackground(SupporterHomeColors.panel)
    }

    @MainActor
    private func refreshHypeCardShareURL() async {
        isCheckingHypeCardShare = true
        hypeCardShareError = false
        hypeCardShareURL = nil
        defer { isCheckingHypeCardShare = false }
        do {
            let url = try await SupporterHomeAPI.fetchOwnerHypeCardShareURL(clerk: clerk)
            guard !Task.isCancelled else { return }
            hypeCardShareURL = url
        } catch {
            guard !Task.isCancelled else { return }
            hypeCardShareError = true
        }
    }

    private var zone: String? { event.timezone ?? schedule.timezone }

    private var location: String? {
        let value = event.location.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private var shareText: String {
        [
            "PIXL SPORTS · \(event.title)",
            "\(event.formattedFullDate(timezone: zone)) · \(event.formattedTime(timezone: zone))",
            zone.map { "Time zone: \($0)" },
            event.opponent.isEmpty ? nil : "Opponent: \(event.opponent)",
            location.map { "Location: \($0)" },
        ].compactMap { $0 }.joined(separator: "\n")
    }
}
