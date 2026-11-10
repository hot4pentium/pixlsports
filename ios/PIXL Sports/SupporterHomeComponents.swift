import SwiftUI

/// A readable PIXL blue for native controls on light system surfaces.
/// Leave menu geometry, destructive colors, and presentation to iOS.
enum NativeMenuAppearance {
    static let actionTint = Color(red: 0.12, green: 0.34, blue: 0.70)
}

/// Shared presentation helpers for the native supporter schedule screen.
/// Pure SwiftUI; no data loading or navigation lives here.

enum NativeEventToolColors {
    static let prep = Color(red: 1.0, green: 0.56, blue: 0.22)
    static let trackStats = Color(red: 0.38, green: 0.75, blue: 1.0)
    static let share = SupporterHomeColors.accent

    static func color(for step: NativeEventDetailStep) -> Color {
        switch step {
        case .prep: return prep
        case .trackStats: return trackStats
        case .share: return share
        }
    }
}

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

/// Backplates extend into the page gutter without narrowing card grids.
struct SupporterDashboardSectionSurface: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.vertical, 16)
            .background {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Color(red: 0.10, green: 0.20, blue: 0.34), SupporterHomeColors.panel],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .overlay {
                        RoundedRectangle(cornerRadius: 24, style: .continuous)
                            .strokeBorder(SupporterHomeColors.blue.opacity(0.38), lineWidth: 1)
                    }
                    .shadow(color: SupporterHomeColors.background.opacity(0.18), radius: 13, x: 0, y: 6)
                    .padding(.horizontal, -12)
            }
    }
}

struct NativePageBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.white, Color(red: 0.95, green: 0.97, blue: 0.99)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [SupporterHomeColors.blue.opacity(0.055), .clear],
                center: .topTrailing,
                startRadius: 8,
                endRadius: 440
            )
            Canvas { context, size in
                var grid = Path()
                for x in stride(from: CGFloat.zero, through: size.width, by: CGFloat(36)) {
                    grid.move(to: CGPoint(x: x, y: 0))
                    grid.addLine(to: CGPoint(x: x, y: size.height))
                }
                for y in stride(from: CGFloat.zero, through: size.height, by: CGFloat(36)) {
                    grid.move(to: CGPoint(x: 0, y: y))
                    grid.addLine(to: CGPoint(x: size.width, y: y))
                }
                context.stroke(grid, with: .color(SupporterHomeColors.background.opacity(0.035)), lineWidth: 0.5)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
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
            .shadow(color: SupporterHomeColors.background.opacity(0.18), radius: 13, x: 0, y: 6)
    }
}

extension View {
    func supporterSurfaceShadow() -> some View {
        shadow(color: SupporterHomeColors.background.opacity(0.18), radius: 12, x: 0, y: 6)
    }
}

struct SupporterPrimaryButtonStyle: ButtonStyle {
    var fillColor: Color = SupporterHomeColors.accent
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.bold))
            .foregroundStyle(SupporterHomeColors.background)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(minHeight: 44)
            .background(fillColor, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
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

/// Pad the label itself so the native toolbar container includes breathing room.
private struct NativeToolbarLabelModifier: ViewModifier {
    let iconOnly: Bool

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, iconOnly ? 10 : 14)
            .padding(.vertical, 6)
            .frame(minWidth: iconOnly ? 44 : 68, minHeight: 44)
            .fixedSize(horizontal: true, vertical: false)
            .contentShape(Rectangle())
    }
}

extension View {
    func nativeToolbarLabel(iconOnly: Bool = false) -> some View {
        modifier(NativeToolbarLabelModifier(iconOnly: iconOnly))
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
