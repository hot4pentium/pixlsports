import SwiftUI

struct NativeFanCheersView: View {
    let summary: LiveTapSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Fan Cheers", systemImage: "hands.clap.fill")
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
            if summary.active {
                tally("Current game", cheers: summary.cheers)
            }
            tally("Season total", cheers: summary.seasonCheers ?? [])
            if let completed = summary.completedSessions?.first {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Last completed game").font(.headline)
                    Text(completed.eventTitle).font(.subheadline)
                    Text("\(completed.total) cheers").font(.title3.bold())
                }
                .accessibilityElement(children: .combine)
            }
            Text("Cheers celebrate the athlete. They don’t change player stats.")
                .font(.caption)
                .foregroundStyle(SupporterHomeColors.muted)
        }
        .foregroundStyle(.white)
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
        .accessibilityIdentifier("native-hype-card-fan-cheers")
    }

    private func tally(_ title: String, cheers: [LiveTapCheer]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            Text("\(cheers.reduce(0) { $0 + $1.count }) cheers")
                .font(.title2.weight(.black))
                .foregroundStyle(SupporterHomeColors.accent)
                .monospacedDigit()
            ForEach(cheers.filter { $0.count > 0 }) { cheer in
                HStack(alignment: .firstTextBaseline) {
                    Text(cheer.label).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 12)
                    Text("\(cheer.count)").monospacedDigit()
                }
                .font(.subheadline)
                .accessibilityElement(children: .combine)
            }
        }
    }
}

struct NativeLiveTapCelebrationView: View {
    @Environment(\.dismiss) private var dismiss
    @AccessibilityFocusState private var headingFocused: Bool
    let celebration: NativeLiveTapCelebration

    var body: some View {
        NavigationStack {
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 22) {
                    Image(systemName: "hands.clap.fill")
                        .font(.largeTitle)
                        .foregroundStyle(SupporterHomeColors.accent)
                        .accessibilityHidden(true)
                    Text(celebration.completion.total > 0 ? "You brought the HYPE!" : "Thanks for being here!")
                        .font(.largeTitle.weight(.black))
                        .fontDesign(.rounded)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                        .accessibilityFocused($headingFocused)
                    Text(celebration.completion.athleteName).font(.title2.bold())
                    Text(celebration.completion.eventTitle).font(.headline)
                    if let personal = celebration.personalTotal {
                        Text("You sent \(personal) \(personal == 1 ? "cheer" : "cheers").")
                            .font(.title2.bold())
                    }
                    Text("Together, your Fan Base sent \(celebration.completion.total) \(celebration.completion.total == 1 ? "cheer" : "cheers").")
                        .font(.title2.bold())
                        .fixedSize(horizontal: false, vertical: true)
                    ForEach(celebration.completion.cheers) { cheer in
                        HStack(alignment: .firstTextBaseline) {
                            Text(cheer.label).fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 12)
                            Text("\(cheer.count)").monospacedDigit()
                        }
                        .font(.body)
                        .accessibilityElement(children: .combine)
                    }
                    if celebration.personalTotal == nil {
                        Text("This is the combined game record. A reliable personal total isn’t available for earlier cheers.")
                            .font(.subheadline)
                    }
                    if celebration.pendingCount > 0 {
                        Text("\(celebration.pendingCount) cheers saved on this iPhone aren’t confirmed and are not included.")
                            .font(.subheadline)
                    }
                    Button("Done") { dismiss() }
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .buttonStyle(.borderedProminent)
                        .tint(SupporterHomeColors.accent)
                        .foregroundStyle(SupporterHomeColors.background)
                        .accessibilityIdentifier("native-cheer-celebration-done")
                }
                .foregroundStyle(.white)
                .padding(24)
                .frame(maxWidth: 520, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(SupporterHomeColors.panel)
            .navigationTitle("Fan Cheers")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { headingFocused = true }
        }
        // Static celebration: no motion, including when Reduce Motion is enabled.
        .presentationDragIndicator(.visible)
        .accessibilityIdentifier("native-cheer-celebration")
    }
}
