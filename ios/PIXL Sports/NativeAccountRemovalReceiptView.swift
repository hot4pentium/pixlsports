import SwiftUI

struct NativeAccountRemovalReceiptView: View {
    let scope: String
    let onContinue: () -> Void

    private var independent: Bool { scope == "independent" }

    var body: some View {
        ZStack {
            NativePageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Image(systemName: "checkmark.shield.fill")
                        .font(.system(size: 48, weight: .semibold))
                        .foregroundStyle(SupporterHomeColors.blue)
                        .accessibilityHidden(true)
                    Text(independent ? "Deletion request received" : "iPhone removal request received")
                        .font(.largeTitle.weight(.bold))
                        .foregroundStyle(SupporterHomeColors.background)
                        .accessibilityAddTraits(.isHeader)

                    VStack(alignment: .leading, spacing: 16) {
                        Text("You’re signed out. Account access is blocked.")
                            .font(.title3.weight(.bold))
                            .foregroundStyle(.white)
                        Text("Your request has been accepted. Cleanup may continue in the background. This receipt does not mean that permanent cleanup has finished.")
                            .foregroundStyle(SupporterHomeColors.muted)
                        Text("If your iPhone sign-in has a verified email address, we send a confirmation there once cleanup is complete.")
                            .foregroundStyle(.white)
                        Text("Wait for that email before signing up again with the same address.")
                            .foregroundStyle(SupporterHomeColors.muted)
                        Text("Need help? Contact support@pixlsports.com.")
                            .foregroundStyle(SupporterHomeColors.muted)
                        if !independent {
                            Text("Your linked web/PWA account and its data remain unchanged.")
                                .foregroundStyle(.white)
                        }
                    }
                    .font(.body)
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
                    .supporterSurfaceShadow()

                    Button(action: onContinue) {
                        Text("Back to sign in")
                            .font(.headline)
                            .foregroundStyle(SupporterHomeColors.background)
                            .padding(.vertical, 16)
                            .frame(maxWidth: .infinity)
                            .background(SupporterHomeColors.accent, in: RoundedRectangle(cornerRadius: 16))
                    }
                    .accessibilityIdentifier("native-account-removal-receipt-continue")
                }
                .frame(maxWidth: 560, alignment: .leading)
                .padding(24)
                .frame(maxWidth: .infinity)
            }
        }
        .accessibilityIdentifier("native-account-removal-receipt")
    }
}
