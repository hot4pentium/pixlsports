import SwiftUI
import UIKit

/// A compact, schedule-aware pair of supporter dashboard actions.
struct NativeHomeHeroCards: View {
    let athleteName: String
    let teamName: String?
    let jerseyNumber: String?
    let position: String?
    let scheduleTimezone: String?
    let nextEvent: AthleteFanEvent?
    let eventTiming: SupporterEventTiming?
    let eventStartsInFuture: Bool
    let seasonName: String
    let hypePhotoURL: String?
    let hypePrivatePhoto: UIImage?
    let hypePreviewFailed: Bool
    let showsFanBase: Bool
    let onOpenEvent: () -> Void
    let onOpenHypeCard: () -> Void
    let onOpenFanBase: () -> Void

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
            return "Game-day message board. Next step: create an Event Card. No upcoming Event Card is available. Tap to create one."
        }
        let status: String
        if eventTiming == .live {
            status = eventStartsInFuture ? "Starting soon" : "Live now"
        } else {
            status = eventTiming == .complete ? "After the event" : "Upcoming"
        }
        let action = eventTiming == .upcoming
            ? "Tap to open \(nextEvent.type == "practice" ? "practice" : "game") prep for this Event Card."
            : eventStartsInFuture
                ? "Tap to open the Event Card. Track Stats is available before kickoff."
                : "Tap to open the Event Card."
        return "Game-day message board. Next step: \(timingTitle.lowercased()). \(status), \(nextEvent.title), \(nextEvent.formattedDate(timezone: nextEvent.timezone ?? scheduleTimezone)), \(nextEvent.formattedTime(timezone: nextEvent.timezone ?? scheduleTimezone)), \(nextEvent.opponent), \(nextEvent.location). \(action)"
    }

    private var validHypePhotoURL: URL? {
        NativeHypeCardFront.publicPhotoURL(hypePhotoURL)
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
                : eventTiming == .upcoming
                    ? "Opens prep for the selected Event Card."
                    : "Opens the game-day message board and the next Event Card task.")
            .accessibilityIdentifier("dashboard-message-board-card")

            VStack(spacing: 10) {
                Button(action: onOpenHypeCard) {
                    hypeCard
                }
                .buttonStyle(SupporterCardPressStyle())
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(hypePreviewFailed
                    ? "HYPE Card preview did not load. Tap to open the HYPE Card and try again."
                    : "HYPE Card for \(athleteName)\(teamName.map { ", \($0)" } ?? "")\(hypePrivatePhoto != nil || validHypePhotoURL != nil ? ", with athlete photo" : "").")
                .accessibilityHint("Opens the athlete’s HYPE Card.")
                .accessibilityIdentifier("dashboard-hype-card")

                if showsFanBase {
                    Button(action: onOpenFanBase) {
                        NativeFanBaseEntryView()
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens all Fan Base details.")
                    .accessibilityIdentifier("dashboard-fan-base-entry")
                }
            }
            .frame(maxWidth: .infinity, alignment: .center)
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

            eventDetails
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                .layoutPriority(1)

            nextStepFooter
                .padding(.top, 14)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 260, alignment: .leading)
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
        .supporterSurfaceShadow()
        .contentShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
    }

    /// The flexible frame centers this non-shrinking group above the footer.
    private var eventDetails: some View {
        VStack(alignment: .leading, spacing: 9) {
            if let nextEvent {
                Text(nextEvent.formattedDate(timezone: nextEvent.timezone ?? scheduleTimezone))
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(Color(red: 0.30, green: 0.37, blue: 0.47))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)

                Text(nextEvent.title)
                    .font(.system(.subheadline, design: .rounded).weight(.black))
                    .foregroundStyle(SupporterHomeColors.background)
                    .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                Label(nextEvent.formattedTime(timezone: nextEvent.timezone ?? scheduleTimezone), systemImage: "clock")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.background)
                if !nextEvent.location.isEmpty {
                    Label(nextEvent.location, systemImage: "mappin.and.ellipse")
                        .font(.caption2)
                        .foregroundStyle(SupporterHomeColors.background.opacity(0.75))
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if !nextEvent.opponent.isEmpty && !nextEvent.title.localizedCaseInsensitiveContains(nextEvent.opponent) {
                    Text("vs \(nextEvent.opponent)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(SupporterHomeColors.background)
                        .lineLimit(dynamicTypeSize.isAccessibilitySize ? nil : 2)
                        .fixedSize(horizontal: false, vertical: true)
                }
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

        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var nextStepFooter: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text("Next Step")
                .font(.title3.weight(.black))
                .fontDesign(.rounded)
                .foregroundStyle(SupporterHomeColors.background)

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
    }

    private var eventStatusLabel: String {
        guard let nextEvent else { return "GAME-DAY MESSAGE BOARD" }
        let eventKind = nextEvent.type == "practice" ? "PRACTICE" : "GAME"
        switch eventTiming {
        case .live: return "\(eventKind) · \(eventStartsInFuture ? "STARTING SOON" : "LIVE NOW")"
        case .complete: return "\(eventKind) · AFTER EVENT"
        case .upcoming, .none: return "UPCOMING \(eventKind)"
        }
    }

    private var hypeCard: some View {
        NativeHypeCardFront(
            athleteName: athleteName, teamName: teamName ?? "", seasonName: seasonName,
            photoURL: validHypePhotoURL, privatePhoto: hypePrivatePhoto,
            identityDetails: athleteDetails
        )
        .frame(maxWidth: .infinity, minHeight: 284, alignment: .center)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
        .overlay(alignment: .topTrailing) {
            if hypePreviewFailed {
                Image(systemName: "exclamationmark.triangle.fill")
                    .foregroundStyle(SupporterHomeColors.accent)
                    .padding(12)
            }
        }
        .supporterSurfaceShadow()
        .contentShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
    }

    private var athleteDetails: String {
        var details: [String] = []

        if let jerseyNumber {
            let trimmedNumber = jerseyNumber.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedNumber.isEmpty {
                details.append("#\(trimmedNumber)")
            }
        }

        if let position {
            let trimmedPosition = position.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmedPosition.isEmpty {
                details.append(trimmedPosition)
            }
        }

        return details.joined(separator: " · ")
    }
}
