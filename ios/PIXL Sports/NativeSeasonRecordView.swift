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

struct NativeFanBaseEntryView: View {
    var body: some View {
        Text("Fan Base")
            .font(.subheadline.weight(.bold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .frame(maxWidth: 160, minHeight: 44)
            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(SupporterHomeColors.blue.opacity(0.45), lineWidth: 1)
            }
    }
}

struct NativeFanBaseView: View {
    let fanBase: NativeSupporterFanBase

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "person.3.fill")
                    .foregroundStyle(SupporterHomeColors.accent)
                    .accessibilityHidden(true)
                Text("FAN BASE")
                    .font(.caption.weight(.black))
                    .tracking(1.4)
                    .foregroundStyle(.white)
                Spacer()
                Text("\(fanBase.totalFollows) \(fanBase.totalFollows == 1 ? "FOLLOW" : "FOLLOWS")")
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            HStack(spacing: 12) {
                count(fanBase.namedFans.count, title: "SHARED A NAME")
                count(fanBase.anonymousFollows, title: "NO NAME")
            }
            if !fanBase.namedFans.isEmpty {
                Text(fanBase.namedFans.joined(separator: " · "))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Fans who shared their name: \(fanBase.namedFans.joined(separator: ", "))")
            } else {
                Text(fanBase.totalFollows == 0
                    ? "Fans will appear here when they follow your HYPE Card."
                    : "No one has shared a name yet.")
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            Text("Follows are from devices; names are self-entered.")
                .font(.caption)
                .foregroundStyle(SupporterHomeColors.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(SupporterHomeColors.blue.opacity(0.45), lineWidth: 1)
        }
        .supporterSurfaceShadow()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("dashboard-fan-base")
    }

    private func count(_ value: Int, title: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(value.formatted())
                .font(.title2.weight(.black))
                .monospacedDigit()
                .foregroundStyle(.white)
            Text(title)
                .font(.caption2.weight(.black))
                .tracking(0.5)
                .foregroundStyle(SupporterHomeColors.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(value) \(title.lowercased())")
    }
}

struct NativeFanBaseStatusView: View {
    let isLoading: Bool
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("FAN BASE")
                .font(.caption.weight(.black))
                .tracking(1.4)
                .foregroundStyle(.white)
            if isLoading {
                ProgressView("Loading the latest Fan Base count…")
                    .tint(.white)
                    .foregroundStyle(.white)
            } else {
                Text(message)
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Try again", action: retry)
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(.white)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("dashboard-fan-base-retry")
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityIdentifier("dashboard-fan-base-status")
    }
}
