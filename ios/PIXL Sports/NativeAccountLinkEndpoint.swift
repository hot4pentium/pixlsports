import Foundation

/// Foundation-only configuration and safe diagnostics; never reads Clerk keys.
struct NativeAccountLinkEndpoint {
    enum ConfigurationError: LocalizedError, Equatable {
        case missingFile
        case invalidFile
        case missingDevelopmentOrigin
        case invalidOrigin

        var errorDescription: String? {
            switch self {
            case .missingFile:
                return "ClerkConfig.plist is missing from the installed app. Check target membership and rebuild."
            case .invalidFile:
                return "The installed ClerkConfig.plist is not a readable dictionary."
            case .missingDevelopmentOrigin:
                return "The installed app has no development API address. Add AccountLinkAPIOrigin as a String in ClerkConfig.plist, save, and rebuild. Development will not fall back to the published website."
            case .invalidOrigin:
                return "AccountLinkAPIOrigin must be a String containing only an HTTPS website origin, without a path, query, or credentials."
            }
        }
    }

    static func load(bundle: Bundle = .main) throws -> URL {
        guard let file = bundle.url(forResource: "ClerkConfig", withExtension: "plist") else {
            throw ConfigurationError.missingFile
        }
        guard let data = try? Data(contentsOf: file) else {
            throw ConfigurationError.invalidFile
        }
#if DEBUG
        return try parse(data, requireExplicitOrigin: true)
#else
        return try parse(data, requireExplicitOrigin: false)
#endif
    }

    static func parse(_ data: Data, requireExplicitOrigin: Bool) throws -> URL {
        guard let value = try? PropertyListSerialization.propertyList(from: data, options: [], format: nil),
              let properties = value as? [String: Any] else {
            throw ConfigurationError.invalidFile
        }
        let origin: String
        if let value = properties["AccountLinkAPIOrigin"] {
            guard let string = value as? String else { throw ConfigurationError.invalidOrigin }
            origin = string.trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            origin = ""
        }
        if origin.isEmpty && requireExplicitOrigin { throw ConfigurationError.missingDevelopmentOrigin }
        let configured = origin.isEmpty ? "https://pixlsports.com" : origin
        guard var components = URLComponents(string: configured),
              components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.port == nil || components.port == 443,
              components.path.isEmpty || components.path == "/" else {
            throw ConfigurationError.invalidOrigin
        }
        components.scheme = "https"
        components.path = ""
        components.port = nil
        guard let url = components.url else { throw ConfigurationError.invalidOrigin }
        return url
    }

    static func responseFailure(status: Int, contentType: String?, origin: URL) -> String {
        let host = origin.host ?? "the configured server"
        if (300...399).contains(status) {
            return "\(host) redirected the connection (HTTP \(status)). Redirects are blocked to protect your sign-in. Check the API address."
        }
        if status == 404 {
            return "The account-linking API was not found on \(host) (HTTP 404). Check that this is the development server, not the published website."
        }
        let page = contentType?.lowercased().contains("text/html") == true
            ? " The server returned a web page instead of an API response." : ""
        return "Account linking failed on \(host) (HTTP \(status)).\(page)"
    }
}
