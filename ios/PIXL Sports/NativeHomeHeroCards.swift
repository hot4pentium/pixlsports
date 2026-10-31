import SwiftUI

/// A compact, schedule-aware pair of supporter dashboard actions.
struct NativeHomeHeroCards: View {
    let athleteName: String
    let teamName: String?
    let nextEvent: AthleteFanEvent?
    let eventTiming: SupporterEventTiming?
    let hypePhotoURL: String?
    let hypePreviewFailed: Bool
    let onOpenEvent: () -> Void
    let onOpenHypeCard: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var pairLayout: AnyLayout {
        dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
    }

    private var timingTitle: String {
        switch eventTiming {
        case .live: return "CAPTURE THE GAME"
        case .complete: return "SEND THE HYPE"
        case .upcoming, .none: return "GET READY"
        }
    }

    private var eventAccessibilityDescription: String {
        guard let nextEvent else {
            return "Game-day message board. No upcoming Event Card is available. Tap to create one."
        }
        let status = eventTiming == .live ? "Live now" : eventTiming == .complete ? "After the event" : "Upcoming"
        return "Game-day message board, \(status), \(nextEvent.title), \(nextEvent.formattedDate(timezone: nextEvent.timezone)). Tap to open the Event Card."
    }

    private var validHypePhotoURL: URL? {
        guard let hypePhotoURL, let url = URL(string: hypePhotoURL), url.scheme == "https" else { return nil }
        return url
    }

    var body: some View {
        pairLayout {
            Button(action: onOpenEvent) {
                eventCard
            }
            .buttonStyle(SupporterCardPressStyle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(eventAccessibilityDescription)
            .accessibilityHint(nextEvent == nil
                ? "Opens the Event Card creation form."
                : "Opens the game-day message board and the next Event Card task.")
            .accessibilityIdentifier("dashboard-message-board-card")

            Button(action: onOpenHypeCard) {
                hypeCard
            }
            .buttonStyle(SupporterCardPressStyle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(hypePreviewFailed
                ? "HYPE Card preview did not load. Tap to open the HYPE Card and try again."
                : "HYPE Card for \(athleteName)\(teamName.map { ", \($0)" } ?? "").")
            .accessibilityHint("Opens the athlete’s HYPE Card.")
            .accessibilityIdentifier("dashboard-hype-card")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var eventCard: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 5) {
                Image(systemName: eventTiming == .live ? "dot.radiowaves.left.and.right" : "sportscourt.fill")
                    .font(.system(size: 10, weight: .black))
                    .accessibilityHidden(true)
                Text(eventStatusLabel)
                    .font(.system(size: 9, weight: .black, design: .rounded))
                    .tracking(0.7)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
            }
            .foregroundStyle(SupporterHomeColors.blue)

            if let nextEvent {
                Text(nextEvent.formattedDate(timezone: nextEvent.timezone))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Color(red: 0.30, green: 0.37, blue: 0.47))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                Text(nextEvent.title)
                    .font(.system(.subheadline, design: .rounded).weight(.black))
                    .foregroundStyle(SupporterHomeColors.background)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("No event yet")
                    .font(.system(.subheadline, design: .rounded).weight(.black))
                    .foregroundStyle(SupporterHomeColors.background)
                    .fixedSize(horizontal: false, vertical: true)
                Text("Your next task will appear here when an Event Card is added.")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Color(red: 0.30, green: 0.37, blue: 0.47))
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)

            HStack(alignment: .center, spacing: 4) {
                Text(nextEvent == nil ? "CREATE EVENT" : timingTitle)
                    .font(.system(size: 9, weight: .black, design: .rounded))
                    .tracking(0.65)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 8, weight: .black))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(SupporterHomeColors.background)
            .padding(.horizontal, 8)
            .frame(minHeight: 28)
            .background(SupporterHomeColors.accent, in: Capsule())
        }
        .frame(maxWidth: .infinity, minHeight: 220, alignment: .leading)
        .padding(12)
        .background(Color(red: 0.96, green: 0.97, blue: 0.94), in: RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay(alignment: .trailing) {
            RoundedRectangle(cornerRadius: 2)
                .fill(SupporterHomeColors.blue.opacity(0.5))
                .frame(width: 3, height: 34)
                .padding(.trailing, 1)
                .accessibilityHidden(true)
        }
        .clipShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 19, style: .continuous)
                .strokeBorder(.white.opacity(0.72), lineWidth: 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
    }

    private var eventStatusLabel: String {
        guard let nextEvent else { return "GAME-DAY MESSAGE BOARD" }
        let eventKind = nextEvent.type == "practice" ? "PRACTICE" : "GAME"
        switch eventTiming {
        case .live: return "\(eventKind) · LIVE NOW"
        case .complete: return "\(eventKind) · AFTER EVENT"
        case .upcoming, .none: return "UPCOMING \(eventKind)"
        }
    }

    private var hypeCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("PIXL")
                    .font(.system(size: 10, weight: .black, design: .rounded))
                    .tracking(1.3)
                    .foregroundStyle(SupporterHomeColors.accent)
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 10, weight: .black))
                    .foregroundStyle(.white.opacity(0.78))
                    .accessibilityHidden(true)
            }

            Spacer(minLength: 2)

            if validHypePhotoURL == nil {
                ZStack {
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(SupporterHomeColors.blue.opacity(0.25))
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .strokeBorder(SupporterHomeColors.accent.opacity(0.65), lineWidth: 1)
                    if hypePreviewFailed {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.title2.weight(.bold))
                            .foregroundStyle(SupporterHomeColors.accent)
                    } else {
                        Text("H")
                            .font(.system(size: 27, weight: .black, design: .rounded))
                            .foregroundStyle(.white)
                            .overlay(alignment: .bottomTrailing) {
                                Circle()
                                    .fill(SupporterHomeColors.accent)
                                    .frame(width: 7, height: 7)
                                    .offset(x: 3, y: 2)
                            }
                    }
                }
                .frame(width: 42, height: 42)
                .accessibilityHidden(true)
            } else {
                Spacer(minLength: 0)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(athleteName)
                    .font(.system(.subheadline, design: .rounded).weight(.black))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
                    .fixedSize(horizontal: false, vertical: true)
                if let teamName, !teamName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(teamName)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(SupporterHomeColors.muted)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220, alignment: .leading)
        .padding(12)
        .background {
            ZStack(alignment: .topTrailing) {
                if let photoURL = validHypePhotoURL {
                    AsyncImage(url: photoURL) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        SupporterHomeColors.panel
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                }
                LinearGradient(
                    colors: [
                        SupporterHomeColors.background.opacity(0.32),
                        SupporterHomeColors.background.opacity(0.10),
                        SupporterHomeColors.background.opacity(0.93)
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                RoundedRectangle(cornerRadius: 19, style: .continuous)
                    .strokeBorder(.white.opacity(0.12), lineWidth: 1)
                Circle()
                    .strokeBorder(.white.opacity(0.08), lineWidth: 1)
                    .frame(width: 94, height: 94)
                    .offset(x: 31, y: -39)
                    .accessibilityHidden(true)
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 19, style: .continuous)
                .strokeBorder(.white.opacity(0.12), lineWidth: 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
    }
}
