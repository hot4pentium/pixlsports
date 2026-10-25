import Foundation
import ClerkKit

struct NativeAccountLinkState: Decodable, Sendable {
    let status: String
    let requestId: String?
    let userCode: String?
    let expiresAt: String?
    let verificationUrl: String?
    let linkId: String?
    let accountLabel: String?
}

enum NativeAccountLinkError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case let .message(message) = self { return message }
        return nil
    }
}

// Never forward the native bearer token through an HTTP redirect.
private final class NativeLinkRedirectGuard: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    nonisolated func urlSession(
        _ session: URLSession, task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) { completionHandler(nil) }
}

@MainActor
final class NativeAccountLinkClient {
    private let session: URLSession

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 20
        session = URLSession(configuration: configuration, delegate: NativeLinkRedirectGuard(), delegateQueue: nil)
    }

    static func apiOrigin(bundle: Bundle = .main) throws -> URL {
        try NativeAccountLinkEndpoint.load(bundle: bundle)
    }

    func request(_ endpoint: String = "", method: String = "GET", body: [String: String]? = nil, clerk: Clerk) async throws -> NativeAccountLinkState {
        // Validate the installed app's destination before requesting a token.
        let origin = try Self.apiOrigin()
        guard clerk.isAuthFlowComplete, let token = try await clerk.session?.getToken() else {
            throw NativeAccountLinkError.message("Sign in to the iPhone app again.")
        }
        let url = origin.appendingPathComponent("api/native/link" + endpoint)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw NativeAccountLinkError.message("The account connection could not be checked.")
        }
        guard response.statusCode == 200 else {
            struct Failure: Decodable { let error: String }
            let message = (try? JSONDecoder().decode(Failure.self, from: data))?.error
            let detail = message.map { "\($0) (HTTP \(response.statusCode))" }
                ?? NativeAccountLinkEndpoint.responseFailure(
                    status: response.statusCode,
                    contentType: response.value(forHTTPHeaderField: "Content-Type"),
                    origin: origin
                )
            // Never show raw response bodies, redirect locations, or tokens.
            throw NativeAccountLinkError.message(detail)
        }
        do {
            return try JSONDecoder().decode(NativeAccountLinkState.self, from: data)
        } catch {
            throw NativeAccountLinkError.message("The server at \(origin.host ?? "the configured address") returned unreadable account-link data (HTTP 200).")
        }
    }
}
