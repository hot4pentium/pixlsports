import Foundation

/// The iOS app uses its own external Clerk application, never the PWA's keys.
struct NativeClerkConfiguration {
    let publishableKey: String

    enum ConfigurationError: LocalizedError, Equatable {
        case missingFile
        case invalidFile
        case missingPublishableKey
        case invalidPublishableKey

        var errorDescription: String? {
            switch self {
            case .missingFile:
                return "Add ClerkConfig.plist to the PIXL Sports app target, then rebuild."
            case .invalidFile:
                return "ClerkConfig.plist could not be read. Restore the property-list file and rebuild."
            case .missingPublishableKey:
                return "Set PublishableKey in ClerkConfig.plist to the publishable key from PIXL Sports iOS, then rebuild."
            case .invalidPublishableKey:
                return "Use a valid pk_test_ or pk_live_ publishable key from PIXL Sports iOS. Never put a secret key in the app."
            }
        }
    }

    static func load(
        bundle: Bundle = .main
    ) -> Result<NativeClerkConfiguration, ConfigurationError> {
        guard let url = bundle.url(forResource: "ClerkConfig", withExtension: "plist") else {
            return .failure(.missingFile)
        }
        guard let data = try? Data(contentsOf: url) else {
            return .failure(.invalidFile)
        }
        return parse(data)
    }

    /// Kept independent of ClerkKit so configuration can be checked without SDK/network access.
    static func parse(_ data: Data) -> Result<NativeClerkConfiguration, ConfigurationError> {
        guard let value = try? PropertyListSerialization.propertyList(
            from: data, options: [], format: nil
        ), let properties = value as? [String: Any] else {
            return .failure(.invalidFile)
        }
        guard let rawKey = properties["PublishableKey"] as? String else {
            return .failure(.missingPublishableKey)
        }
        let key = rawKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else {
            return .failure(.missingPublishableKey)
        }
        guard key.hasPrefix("pk_test_") || key.hasPrefix("pk_live_") else {
            return .failure(.invalidPublishableKey)
        }

        // Clerk.configure asserts for malformed keys in debug builds. Reject them
        // first and show a recoverable setup message without logging the value.
        let encodedHost = String(key.dropFirst(8))
        let padding = String(repeating: "=", count: (4 - encodedHost.count % 4) % 4)
        guard let bytes = Data(base64Encoded: encodedHost + padding),
              let decoded = String(data: bytes, encoding: .utf8),
              decoded.hasSuffix("$") else {
            return .failure(.invalidPublishableKey)
        }
        let host = String(decoded.dropLast())
        guard host.contains("."), !host.contains(".."),
              host.range(
                of: #"^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$"#,
                options: .regularExpression
              ) != nil else {
            return .failure(.invalidPublishableKey)
        }
        return .success(NativeClerkConfiguration(publishableKey: key))
    }
}
