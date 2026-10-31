import SwiftUI
import ClerkKit

struct NativeEventShareView: View {
    let schedule: NativeSupporterSchedule
    let event: AthleteFanEvent
    let clerk: Clerk

    var body: some View {
        Form {
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
        .scrollContentBackground(.hidden)
        .background(SupporterHomeColors.background)
        .tint(SupporterHomeColors.accent)
        .preferredColorScheme(.dark)
        .navigationTitle("Share")
        .navigationBarTitleDisplayMode(.inline)
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
