import SwiftUI
import ClerkKit

struct NativeEventShareView: View {
    let schedule: NativeSupporterSchedule
    let event: AthleteFanEvent
    let clerk: Clerk
    var embedded: Bool = false

    var body: some View {
        Group {
            if embedded {
                VStack(alignment: .leading, spacing: 12) {
                    eventShareCard
                    hypeCardShareCard
                }
            } else {
                Form { shareSections }
            }
        }
        .scrollContentBackground(.hidden)
        .tint(SupporterHomeColors.accent)
        .preferredColorScheme(.dark)
        .navigationTitle(embedded ? "Event Details" : "Share")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var eventShareCard: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 9) {
                Image(systemName: "calendar")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(SupporterHomeColors.blue)
                    .accessibilityHidden(true)
                SupporterEyebrow(text: "Event details", color: SupporterHomeColors.blue)
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(event.title)
                    .font(.title3.weight(.black))
                    .fontDesign(.rounded)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(event.formattedFullDate(timezone: zone)) · \(event.formattedTime(timezone: zone))")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
                if !event.location.isEmpty {
                    Label(event.location, systemImage: "mappin.and.ellipse")
                        .font(.subheadline)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            ShareLink(item: shareText) {
                HStack(spacing: 9) {
                    Image(systemName: "square.and.arrow.up")
                    Text("Share event details")
                    Spacer(minLength: 0)
                    Image(systemName: "arrow.up.right")
                }
                .font(.subheadline.weight(.bold))
                .frame(maxWidth: .infinity, minHeight: 44)
            }
            .buttonStyle(SupporterPrimaryButtonStyle())
            .accessibilityIdentifier("native-event-share-details")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [SupporterHomeColors.blue.opacity(0.16), Color.white.opacity(0.045)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            ),
            in: RoundedRectangle(cornerRadius: 20, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .strokeBorder(SupporterHomeColors.blue.opacity(0.28), lineWidth: 1)
        }
        .accessibilityIdentifier("native-event-share-details-card")
    }

    private var hypeCardShareCard: some View {
        NavigationLink {
            SupporterHypeCardView(clerk: clerk)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "person.crop.rectangle")
                    .font(.title3.weight(.bold))
                    .foregroundStyle(SupporterHomeColors.accent)
                    .frame(width: 44, height: 44)
                    .background(SupporterHomeColors.accent.opacity(0.13), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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
                    .foregroundStyle(SupporterHomeColors.accent)
                    .padding(.top, 3)
                    .accessibilityHidden(true)
            }
            .padding(15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 19, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 19, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.13), lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("native-event-share-hype-card")
    }

    @ViewBuilder
    private var shareSections: some View {
            Section("Event details") {
                VStack(alignment: .leading, spacing: 6) {
                    Text(event.title).font(.headline)
                    Text("\(event.formattedFullDate(timezone: zone)) · \(event.formattedTime(timezone: zone))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if !event.location.isEmpty {
                        Text(event.location).font(.subheadline)
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
            } header: {
                Text("Athlete HYPE Card")
            } footer: {
                Text("Review your athlete’s card before sharing. This does not publish a private HYPE Card.")
            }
            .listRowBackground(SupporterHomeColors.panel)
    }

    private var zone: String? { event.timezone ?? schedule.timezone }

    private var shareText: String {
        [
            "PIXL SPORTS · \(event.title)",
            "\(event.formattedFullDate(timezone: zone)) · \(event.formattedTime(timezone: zone))",
            zone.map { "Time zone: \($0)" },
            event.opponent.isEmpty ? nil : "Opponent: \(event.opponent)",
            event.location.isEmpty ? nil : "Location: \(event.location)",
        ].compactMap { $0 }.joined(separator: "\n")
    }
}
