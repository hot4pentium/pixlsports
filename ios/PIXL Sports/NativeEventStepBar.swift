import SwiftUI

struct NativeEventStepBar: View {
    let recommended: NativeEventDetailStep
    let selected: NativeEventDetailStep
    let isGame: Bool
    let actionsEnabled: Bool
    let onSelect: (NativeEventDetailStep) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Next: \(recommended.title)")
                .font(.caption.weight(.bold))
                .foregroundStyle(SupporterHomeColors.accent)
                .accessibilityIdentifier("event-detail-recommended-step")
            HStack(alignment: .top, spacing: 8) {
                Button {
                    onSelect(.prep)
                } label: {
                    stepLabel(.prep)
                }
                .accessibilityIdentifier("event-card-prep")
                Button {
                    onSelect(.trackStats)
                } label: {
                    stepLabel(.trackStats)
                }
                .disabled(!isGame)
                .opacity(isGame ? 1 : 0.45)
                .accessibilityHint(isGame ? "Open this game's statistics." : "Stat tracking is available for games, not practices.")
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
        return VStack(spacing: 5) {
            HStack(spacing: 5) {
                Text("\(step.number)")
                    .font(.caption2.weight(.black))
                Image(systemName: step.icon)
                    .font(.caption.weight(.bold))
            }
            Text(step.title)
                .font(.caption.weight(.bold))
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, minHeight: 64)
        .padding(.vertical, 4)
        .contentShape(Rectangle())
        .foregroundStyle(isRecommended ? SupporterHomeColors.background : .white)
        .background(
            isRecommended
                ? SupporterHomeColors.accent
                : isSelected
                    ? SupporterHomeColors.blue.opacity(0.42)
                    : Color.white.opacity(0.055),
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    isRecommended ? Color.clear : isSelected ? SupporterHomeColors.blue.opacity(0.95) : Color.white.opacity(0.12),
                    lineWidth: 1
                )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(step.title)
        .accessibilityValue(step == recommended ? "Recommended next step" : "")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
