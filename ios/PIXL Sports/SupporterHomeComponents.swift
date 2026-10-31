import SwiftUI

/// Shared presentation helpers for the native supporter schedule screen.
/// Pure SwiftUI; no data loading or navigation lives here.

struct SupporterEyebrow: View {
    let text: String
    var color: Color = SupporterHomeColors.accent

    var body: some View {
        Text(text)
            .font(.caption.weight(.black))
            .tracking(1.6)
            .textCase(.uppercase)
            .foregroundStyle(color)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct SupporterSectionHeader: View {
    let eyebrow: String
    let title: String
    var trailing: String? = nil
    var trailingColor: Color = SupporterHomeColors.accent
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
            : AnyLayout(HStackLayout(alignment: .lastTextBaseline, spacing: 12))
        layout {
            VStack(alignment: .leading, spacing: 4) {
                SupporterEyebrow(text: eyebrow, color: SupporterHomeColors.muted)
                Text(title)
                    .font(.title2.weight(.black))
                    .fontDesign(.rounded)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            if !dynamicTypeSize.isAccessibilitySize { Spacer(minLength: 0) }
            if let trailing {
                Text(trailing)
                    .font(.caption2.weight(.black))
                    .tracking(1.1)
                    .foregroundStyle(trailingColor)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(trailingColor.opacity(0.12), in: Capsule())
            }
        }
    }
}

/// Chevron-shaped step used in the connected week path.
struct SupporterChevronShape: Shape {
    var isFirst: Bool

    func path(in rect: CGRect) -> Path {
        let notch = min(rect.height * 0.32, 12)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - notch, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX - notch, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        if !isFirst {
            path.addLine(to: CGPoint(x: rect.minX + notch, y: rect.midY))
        }
        path.closeSubpath()
        return path
    }
}

struct SupporterWeekStep: Identifiable {
    let id: String
    let weekday: String
    let day: String
    let month: String
    let accessibleDate: String
    let isCurrent: Bool
    let isLive: Bool
}

/// Connected chevron path showing the next few Event Cards. The first step gets the bright treatment.
struct SupporterWeekPath: View {
    let steps: [SupporterWeekStep]
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(steps) { step in
                    HStack(spacing: 10) {
                        Circle()
                            .fill(step.isCurrent ? SupporterHomeColors.accent : SupporterHomeColors.blue.opacity(0.6))
                            .frame(width: 10, height: 10)
                        Text("\(step.accessibleDate)\(step.isLive ? ", live" : "")")
                            .font(.headline)
                            .foregroundStyle(step.isCurrent ? SupporterHomeColors.accent : .white.opacity(0.85))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        } else {
            HStack(spacing: -4) {
                ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                    VStack(spacing: 1) {
                        Text(step.isLive ? "LIVE" : step.weekday)
                            .font(.caption2.weight(.black))
                            .tracking(0.8)
                        Text(step.day)
                            .font(.headline.weight(.black))
                            .fontDesign(.rounded)
                            .monospacedDigit()
                        Text(step.month)
                            .font(.caption2.weight(.semibold))
                    }
                    .minimumScaleFactor(0.8)
                    .lineLimit(1)
                    .foregroundStyle(step.isCurrent ? SupporterHomeColors.background : .white.opacity(0.82))
                    .frame(maxWidth: .infinity, minHeight: 48)
                    .padding(.leading, index == 0 ? 0 : 8)
                    .background {
                        SupporterChevronShape(isFirst: index == 0)
                            .fill(
                                step.isCurrent
                                    ? AnyShapeStyle(LinearGradient(
                                        colors: [SupporterHomeColors.accent, Color(red: 0.88, green: 0.98, blue: 0.48)],
                                        startPoint: .leading, endPoint: .trailing))
                                    : AnyShapeStyle(LinearGradient(
                                        colors: [SupporterHomeColors.blue.opacity(0.38 - Double(index) * 0.06), SupporterHomeColors.panel],
                                        startPoint: .leading, endPoint: .trailing))
                            )
                    }
                    .zIndex(Double(steps.count - index))
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Upcoming Event Cards: " + steps.map { "\($0.accessibleDate)\($0.isLive ? " live" : "")" }.joined(separator: ", "))
        }
    }
}

struct SupporterCardBackground: View {
    var cornerRadius: CGFloat = 22
    var highlighted = false

    var body: some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(
                LinearGradient(
                    colors: highlighted
                        ? [Color(red: 0.10, green: 0.26, blue: 0.48), SupporterHomeColors.panel, Color(red: 0.045, green: 0.12, blue: 0.24)]
                        : [Color(red: 0.08, green: 0.17, blue: 0.30), SupporterHomeColors.panel],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(
                        highlighted
                            ? AnyShapeStyle(LinearGradient(
                                colors: [SupporterHomeColors.blue.opacity(0.8), .white.opacity(0.12), SupporterHomeColors.accent.opacity(0.6)],
                                startPoint: .topLeading, endPoint: .bottomTrailing))
                            : AnyShapeStyle(Color.white.opacity(0.1)),
                        lineWidth: 1
                    )
            }
    }
}

struct SupporterPrimaryButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.bold))
            .foregroundStyle(SupporterHomeColors.background)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: 44)
            .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .opacity(configuration.isPressed ? 0.82 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: configuration.isPressed)
    }
}

struct SupporterCardPressStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.985 : 1)
            .opacity(configuration.isPressed ? 0.9 : 1)
            .animation(reduceMotion ? nil : .snappy(duration: 0.18), value: configuration.isPressed)
    }
}

/// Skeleton placeholder block used while the schedule loads.
struct SupporterSkeletonBar: View {
    var width: CGFloat? = nil
    var height: CGFloat = 12
    @State private var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        RoundedRectangle(cornerRadius: height / 2)
            .fill(Color.white.opacity(pulse ? 0.14 : 0.07))
            .frame(maxWidth: width ?? .infinity)
            .frame(height: height)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
            }
    }
}
