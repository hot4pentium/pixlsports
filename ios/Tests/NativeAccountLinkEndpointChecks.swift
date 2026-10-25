import Foundation

// Run on a Mac, without Clerk packages or network access:
// swiftc -parse-as-library "ios/PIXL Sports/NativeAccountLinkEndpoint.swift" \
//   ios/Tests/NativeAccountLinkEndpointChecks.swift -o /tmp/pixl-link-endpoint-checks
// /tmp/pixl-link-endpoint-checks
@main
struct NativeAccountLinkEndpointChecks {
    static func main() throws {
        let fixture = "https://native-api.example.com"
        for value in [fixture, fixture + "/", fixture + ":443", " \n" + fixture + "/\n "] {
            let url = try NativeAccountLinkEndpoint.parse(data(["AccountLinkAPIOrigin": value]), requireExplicitOrigin: true)
            precondition(url.absoluteString == fixture)
        }
        let missing: [[String: Any]] = [[:], ["AccountLinkAPIOrigin": ""], ["AccountLinkAPIOrigin": " \n "],
                                        ["AccountLinkApiOrigin": fixture]]
        for properties in missing {
            try expectFailure(properties, .missingDevelopmentOrigin)
        }
        let invalid: [Any] = [42, [fixture], "http://example.com", fixture + "/api",
                              fixture + "?key=value", fixture + "#fragment",
                              "https://user:password@example.com", fixture + ":444"]
        for value in invalid {
            try expectFailure(["AccountLinkAPIOrigin": value], .invalidOrigin)
        }
        let production = try NativeAccountLinkEndpoint.parse(data([:]), requireExplicitOrigin: false)
        precondition(production.absoluteString == "https://pixlsports.com")
        do {
            _ = try NativeAccountLinkEndpoint.parse(Data([0xff, 0xfe]), requireExplicitOrigin: true)
            fatalError("Invalid plist must fail")
        } catch let error as NativeAccountLinkEndpoint.ConfigurationError {
            precondition(error == .invalidFile)
        }
        let origin = URL(string: fixture)!
        let notFound = NativeAccountLinkEndpoint.responseFailure(status: 404, contentType: "text/html", origin: origin)
        precondition(notFound.contains("HTTP 404") && notFound.contains("native-api.example.com"))
        let redirect = NativeAccountLinkEndpoint.responseFailure(status: 302, contentType: nil, origin: origin)
        precondition(redirect.contains("HTTP 302") && redirect.contains("blocked"))
        let page = NativeAccountLinkEndpoint.responseFailure(status: 503, contentType: "text/html", origin: origin)
        precondition(page.contains("HTTP 503") && page.contains("web page"))
        print("Native account-link endpoint checks passed.")
    }

    private static func data(_ properties: [String: Any]) throws -> Data {
        try PropertyListSerialization.data(fromPropertyList: properties, format: .xml, options: 0)
    }

    private static func expectFailure(
        _ properties: [String: Any],
        _ expected: NativeAccountLinkEndpoint.ConfigurationError
    ) throws {
        do {
            _ = try NativeAccountLinkEndpoint.parse(data(properties), requireExplicitOrigin: true)
            fatalError("Expected explicit configuration failure")
        } catch let error as NativeAccountLinkEndpoint.ConfigurationError {
            precondition(error == expected)
        }
    }
}
