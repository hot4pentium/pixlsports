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

private struct NativeAccountLinkFailure: Decodable {
    let error: String
}

enum NativeAccountLinkError: LocalizedError {
    case message(String)
    case serverStatus(Int, String)

    var statusCode: Int? {
        guard case let .serverStatus(status, _) = self else { return nil }
        return status
    }

    var errorDescription: String? {
        switch self {
        case let .message(message), let .serverStatus(_, message):
            return message
        }
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
    private static let hypeCardSettingsDraftKey = "pending/hype-card-settings"
    private static let hypeCardSettingsSaveIntentKey = "pending/hype-card-settings-save"
    private static let hypeCardSettingsConfirmationKey = "pending/hype-card-settings-confirmation"

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 20
        session = URLSession(configuration: configuration, delegate: NativeLinkRedirectGuard(), delegateQueue: nil)
    }

    func saveHypeCardSettingsDraft(_ draft: NativeHypeCardSettings, subject: String) throws {
        let offline = NativeOfflineRuntime.shared
        guard offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        try offline.vault.write(JSONEncoder().encode(draft), key: Self.hypeCardSettingsDraftKey)
        offline.storageChanged()
    }

    func loadHypeCardSettingsDraft(subject: String) throws -> NativeHypeCardSettings? {
        let offline = NativeOfflineRuntime.shared
        guard offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        guard let data = try offline.vault.read(Self.hypeCardSettingsDraftKey, subject: subject) else {
            return nil
        }
        do {
            return try JSONDecoder().decode(NativeHypeCardSettings.self, from: data)
        } catch {
            throw NativeOfflineError.corrupt
        }
    }

    func clearHypeCardSettingsDraft(subject: String) throws {
        let offline = NativeOfflineRuntime.shared
        guard offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        try offline.vault.write(nil, key: Self.hypeCardSettingsDraftKey)
        offline.storageChanged()
    }

    func saveHypeCardSettingsSaveIntent(
        _ intent: NativeHypeCardSettingsSaveIntent,
        subject: String
    ) throws {
        let offline = NativeOfflineRuntime.shared
        guard offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        try offline.vault.write(JSONEncoder().encode(intent), key: Self.hypeCardSettingsSaveIntentKey)
        offline.storageChanged()
    }

    /// The save-intent record is written last so its presence means the owner
    /// explicitly committed the matching local draft for automatic sync.
    func queueHypeCardSettingsSave(
        _ intent: NativeHypeCardSettingsSaveIntent,
        draft: NativeHypeCardSettings,
        subject: String
    ) throws {
        guard intent.desired.hasSameSettings(as: draft),
              intent.base.revision?.isEmpty == false,
              !intent.confirmPublish || (intent.desired.showHypeCard && !intent.desired.paused) else {
            throw NativeOfflineError.protectedStorage
        }
        try saveHypeCardSettingsDraft(draft, subject: subject)
        try saveHypeCardSettingsSaveIntent(intent, subject: subject)
    }

    func loadHypeCardSettingsSaveIntent(subject: String) throws -> NativeHypeCardSettingsSaveIntent? {
        let offline = NativeOfflineRuntime.shared
        guard offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        guard let data = try offline.vault.read(Self.hypeCardSettingsSaveIntentKey, subject: subject) else {
            return nil
        }
        do {
            return try JSONDecoder().decode(NativeHypeCardSettingsSaveIntent.self, from: data)
        } catch {
            throw NativeOfflineError.corrupt
        }
    }

    func clearHypeCardSettingsSaveIntent(subject: String) throws {
        let offline = NativeOfflineRuntime.shared
        guard offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        try offline.vault.write(nil, key: Self.hypeCardSettingsSaveIntentKey)
        offline.storageChanged()
    }

    func markHypeCardSettingsConfirmationPending(
        _ settings: NativeHypeCardSettings,
        subject: String
    ) throws {
        let offline = NativeOfflineRuntime.shared
        guard offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        try offline.vault.write(JSONEncoder().encode(settings), key: Self.hypeCardSettingsConfirmationKey)
        offline.storageChanged()
    }

    func hasPendingHypeCardSettingsConfirmation(subject: String) throws -> Bool {
        let offline = NativeOfflineRuntime.shared
        guard offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        return try offline.vault.read(Self.hypeCardSettingsConfirmationKey, subject: subject) != nil
    }

    func loadPendingHypeCardSettingsConfirmation(subject: String) throws -> NativeHypeCardSettings? {
        let offline = NativeOfflineRuntime.shared
        guard offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        guard let data = try offline.vault.read(Self.hypeCardSettingsConfirmationKey, subject: subject) else {
            return nil
        }
        do {
            return try JSONDecoder().decode(NativeHypeCardSettings.self, from: data)
        } catch {
            throw NativeOfflineError.corrupt
        }
    }

    func clearHypeCardSettingsConfirmation(subject: String) throws {
        let offline = NativeOfflineRuntime.shared
        guard offline.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        try offline.vault.write(nil, key: Self.hypeCardSettingsConfirmationKey)
        offline.storageChanged()
    }

    private static func requestFailureMessage(for path: String, method: String) -> String {
        if path == "notifications/subscriptions" {
            return method == "DELETE"
                ? "Alerts couldn’t be turned off on this iPhone. Please try again."
                : "Alerts on this iPhone couldn’t be connected right now. Please try again."
        }
        if path.hasPrefix("notifications/") {
            return method == "GET"
                ? "Your alert settings couldn’t be loaded right now. Please try again."
                : "Your iPhone alerts couldn’t be updated right now. Please try again."
        }
        if path == "supporter/schedule" {
            return "Your Event Cards couldn’t be refreshed right now. Please try again."
        }
        if path == "supporter/hype-card", method != "GET" {
            return "We couldn’t confirm that your HYPE Card settings were saved. Please check and try again if needed."
        }
        if path == "supporter/hype-card" || path.hasPrefix("supporter/hype-card/") {
            return "Your HYPE Card details couldn’t be loaded right now. Please try again."
        }
        if path == "supporter/event-workspace-save" {
            return "This Event Card couldn’t be updated right now. Please try again."
        }
        if path == "supporter/event-workspace" {
            return "This Event Card couldn’t be opened right now. Please try again."
        }
        return "We couldn’t complete that request right now. Please try again."
    }

    static func apiOrigin(bundle: Bundle = .main) throws -> URL {
        try NativeAccountLinkEndpoint.load(bundle: bundle)
    }

    func checkAPIConnection(clerk: Clerk) async -> NativeAPIConnectionCheckResult {
        // Validate the installed destination before requesting a session token.
        let origin: URL
        do {
            origin = try Self.apiOrigin()
        } catch {
            return .unreachable
        }
        guard clerk.isAuthFlowComplete, let subject = clerk.user?.id else {
            return .signInRequired
        }

        let token: String
        do {
            guard let currentToken = try await clerk.session?.getToken() else {
                return .signInRequired
            }
            token = currentToken
        } catch {
            return .signInRequired
        }
        guard clerk.user?.id == subject else { return .signInRequired }

        let url = origin.appendingPathComponent("api")
            .appendingPathComponent("native")
            .appendingPathComponent("notifications")
            .appendingPathComponent("config")
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")

        let response: URLResponse
        do {
            let (_, receivedResponse) = try await session.data(for: request)
            response = receivedResponse
        } catch {
            return .unreachable
        }
        guard clerk.user?.id == subject, (try? Self.apiOrigin()) == origin else {
            return .signInRequired
        }
        guard let response = response as? HTTPURLResponse else {
            return .unreachable
        }
        if (200..<300).contains(response.statusCode) {
            return .connected
        }
        if response.statusCode == 401 {
            return .signInRequired
        }
        return .serverResponseError(statusCode: response.statusCode)
    }

    func getData(_ path: String, headers: [String: String] = [:], clerk: Clerk) async throws -> Data {
        let offline = NativeOfflineRuntime.shared
        let key = offline.cacheKey(path, headers: headers)
        if !offline.online || (!clerk.isLoaded && offline.canContinue) {
            guard let key, let data = try offline.saved(key, subject: clerk.user?.id) else {
                throw NativeOfflineError.notPrepared
            }
            return data
        }
        do { return try await networkGetData(path, headers: headers, clerk: clerk) }
        catch {
            let status = (error as? NativeAccountLinkError)?.statusCode
            if error is URLError || (status.map { $0 >= 500 } ?? false),
               let key, let saved = try? offline.saved(key, subject: clerk.user?.id) {
                return saved
            }
            throw error
        }
    }

    func getAuthoritativeData(
        _ path: String,
        headers: [String: String] = [:],
        apiRoot: Bool = false,
        clerk: Clerk
    ) async throws -> Data {
        try await networkGetData(path, headers: headers, apiRoot: apiRoot, clerk: clerk)
    }

    private func networkGetData(_ path: String, headers: [String: String], apiRoot: Bool = false, clerk: Clerk) async throws -> Data {
        let origin = try Self.apiOrigin()
        let requestScope = NativeOfflineVault.shared.namespace
        let profileRevision = NativeOfflineRuntime.shared.athleteProfileCacheRevision
        guard clerk.isAuthFlowComplete, let subject = clerk.user?.id,
              let token = try await clerk.session?.getToken() else {
            throw NativeAccountLinkError.message("Sign in to the iPhone app again.")
        }

        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !components.isEmpty,
              components.allSatisfy({
                  String($0).range(of: apiRoot ? "^[A-Za-z0-9_-]+$" : "^[a-z-]+$", options: .regularExpression) != nil
              }) else {
            throw NativeAccountLinkError.message("The PIXL Sports request could not be prepared.")
        }

        var url = origin.appendingPathComponent("api")
        if !apiRoot { url = url.appendingPathComponent("native") }
        for component in components {
            url = url.appendingPathComponent(String(component))
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalCacheData
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")
        let (data, response) = try await session.data(for: request)
        guard clerk.user?.id == subject, origin == (try Self.apiOrigin()),
              requestScope == NativeOfflineVault.shared.namespace else { throw NativeOfflineError.locked }
        guard let response = response as? HTTPURLResponse else {
            throw NativeAccountLinkError.message(Self.requestFailureMessage(for: path, method: "GET"))
        }
        guard response.statusCode == 200 else {
            NativeOfflineRuntime.shared.deny(status: response.statusCode, accountScope: path == "supporter/schedule")
            if let failure = try? JSONDecoder().decode(NativeAccountLinkFailure.self, from: data) {
                if response.statusCode < 500 {
                    throw NativeAccountLinkError.serverStatus(response.statusCode, failure.error)
                }
            }
            throw NativeAccountLinkError.serverStatus(
                response.statusCode,
                Self.requestFailureMessage(for: path, method: "GET")
            )
        }
        let offline = NativeOfflineRuntime.shared
        if path == "supporter/schedule" {
            let schedule = try JSONDecoder().decode(NativeSupporterSchedule.self, from: data)
            if schedule.status == "linked" {
                offline.verified(token: token, subject: subject, schedule: data)
            } else if schedule.status == "unlinked", offline.vault.subject == subject {
                try offline.clear()
            }
        } else if offline.vault.canContinue(subject: subject),
                  path != "supporter/profile" || profileRevision == offline.athleteProfileCacheRevision,
                  let key = offline.cacheKey(path, headers: headers) {
            offline.cache(data, key: key)
        }
        return data
    }

    func uploadAthletePhoto(
        _ contents: Data, cardID: String, revision: String, clerk: Clerk
    ) async throws -> Data {
        guard NativeOfflineRuntime.shared.online else { throw NativeOfflineError.onlineOnly }
        guard clerk.isAuthFlowComplete, let token = try await clerk.session?.getToken() else {
            throw NativeAccountLinkError.message("Sign in to the iPhone app again.")
        }
        var url = try Self.apiOrigin()
        for component in ["api", "native", "supporter", "hype-card", "athlete-photo"] {
            url.appendPathComponent(component)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.httpBody = contents
        request.timeoutInterval = 90
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(cardID, forHTTPHeaderField: "X-Hype-Card-ID")
        request.setValue(revision, forHTTPHeaderField: "X-Photo-Revision")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw NativeAccountLinkError.message("The athlete photo could not be saved.")
        }
        guard response.statusCode == 200 else {
            if let failure = try? JSONDecoder().decode(NativeAccountLinkFailure.self, from: data) {
                throw NativeAccountLinkError.serverStatus(response.statusCode, failure.error)
            }
            throw NativeAccountLinkError.serverStatus(
                response.statusCode,
                response.statusCode == 413
                    ? "Choose a photo smaller than 5 MB after preparation."
                    : "The athlete photo could not be saved. Please try again."
            )
        }
        return data
    }

    func postData<T: Encodable>(
        _ path: String,
        body: T,
        method: String = "POST",
        apiRoot: Bool = false,
        clerk: Clerk,
        allowCachedWorkspace: Bool = true,
        forceNetworkAttempt: Bool = false
    ) async throws -> Data {
        let offline = NativeOfflineRuntime.shared
        let encoded = try JSONEncoder().encode(body)
        let requestScope = offline.vault.namespace
        let requestSubject = clerk.user?.id
        let object = (try? JSONSerialization.jsonObject(with: encoded)) as? [String: Any]
        let shareToken = object?["shareToken"] as? String
        let isWorkspace = !apiRoot && path == "supporter/event-workspace"
        let downloadStamp = isWorkspace ? shareToken.map { offline.workspaceDownloadStamp(for: $0) } : nil
        if (!offline.online && !forceNetworkAttempt) || (!clerk.isLoaded && offline.canContinue) {
            if isWorkspace, allowCachedWorkspace, let shareToken,
               let data = try offline.saved("workspace/" + shareToken, subject: clerk.user?.id) { return data }
            throw isWorkspace ? NativeOfflineError.notPrepared : NativeOfflineError.onlineOnly
        }
        do {
            let data = try await networkPostData(path, body: body, method: method, apiRoot: apiRoot, clerk: clerk)
            guard requestScope == offline.vault.namespace, requestSubject == clerk.user?.id else {
                throw NativeOfflineError.locked
            }
            if isWorkspace {
                try Task.checkCancellation()
                // Ordinary Event Card loads are independent of the preparation
                // worker. Reject their pre-removal responses too, before either
                // caching them or returning them to an in-memory event model.
                if let shareToken, let downloadStamp,
                   !offline.acceptsWorkspaceDownload(downloadStamp, for: shareToken) {
                    throw NativeOfflineError.notPrepared
                }
            }
            if (isWorkspace || path == "supporter/event-workspace-save"), let shareToken,
               offline.vault.canContinue(subject: clerk.user?.id),
               (try? JSONDecoder().decode(NativeEventWorkspace.self, from: data)) != nil {
                offline.cache(data, key: "workspace/" + shareToken)
                offline.receivedFreshContent()
            }
            return data
        } catch {
            let status = (error as? NativeAccountLinkError)?.statusCode
            if isWorkspace, allowCachedWorkspace, error is URLError || (status.map { $0 >= 500 } ?? false),
               let shareToken, let data = try? offline.saved("workspace/" + shareToken, subject: clerk.user?.id) { return data }
            throw error
        }
    }

    private func networkPostData<T: Encodable>(
        _ path: String, body: T, method: String, apiRoot: Bool, clerk: Clerk
    ) async throws -> Data {
        let origin = try Self.apiOrigin()
        let requestScope = NativeOfflineVault.shared.namespace
        guard clerk.isAuthFlowComplete, let subject = clerk.user?.id,
              let token = try await clerk.session?.getToken() else {
            throw NativeAccountLinkError.message("Sign in to the iPhone app again.")
        }

        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !components.isEmpty,
              components.allSatisfy({
                  String($0).range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
              }) else {
            throw NativeAccountLinkError.message("The PIXL Sports request could not be prepared.")
        }

        var url = origin.appendingPathComponent("api")
        if !apiRoot {
            url.appendPathComponent("native")
        }
        for component in components {
            url = url.appendingPathComponent(String(component))
        }

        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        request.httpMethod = method
        request.httpBody = try JSONEncoder().encode(body)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")
        let (data, response) = try await session.data(for: request)
        guard clerk.user?.id == subject, origin == (try Self.apiOrigin()),
              requestScope == NativeOfflineVault.shared.namespace else { throw NativeOfflineError.locked }
        guard let response = response as? HTTPURLResponse else {
            throw NativeAccountLinkError.message(Self.requestFailureMessage(for: path, method: method))
        }
        guard (200...299).contains(response.statusCode) else {
            NativeOfflineRuntime.shared.deny(status: response.statusCode)
            if let failure = try? JSONDecoder().decode(NativeAccountLinkFailure.self, from: data) {
                if response.statusCode < 500 {
                    throw NativeAccountLinkError.serverStatus(response.statusCode, failure.error)
                }
            }
            throw NativeAccountLinkError.serverStatus(
                response.statusCode,
                Self.requestFailureMessage(for: path, method: method)
            )
        }
        return data
    }

    func publicRequest(_ path: String, method: String = "GET", body: [String: String]? = nil) async throws -> Data {
        guard NativeOfflineRuntime.shared.online else { throw NativeOfflineError.onlineOnly }
        let origin = try Self.apiOrigin()
        let components = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !components.isEmpty,
              components.allSatisfy({
                  String($0).range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil
              }) else {
            throw NativeAccountLinkError.message("The Live Taps request could not be prepared.")
        }

        var url = origin.appendingPathComponent("api")
        for component in components {
            url.appendPathComponent(String(component))
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse else {
            throw NativeAccountLinkError.message("Live Taps could not be checked.")
        }
        guard (200..<300).contains(response.statusCode) else {
            if let failure = try? JSONDecoder().decode(NativeAccountLinkFailure.self, from: data) {
                throw NativeAccountLinkError.serverStatus(response.statusCode, failure.error)
            }
            throw NativeAccountLinkError.message(
                NativeAccountLinkEndpoint.responseFailure(
                    status: response.statusCode,
                    contentType: response.value(forHTTPHeaderField: "Content-Type"),
                    origin: origin
                )
            )
        }
        return data
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
            let message = (try? JSONDecoder().decode(NativeAccountLinkFailure.self, from: data))?.error
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
