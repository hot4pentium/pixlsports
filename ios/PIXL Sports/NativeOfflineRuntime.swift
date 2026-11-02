import SwiftUI
import Combine
import Network
import ClerkKit

extension Notification.Name {
    static let nativeOfflineConnectionChanged = Notification.Name("pixl.native.offline.connection")
}

/// One foreground coordinator, not one reconnect timer per tap or screen.
@MainActor
final class NativeOfflineRuntime: ObservableObject {
    static let shared = NativeOfflineRuntime()
    @Published private(set) var online = true
    @Published private(set) var usingSavedContent = false
    @Published private(set) var preparation = ""
    @Published private(set) var storageError: String?
    @Published private(set) var accessGeneration = 0
    @Published private(set) var revocationGeneration = 0
    let vault = NativeOfflineVault.shared
    private let monitor = NWPathMonitor()
    private var worker: Task<Void, Never>?
    private var lastRefresh = Date.distantPast
    private var activeDrains = Set<String>()
    private var models: [String: NativeEventToolModel] = [:]
    private var workerID = UUID()
    private var expiryClock: AnyCancellable?

    var accountID: String { vault.subject ?? "signed-out" }
    var canContinue: Bool { vault.canContinue() }
    var hasPending: Bool { vault.hasPending }
    var lastVerified: Date? { vault.verifiedAt }
    var needsRevalidation: Bool {
        guard let lease = vault.lease else { return false }
        return vault.denied || !lease.permits(origin: vault.origin, subject: nil)
    }
    func pause() { cancelWorker() }

    private init() {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-testing-force-offline") {
            online = false
            usingSavedContent = true
        }
#endif
        monitor.pathUpdateHandler = { [weak self] path in
#if DEBUG
            let connected = path.status == .satisfied
                && !ProcessInfo.processInfo.arguments.contains("--ui-testing-force-offline")
#else
            let connected = path.status == .satisfied
#endif
            Task { @MainActor in
                guard let self, online != connected else { return }
                online = connected
                if !connected { cancelWorker(); usingSavedContent = true }
                NotificationCenter.default.post(name: .nativeOfflineConnectionChanged, object: nil)
            }
        }
        monitor.start(queue: DispatchQueue(label: "pixl.native.connectivity"))
        expiryClock = Timer.publish(every: 60, on: .main, in: .common).autoconnect().sink { [weak self] _ in
            self?.objectWillChange.send()
        }
    }

    func cacheKey(_ path: String, headers: [String: String] = [:]) -> String? {
        guard ["supporter/schedule", "supporter/profile", "supporter/hype-card",
               "supporter/hype-card/cutout-photo"].contains(path) else { return nil }
        let suffix = headers.sorted { $0.key < $1.key }.map { $0.key + "=" + $0.value }.joined(separator: "&")
        return "get/" + path + (suffix.isEmpty ? "" : "?" + suffix)
    }

    func saved(_ key: String, subject: String?) throws -> Data? {
        let data = try vault.read(key, subject: subject)
        if data != nil { usingSavedContent = true }
        return data
    }

    func cache(_ data: Data, key: String) {
        do { try vault.write(data, key: key); storageError = nil }
        catch { storageError = error.localizedDescription }
#if os(iOS)
        Task { await NativeLocalEventReminderCoordinator.shared.reconcile() }
#endif
    }

    func verified(token: String, subject: String, schedule: Data) {
        do {
            let previous = vault.namespace
            try vault.verify(token: token, subject: subject, schedule: schedule)
            if previous != nil, previous != vault.namespace {
                cancelWorker()
                models.removeAll()
                activeDrains.removeAll()
                revocationGeneration += 1
            }
            storageError = nil
            usingSavedContent = !online
            accessGeneration += 1
#if os(iOS)
            Task { await NativeLocalEventReminderCoordinator.shared.reconcile() }
#endif
        } catch { storageError = error.localizedDescription }
    }

    func deny(status: Int, accountScope: Bool = false) {
        guard [401, 403, 410, 423].contains(status) else { return }
        cancelWorker()
        do {
            if status == 401 || !accountScope { try vault.lock() }
            else { try clear() }
        } catch { storageError = error.localizedDescription }
        accessGeneration += 1
        revocationGeneration += 1
    }

    func clear() throws {
        cancelWorker()
        try vault.clear()
        models.removeAll()
        activeDrains.removeAll()
        usingSavedContent = false
        preparation = ""
        accessGeneration += 1
        revocationGeneration += 1
    }

    private func modelKey(_ token: String) -> String { (vault.namespace ?? "locked") + "|" + token }
    func register(_ model: NativeEventToolModel, token: String) { models[modelKey(token)] = model }
    func eventModel(token: String, accountID: String) -> NativeEventToolModel {
        if let model = models[modelKey(token)] { return model }
        return NativeEventToolModel(shareToken: token, accountID: accountID)
    }
    func claim(_ token: String) -> Bool { activeDrains.insert(token).inserted }
    func release(_ token: String) { activeDrains.remove(token) }
    func storageChanged() { objectWillChange.send() }
    func receivedFreshContent() { usingSavedContent = false }
    private func cancelWorker() {
        worker?.cancel()
        worker = nil
        workerID = UUID()
    }

    func resume(clerk: Clerk, force: Bool = false) {
        guard online, clerk.isAuthFlowComplete, worker == nil,
              force || Date().timeIntervalSince(lastRefresh) > 30 else { return }
        lastRefresh = Date()
        let jobID = UUID()
        workerID = jobID
        worker = Task {
            defer { if workerID == jobID { worker = nil } }
            // Revalidate the native account before touching any persisted outbox.
            do {
                let page = try await verifiedSchedule(clerk: clerk)
                guard page.status == "linked", vault.canContinue(subject: clerk.user?.id) else { return }
                let scope = vault.namespace
                await prepare(page, clerk: clerk, scope: scope)
#if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--prep-hold-auto-retry") { return }
#endif
                for delay in [0, 2, 5, 15, 60] {
                    if delay > 0 { try await Task.sleep(for: .seconds(delay)) }
                    guard !Task.isCancelled, online, vault.namespace == scope,
                          vault.canContinue(subject: clerk.user?.id) else { return }
                    for token in Set(vault.queuedEvents + vault.checklistDraftEvents).sorted() {
                        guard !Task.isCancelled else { return }
                        if (try? vault.read("outbox/" + token)) == nil {
                            // An interrupted initial write may leave a catalog
                            // placeholder. Do not treat corrupt bytes as absent.
                            do {
                                if try vault.read("outbox/" + token) == nil {
                                    try vault.write(nil, key: "outbox/" + token)
                                    if !vault.checklistDraftEvents.contains(token) { continue }
                                }
                            } catch {
                                storageError = error.localizedDescription
                                continue
                            }
                        }
                        let model = eventModel(token: token, accountID: accountID)
                        await model.load(clerk: clerk)
                    }
                    if vault.queuedEvents.isEmpty && vault.checklistDraftEvents.isEmpty { break }
                }
                guard !Task.isCancelled, vault.namespace == scope else { return }
            } catch is CancellationError {
            } catch { preparation = "Offline preparation paused. Reconnect and retry." }
        }
    }

    private func verifiedSchedule(clerk: Clerk) async throws -> NativeSupporterSchedule {
        var lastError: Error = NativeOfflineError.onlineOnly
        for delay in [0, 2, 5, 15] {
            if delay > 0 { try await Task.sleep(for: .seconds(delay)) }
            guard !Task.isCancelled, online, clerk.isAuthFlowComplete else { throw CancellationError() }
            do {
                let started = Date()
                let data = try await NativeAccountLinkClient().getData("supporter/schedule", clerk: clerk)
                let page = try JSONDecoder().decode(NativeSupporterSchedule.self, from: data)
                guard page.status == "linked", let verified = vault.verifiedAt, verified >= started else {
                    throw NativeOfflineError.onlineOnly
                }
                return page
            } catch {
                if let status = (error as? NativeAccountLinkError)?.statusCode,
                   [401, 403, 410].contains(status) { throw error }
                lastError = error
            }
        }
        throw lastError
    }

    private func prepare(_ page: NativeSupporterSchedule, clerk: Clerk, scope: String?) async {
        let now = Date()
        let cutoff = now.addingTimeInterval(7 * 24 * 60 * 60)
        let events = page.events.filter {
            let zone = $0.timezone ?? page.timezone ?? TimeZone.current.identifier
            guard let date = $0.parsedStart(timezone: zone) else { return false }
            return date >= Calendar.current.startOfDay(for: now) && date < cutoff
        }.sorted { $0.date + $0.time < $1.date + $1.time }
        // Serial requests and a fixed budget keep first dashboard paint independent.
        let selected = Array(events.prefix(24))
        var prepared = 0
        for event in selected {
            guard !Task.isCancelled, online, vault.namespace == scope else { return }
            if vault.date("workspace/" + event.shareToken).map({ Date().timeIntervalSince($0) < 300 }) == true {
                prepared += 1
                continue
            }
            do {
                let data = try await NativeAccountLinkClient().postData(
                    "supporter/event-workspace", body: ["shareToken": event.shareToken], clerk: clerk)
                guard try vault.read("workspace/" + event.shareToken) == data else {
                    throw NativeOfflineError.protectedStorage
                }
                prepared += 1
                preparation = "Ready offline: \(prepared) of \(selected.count) upcoming events"
            } catch { preparation = "Ready offline: \(prepared) of \(selected.count). Tap Retry to finish."; return }
        }
        preparation = selected.isEmpty ? "Saved dashboard available offline" :
            "Ready offline: \(prepared) upcoming events" + (events.count > 24 ? " · open other events to prepare them" : "")
#if os(iOS)
        await NativeLocalEventReminderCoordinator.shared.reconcile()
#endif
    }
}

struct NativeOfflineStatusView: View {
    @ObservedObject private var offline = NativeOfflineRuntime.shared
    let retry: () -> Void
    var body: some View {
        if offline.canContinue || offline.storageError != nil {
            VStack(alignment: .leading, spacing: 6) {
                Label(offline.online && !offline.usingSavedContent ? "Saved on this iPhone" : "Using saved iPhone data",
                      systemImage: offline.online && !offline.usingSavedContent ? "checkmark.shield" : "wifi.slash")
                    .font(.subheadline.bold())
                if let date = offline.lastVerified {
                    Text("Last verified \(date.formatted(date: .abbreviated, time: .shortened)). Offline access lasts up to 7 days.")
                }
                if let error = offline.storageError { Text(error).foregroundStyle(.orange) }
                else if !offline.preparation.isEmpty {
                    Text(offline.preparation).accessibilityIdentifier("native-offline-preparation")
                }
                if offline.hasPending {
                    Text("Changes saved here are waiting to sync. Live fans cannot see them yet.")
                        .accessibilityIdentifier("native-offline-dashboard-pending")
                }
                if offline.online { Button("Retry sync & offline preparation", action: retry).foregroundStyle(.white) }
            }
            .font(.caption)
            .foregroundStyle(.white.opacity(0.85))
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 18))
            .accessibilityIdentifier("native-offline-status")
        }
    }
}
