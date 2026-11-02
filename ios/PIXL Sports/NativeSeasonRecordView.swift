import SwiftUI

struct NativeSeasonRecordView: View {
    let record: NativeSeasonRecord

    var body: some View {
        VStack(spacing: 15) {
            HStack(spacing: 8) {
                Image(systemName: "chart.bar.fill")
                    .foregroundStyle(SupporterHomeColors.accent)
                    .accessibilityHidden(true)
                Text("GAME RECORD")
                    .font(.caption.weight(.black))
                    .tracking(1.4)
                    .foregroundStyle(.white)
                Spacer(minLength: 0)
                Text("\(record.gamesPlayed) \(record.gamesPlayed == 1 ? "GAME" : "GAMES")")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            HStack(spacing: 0) {
                metric(record.wins, title: "WINS", color: SupporterHomeColors.accent)
                Divider().overlay(.white.opacity(0.2))
                metric(record.losses, title: "LOSSES", color: .white)
                Divider().overlay(.white.opacity(0.2))
                metric(record.ties, title: "TIES", color: Color(red: 0.52, green: 0.83, blue: 1))
            }
            .fixedSize(horizontal: false, vertical: true)
            Text(record.gamesPlayed == 0
                 ? "Finish a game and record its result to build your record."
                 : "\(record.sport?.capitalized ?? "Tracked") · Completed games")
                .font(.caption)
                .foregroundStyle(SupporterHomeColors.muted)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(SupporterHomeColors.blue.opacity(0.45), lineWidth: 1)
        }
        .supporterSurfaceShadow()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("dashboard-season-record")
    }

    private func metric(_ count: Int, title: String, color: Color) -> some View {
        VStack(spacing: 5) {
            Text(count.formatted())
                .font(.system(.largeTitle, design: .rounded).weight(.black))
                .monospacedDigit()
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(title)
                .font(.caption2.weight(.black))
                .tracking(0.8)
                .foregroundStyle(SupporterHomeColors.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count) \(count == 1 ? (title == "LOSSES" ? "loss" : title == "TIES" ? "tie" : "win") : title.lowercased())")
    }
}
