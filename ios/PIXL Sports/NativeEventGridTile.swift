import SwiftUI

struct NativeEventGridTile: View {
    let event: AthleteFanEvent
    let timezone: String?
    let timing: SupporterEventTiming
    let isUpNext: Bool

    private var isComplete: Bool { timing == .complete }
    private var statusLabel: String? {
        switch timing {
        case .complete: return "COMPLETE"
        case .live: return "LIVE"
        case .upcoming: return isUpNext ? "UP NEXT" : nil
        }
    }
    private var month: String {
        guard let number = Int(event.date.split(separator: "-").dropFirst().first ?? ""),
              (1...12).contains(number) else { return "EVENT" }
        return Calendar.current.shortMonthSymbols[number - 1].uppercased()
    }
    private var day: String {
        String(Int(event.date.split(separator: "-").last ?? "") ?? 0)
    }

    var body: some View {
        RoundedRectangle(cornerRadius: 15)
            .fill(LinearGradient(
                colors: [Color.white, Color(red: 0.86, green: 0.93, blue: 0.98)],
                startPoint: .topLeading, endPoint: .bottomTrailing
            ))
            .aspectRatio(1, contentMode: .fit)
            .overlay {
                VStack(spacing: 3) {
                    if let statusLabel {
                        HStack(spacing: 3) {
                            Circle().fill(isComplete ? Color.green : timing == .live ? Color.red : SupporterHomeColors.blue)
                                .frame(width: 5, height: 5)
                            Text(statusLabel)
                                .font(.system(size: 8, weight: .heavy))
                                .tracking(0.45)
                        }
                        .frame(height: 11)
                    } else {
                        // Keep dates aligned across the row without drawing a
                        // badge or status dot on later future cards.
                        Color.clear.frame(height: 11).accessibilityHidden(true)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(month).font(.system(size: 10, weight: .heavy))
                        Text(day).font(.system(size: 31, weight: .black, design: .rounded))
                    }
                    HStack(spacing: 3) {
                        Text(event.formattedTime(timezone: event.timezone ?? timezone))
                            .font(.system(size: 10, weight: .semibold))
                        Text(event.type == "practice" ? "PRACTICE" : "GAME")
                            .font(.system(size: 9, weight: .black))
                    }
                    .lineLimit(1)
                    Text(event.opponent.isEmpty ? event.title : "vs \(event.opponent)")
                        .font(.system(size: 11, weight: .bold))
                        .lineLimit(1)
                }
                .padding(7)
                .foregroundStyle(SupporterHomeColors.background)
                .minimumScaleFactor(0.75)
            }
            .overlay(alignment: .top) {
                Capsule().fill(isComplete ? Color.green : SupporterHomeColors.blue).frame(height: 3).padding(.horizontal, 10)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(event.title), \(event.type), \(event.formattedFullDate(timezone: event.timezone ?? timezone)), \(event.formattedTime(timezone: event.timezone ?? timezone)), \(event.location)\(statusLabel.map { ", \($0)" } ?? "")")
            .accessibilityHint("Opens event details, Prep, Track Stats, and sharing")
    }
}
