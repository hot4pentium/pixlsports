import Foundation

enum NativeHypeCardUniversalLink {
    private static let inviteTokenPattern = "^[A-Za-z0-9_-]{1,128}$"

    static func inviteToken(from url: URL, allowedOrigin: URL) -> String? {
        guard allowedOrigin.scheme?.lowercased() == "https",
              let allowedHost = allowedOrigin.host?.lowercased(),
              allowedOrigin.user == nil,
              allowedOrigin.password == nil,
              allowedOrigin.query == nil,
              allowedOrigin.fragment == nil,
              allowedOrigin.path.isEmpty || allowedOrigin.path == "/",
              allowedOrigin.port == nil || allowedOrigin.port == 443,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme?.lowercased() == "https",
              components.host?.lowercased() == allowedHost,
              components.user == nil,
              components.password == nil,
              components.fragment == nil,
              components.port == nil || components.port == 443 else {
            return nil
        }

        // Tokens are URL-safe ASCII. Matching the encoded path prevents an
        // escaped slash or other encoded character from changing route shape.
        let pathParts = components.percentEncodedPath.split(
            separator: "/",
            omittingEmptySubsequences: false
        )
        guard pathParts.count == 3,
              pathParts[0].isEmpty,
              pathParts[1] == "fan" else {
            return nil
        }

        let token = String(pathParts[2])
        guard token.range(of: inviteTokenPattern, options: .regularExpression) != nil else {
            return nil
        }
        return token
    }
}
