import Foundation

enum FamilyLiveTapQR {
    static func accessToken(
        from rawValue: String,
        inviteToken: String,
        apiOrigin: URL
    ) -> String? {
        guard let url = URLComponents(string: rawValue),
              url.scheme?.lowercased() == "https",
              let host = url.host?.lowercased(),
              url.user == nil,
              url.password == nil,
              url.query == nil else { return nil }

        let allowedHosts = Set([
            apiOrigin.host?.lowercased(),
            "pixlsports.com",
            "www.pixlsports.com",
        ].compactMap { $0 })
        guard allowedHosts.contains(host) else { return nil }

        let pathParts = url.path.split(separator: "/").map(String.init)
        guard pathParts.count >= 2,
              pathParts[pathParts.count - 2] == "fan",
              pathParts.last == inviteToken,
              let fragment = url.fragment,
              let fragmentQuery = URLComponents(string: "?\(fragment)"),
              let token = fragmentQuery.queryItems?.first(where: { $0.name == "live-taps" })?.value,
              token.range(of: "^[A-Za-z0-9_-]{40,100}$", options: .regularExpression) != nil else {
            return nil
        }
        return token
    }
}
