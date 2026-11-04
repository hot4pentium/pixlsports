import SwiftUI

struct NativePublicHypeCardRecipientView: View {
    let inviteToken: String
    let onClose: () -> Void

#if DEBUG
    private let fixtureCard: NativePublicHypeCard?

    init(inviteToken: String, onClose: @escaping () -> Void) {
        self.inviteToken = inviteToken
        self.onClose = onClose
        self.fixtureCard = nil
    }

    init(fixtureCard: NativePublicHypeCard, onClose: @escaping () -> Void) {
        self.inviteToken = fixtureCard.inviteToken ?? "ui-test-shared-card"
        self.onClose = onClose
        self.fixtureCard = fixtureCard
    }
#else
    init(inviteToken: String, onClose: @escaping () -> Void) {
        self.inviteToken = inviteToken
        self.onClose = onClose
    }
#endif

    var body: some View {
        NavigationStack {
            recipientCard
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Done", action: onClose)
                        .tint(.black)
                        .accessibilityIdentifier("native-public-hype-card-done")
                    }
                }
        }
        .preferredColorScheme(.light)
    }

    @ViewBuilder
    private var recipientCard: some View {
#if DEBUG
        if let fixtureCard {
            SupporterHypeCardView(
                publicInviteToken: inviteToken,
                fixturePublicCard: fixtureCard
            )
        } else {
            SupporterHypeCardView(clerk: nil, publicInviteToken: inviteToken)
        }
#else
        SupporterHypeCardView(clerk: nil, publicInviteToken: inviteToken)
#endif
    }
}
