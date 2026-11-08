import SwiftUI

struct NativeEventStepBar: View {
    let recommended: NativeEventDetailStep
    let selected: NativeEventDetailStep
    let isGame: Bool
    let isComplete: Bool
    let actionsEnabled: Bool
    let onSelect: (NativeEventDetailStep) -> Void
    var trackingAccess: NativeEventTrackingAccess = .available
    var trackingTimeZone: TimeZone = .current

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Next: \(recommended.title)")
                .font(.caption.weight(.bold))
                .foregroundStyle(NativeEventToolColors.color(for: recommended))
                .accessibilityIdentifier("event-detail-recommended-step")
            HStack(alignment: .top, spacing: 8) {
                Button {
                    onSelect(.prep)
                } label: {
                    stepLabel(.prep)
                }
                .accessibilityIdentifier("event-card-prep")
                Button {
                    guard isGame, !isComplete, trackingAccess.isAllowed else { return }
                    onSelect(.trackStats)
                } label: {
                    stepLabel(.trackStats)
                }
                .disabled(!isGame || isComplete || !trackingAccess.isAllowed)
                .opacity(isComplete || !trackingAccess.isAllowed ? 0.45 : 1)
                .accessibilityHint(isComplete
                    ? "This game is complete. Use Share for postgame actions."
                    : isGame ? trackingAccess.message(timeZone: trackingTimeZone) : "Stat tracking is available for games, not practices.")
                .accessibilityIdentifier("event-card-track-stats")
                Button {
                    onSelect(.share)
                } label: {
                    stepLabel(.share)
                }
                .accessibilityIdentifier("event-card-share")
            }
            .disabled(!actionsEnabled)
            .buttonStyle(.plain)
            if isGame, !isComplete, !trackingAccess.isAllowed {
                Text(trackingAccess.message(timeZone: trackingTimeZone))
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.8))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("event-tracking-locked-message")
            }
        }
        .frame(maxWidth: 560)
        .padding(.horizontal, 18)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .background(SupporterHomeColors.background.opacity(0.98))
        .overlay(alignment: .top) {
            Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("event-detail-step-bar")
    }

    private func stepLabel(_ step: NativeEventDetailStep) -> some View {
        let isRecommended = step == recommended
        let isSelected = step == selected
        let toolColor = NativeEventToolColors.color(for: step)
        return VStack(spacing: 5) {
            Image(systemName: step.icon)
                .font(.subheadline.weight(.bold))
            Text(step.title)
                .font(.caption.weight(.bold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 64)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .foregroundStyle(isSelected ? SupporterHomeColors.background : .white)
        .background(
            toolColor.opacity(isSelected ? 1 : isRecommended ? 0.22 : 0.06),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    isSelected ? Color.white.opacity(0.45) : isRecommended ? toolColor : toolColor.opacity(0.24),
                    lineWidth: 1
                )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(step.title)
        .accessibilityValue(step == recommended ? "Recommended next step" : "")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
