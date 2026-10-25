import Foundation
import Observation
import CryptoKit
import Security
import ClerkKit

@MainActor @Observable
final class NativeAccountLinkModel {
    private(set) var state: NativeAccountLinkState?
    private(set) var busy = false
    private(set) var error: String?
    private(set) var userCode: String?
    private(set) var verificationURL: URL?
    private var requestId: String?
    private var verifier: String?
    private let client = NativeAccountLinkClient()
    private var generation = 0

    var hasAttempt: Bool { requestId != nil }
    var waiting: Bool { state?.status == "pending" }
    var approved: Bool { state?.status == "approved" }
    var linked: Bool { state?.status == "linked" || state?.status == "completed" }
    var finished: Bool { ["expired", "denied", "cancelled"].contains(state?.status ?? "") }

    func refresh(clerk: Clerk) async {
        guard !busy else { return }
        let startingGeneration = generation
        do {
            let result: NativeAccountLinkState
            if let requestId, let verifier, !finished, !linked {
                result = try await client.request("/requests/status", method: "POST",
                    body: ["requestId": requestId, "codeVerifier": verifier], clerk: clerk)
            } else {
                result = try await client.request(clerk: clerk)
            }
            guard !Task.isCancelled, !busy, generation == startingGeneration else { return }
            // Keep an expired/denied reason visible until the parent starts again.
            if !finished || result.status == "linked" { state = result }
            if linked { clearAttempt() }
            error = nil
        } catch is CancellationError {
        } catch {
            if !Task.isCancelled, !busy, generation == startingGeneration { self.error = error.localizedDescription }
        }
    }

    func begin(clerk: Clerk) async {
        guard !busy else { return }
        busy = true
        generation += 1
        error = nil
        defer { busy = false }
        do {
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
                throw NativeAccountLinkError.message("A secure linking attempt could not be created.")
            }
            let proof = Self.base64URL(Data(bytes))
            let challenge = Self.base64URL(Data(SHA256.hash(data: Data(proof.utf8))))
            let result = try await client.request("/requests", method: "POST",
                body: ["codeChallenge": challenge], clerk: clerk)
            if result.status == "linked" {
                clearAttempt()
                state = result
                return
            }
            guard let id = result.requestId, let code = result.userCode,
                  let address = result.verificationUrl, let url = URL(string: address),
                  let expected = try? NativeAccountLinkClient.apiOrigin(),
                  url.scheme == expected.scheme, url.host == expected.host,
                  (url.port ?? 443) == (expected.port ?? 443), url.path == "/connect/iphone",
                  url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else {
                throw NativeAccountLinkError.message("The account-link website could not be verified.")
            }
            // Verifier and request code stay in memory, never URLs, UserDefaults,
            // analytics, logs, or the public athlete-page-link storage.
            verifier = proof
            requestId = id
            userCode = code
            verificationURL = url
            state = result
        } catch { self.error = error.localizedDescription }
    }

    func confirm(clerk: Clerk) async {
        guard approved else { return }
        await perform("/requests/complete", clerk: clerk)
    }

    func cancel(clerk: Clerk) async {
        await perform("/requests/cancel", clerk: clerk)
    }

    func disconnect(clerk: Clerk) async {
        guard !busy else { return }
        busy = true
        generation += 1
        error = nil
        defer { busy = false }
        do {
            state = try await client.request(method: "DELETE", clerk: clerk)
            clearAttempt()
        } catch { self.error = error.localizedDescription }
    }

    private func perform(_ endpoint: String, clerk: Clerk) async {
        guard !busy, let requestId, let verifier else { return }
        busy = true
        generation += 1
        error = nil
        defer { busy = false }
        do {
            state = try await client.request(endpoint, method: "POST",
                body: ["requestId": requestId, "codeVerifier": verifier], clerk: clerk)
            if linked { clearAttempt() }
        } catch { self.error = error.localizedDescription }
    }

    private func clearAttempt() {
        requestId = nil
        verifier = nil
        userCode = nil
        verificationURL = nil
    }

    private static func base64URL(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
