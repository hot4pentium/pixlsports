import SwiftUI

struct NativeWeeklyWelcomeView: View {
    let onContinue: () -> Void

    var body: some View {
        ZStack {
            NativePageBackground()

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("Your week, guided.")
                        .font(.largeTitle.weight(.black))
                        .fontDesign(.rounded)
                        .foregroundStyle(SupporterHomeColors.background)
                        .accessibilityAddTraits(.isHeader)

                    VStack(alignment: .leading, spacing: 10) {
                        Label("Watch the Message Board", systemImage: "bubble.left.and.text.bubble.right.fill")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(.white)
                        Text("Keep an eye on the Message Board on your dashboard throughout the week. It highlights what to do next before, during, and after your event.")
                            .font(.body)
                            .foregroundStyle(SupporterHomeColors.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
                    .supporterSurfaceShadow()
                    .accessibilityElement(children: .combine)

                    Text("Here’s what to expect")
                        .font(.headline)
                        .foregroundStyle(SupporterHomeColors.background)
                        .accessibilityAddTraits(.isHeader)

                    step(
                        number: 1,
                        title: "Prep",
                        timing: "Before the event",
                        detail: "Get your gear ready, check off tasks, and keep your event notes together.",
                        color: .orange
                    )
                    step(
                        number: 2,
                        title: "Track Stats",
                        timing: "At the event",
                        detail: "Choose Stat Tracker to record the action, or Live Taps to cheer with fans.",
                        color: .cyan
                    )
                    step(
                        number: 3,
                        title: "Share",
                        timing: "After the event",
                        detail: "Share event details and celebrate your athlete. You choose what to share and when.",
                        color: .green
                    )
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(20)
                .frame(maxWidth: .infinity)
            }
        }
        .safeAreaInset(edge: .bottom) {
            Button(action: onContinue) {
                Text("Got it")
                    .font(.headline)
                    .foregroundStyle(SupporterHomeColors.background)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 16))
            }
            .accessibilityIdentifier("native-weekly-welcome-continue")
            .frame(maxWidth: 560)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial)
        }
        .accessibilityIdentifier("native-weekly-welcome")
    }

    private func step(
        number: Int,
        title: String,
        timing: String,
        detail: String,
        color: Color
    ) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(number)")
                .font(.title3.weight(.black))
                .foregroundStyle(SupporterHomeColors.background)
                .frame(width: 36, height: 36)
                .background(color, in: Circle())

            VStack(alignment: .leading, spacing: 5) {
                Text(timing)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.muted)
                Text(title)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(.white)
                Text(detail)
                    .font(.body)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(color.opacity(0.45), lineWidth: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(number), \(title). \(timing). \(detail)")
    }
}
