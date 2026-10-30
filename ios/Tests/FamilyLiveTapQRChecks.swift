import Foundation

@main
struct FamilyLiveTapQRChecks {
    static func main() {
        let invite = "A1b2C3d4_E5f6G7h8I9j0K1l2"
        let token = String(repeating: "familyToken_", count: 4)
        let origin = URL(string: "https://pixlsports.com")!

        precondition(
            FamilyLiveTapQR.accessToken(
                from: "https://pixlsports.com/fan/\(invite)#live-taps=\(token)",
                inviteToken: invite,
                apiOrigin: origin
            ) == token
        )
        precondition(FamilyLiveTapQR.accessToken(
            from: "https://pixlsports.com/fan/anotherInvite#live-taps=\(token)",
            inviteToken: invite,
            apiOrigin: origin
        ) == nil)
        precondition(FamilyLiveTapQR.accessToken(
            from: "https://untrusted.example/fan/\(invite)#live-taps=\(token)",
            inviteToken: invite,
            apiOrigin: origin
        ) == nil)
        precondition(FamilyLiveTapQR.accessToken(
            from: "https://pixlsports.com/fan/\(invite)?live-taps=\(token)",
            inviteToken: invite,
            apiOrigin: origin
        ) == nil)
        precondition(FamilyLiveTapQR.accessToken(
            from: "https://pixlsports.com/fan/\(invite)#live-taps=short",
            inviteToken: invite,
            apiOrigin: origin
        ) == nil)
    }
}
