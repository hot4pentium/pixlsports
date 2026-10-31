import SwiftUI

struct NativeEventGridTile: View {
    let event: AthleteFanEvent
    let timezone: String?

    private var isComplete: Bool { event.status == "final" }
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
                    HStack(spacing: 3) {
                        Circle().fill(isComplete ? Color.green : event.status == "live" ? Color.red : SupporterHomeColors.blue)
                            .frame(width: 4, height: 4)
                        Text(isComplete ? "COMPLETE" : event.status == "live" ? "LIVE" : "UP NEXT")
                            .font(.system(size: 7, weight: .heavy))
                            .tracking(0.5)
                    }
                    HStack(alignment: .firstTextBaseline, spacing: 4) {
                        Text(month).font(.system(size: 9, weight: .heavy))
                        Text(day).font(.system(size: 28, weight: .black, design: .rounded))
                    }
                    HStack(spacing: 3) {
                        Text(event.formattedTime(timezone: event.timezone ?? timezone))
                            .font(.system(size: 8, weight: .semibold))
                        Text(event.type == "practice" ? "PRACTICE" : "GAME")
                            .font(.system(size: 8, weight: .black))
                    }
                    .lineLimit(1)
                    Text(event.opponent.isEmpty ? event.title : "vs \(event.opponent)")
                        .font(.system(size: 9, weight: .semibold))
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
            .accessibilityLabel("\(event.title), \(event.type), \(event.formattedFullDate(timezone: event.timezone ?? timezone)), \(event.formattedTime(timezone: event.timezone ?? timezone)), \(event.location), \(isComplete ? "complete" : event.status)")
            .accessibilityHint("Opens event details, Prep, Track Stats, and sharing")
    }
}
