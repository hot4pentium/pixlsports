import Foundation

// Run from the repository root on a Mac:
// swiftc -parse-as-library "ios/PIXL Sports/NativeClerkConfiguration.swift" \
//   ios/Tests/NativeClerkConfigurationChecks.swift -o /tmp/pixl-clerk-config-checks
// /tmp/pixl-clerk-config-checks
//
// All keys below are fabricated fixture values, never real Clerk credentials.
@main
struct NativeClerkConfigurationChecks {
    static func main() throws {
        let encoded = Data("native-fixture.example.com$".utf8).base64EncodedString()
        let developmentKey = "pk_test_" + encoded
        let productionKey = "pk_live_" + encoded

        try expectSuccess(["PublishableKey": developmentKey], key: developmentKey)
        try expectSuccess(["PublishableKey": productionKey], key: productionKey)
        try expectSuccess(
            ["PublishableKey": " \n\(developmentKey)\n "],
            key: developmentKey
        )
        try expectFailure([:], .missingPublishableKey)
        try expectFailure(["PublishableKey": ""], .missingPublishableKey)
        try expectFailure(["PublishableKey": "  \n "], .missingPublishableKey)
        try expectFailure(["PublishableKey": 42], .missingPublishableKey)
        try expectFailure(["PublishableKey": "sk_test_fabricated"], .invalidPublishableKey)
        try expectFailure(["PublishableKey": "sk_live_fabricated"], .invalidPublishableKey)
        try expectFailure(["PublishableKey": "pk_test_!invalid!"], .invalidPublishableKey)
        try expectFailure(["PublishableKey": "pk_test_"], .invalidPublishableKey)
        for host in ["localhost$", "bad..host$", "native.example.com/path$",
                     "https://native.example.com$", ".native.example.com$",
                     "native.example.com", "$"] {
            let key = "pk_test_" + Data(host.utf8).base64EncodedString()
            try expectFailure(["PublishableKey": key], .invalidPublishableKey)
        }
        expectError(NativeClerkConfiguration.parse(Data([0xFF, 0xFE, 0xFD])), .invalidFile)
        let arrayPlist = try PropertyListSerialization.data(
            fromPropertyList: ["not", "a", "dictionary"], format: .xml, options: 0
        )
        expectError(NativeClerkConfiguration.parse(arrayPlist), .invalidFile)
        print("Native Clerk configuration checks passed.")
    }

    private static func data(_ value: [String: Any]) throws -> Data {
        try PropertyListSerialization.data(fromPropertyList: value, format: .xml, options: 0)
    }

    private static func expectSuccess(_ value: [String: Any], key: String) throws {
        switch NativeClerkConfiguration.parse(try data(value)) {
        case let .success(config):
            precondition(config.publishableKey == key, "Expected normalized publishable key")
        case .failure:
            fatalError("Expected valid fixture configuration")
        }
    }

    private static func expectFailure(
        _ value: [String: Any],
        _ expected: NativeClerkConfiguration.ConfigurationError
    ) throws {
        expectError(NativeClerkConfiguration.parse(try data(value)), expected)
    }

    private static func expectError(
        _ result: Result<NativeClerkConfiguration, NativeClerkConfiguration.ConfigurationError>,
        _ expected: NativeClerkConfiguration.ConfigurationError
    ) {
        switch result {
        case .success:
            fatalError("Expected configuration error")
        case let .failure(error):
            precondition(error == expected, "Unexpected configuration error category")
        }
    }
}
