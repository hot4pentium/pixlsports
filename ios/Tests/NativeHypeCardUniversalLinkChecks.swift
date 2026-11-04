import Foundation

// Run on a Mac, without Clerk packages or network access:
// swiftc -parse-as-library "ios/PIXL Sports/NativeHypeCardUniversalLink.swift" \
//   ios/Tests/NativeHypeCardUniversalLinkChecks.swift -o /tmp/pixl-hype-card-link-checks
// /tmp/pixl-hype-card-link-checks
@main
struct NativeHypeCardUniversalLinkChecks {
    static func main() {
        let origin = URL(string: "https://pixlsports.com")!
        expect("https://pixlsports.com/fan/card_123", origin, "card_123")
        expect("https://PIXLSPORTS.com/fan/card-abc?source=message", origin, "card-abc")
        for value in [
            "http://pixlsports.com/fan/card_123",
            "https://other.example/fan/card_123",
            "https://www.pixlsports.com/fan/card_123",
            "https://pixlsports.com:444/fan/card_123",
            "https://user@pixlsports.com/fan/card_123",
            "https://pixlsports.com/fan/card%2F123",
            "https://pixlsports.com/fan/card_123/extra",
            "https://pixlsports.com/other/card_123",
            "https://pixlsports.com/fan/",
            "https://pixlsports.com/fan/card_123#fragment"
        ] {
            precondition(
                NativeHypeCardUniversalLink.inviteToken(from: URL(string: value)!, allowedOrigin: origin) == nil,
                "Unexpectedly accepted \(value)"
            )
        }
        precondition(
            NativeHypeCardUniversalLink.inviteToken(
                from: URL(string: "https://pixlsports.com/fan/card_123")!,
                allowedOrigin: URL(string: "http://pixlsports.com")!
            ) == nil,
            "The configured origin must use HTTPS."
        )
        print("Native HYPE Card Universal Link checks passed.")
    }

    private static func expect(_ value: String, _ origin: URL, _ token: String) {
        precondition(
            NativeHypeCardUniversalLink.inviteToken(from: URL(string: value)!, allowedOrigin: origin) == token,
            "Expected \(value) to resolve to \(token)"
        )
    }
}
