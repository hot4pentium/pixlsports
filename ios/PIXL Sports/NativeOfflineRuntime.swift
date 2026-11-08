import SwiftUI
import Combine
import Network
import ClerkKit

extension Notification.Name {
    static let nativeOfflineConnectionChanged = Notification.Name("pixl.native.offline.connection")
    static let nativeEventCardQueueSynced = Notification.Name("pixl.native.event-card-queue-synced")
    static let nativeHypeCardSettingsQueueSynced = Notification.Name("pixl.native.hype-card-settings-queue-synced")
}

enum NativeEventCardDeletionStageResult: Equatable {
    case cancelledLocalDraft
    case queuedForSync
}

enum NativeAPIConnectionCheckResult: Equatable {
    case connected
    case signInRequired
    case unreachable
    case serverResponseError(statusCode: Int)

    var message: String {
        switch self {
        case .connected:
            "Connected to PIXL Sports."
        case .signInRequired:
            "Sign in again to check the PIXL connection."
        case .unreachable:
            "Couldn’t reach the PIXL server. Check your connection and try again."
        case let .serverResponseError(statusCode):
            "PIXL responded with an error (HTTP \(statusCode)). Try again later."
        }
    }

    var symbolName: String {
        switch self {
        case .connected: "checkmark.circle.fill"
        case .signInRequired: "person.crop.circle.badge.exclamationmark"
        case .unreachable: "wifi.slash"
        case .serverResponseError: "exclamationmark.triangle.fill"
        }
    }

    var succeeded: Bool {
        if case .connected = self { return true }
        return false
    }
}

/// One foreground coordinator, not one reconnect timer per tap or screen.
@MainActor
final class NativeOfflineRuntime: ObservableObject {
    private(set) var athleteProfileCacheRevision = UUID()
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
    private var activeEventCardSyncs = Set<String>()
    private var queuedEventCardSyncClerks: [String: Clerk] = [:]
    private var activeHypeCardSettingsSyncs = Set<String>()
    private var recentlySyncedEventCardTokens: [String: String] = [:]
    private var models: [String: NativeEventToolModel] = [:]
    private var downloadEpochs = NativeOfflineDownloadEpochs()
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
            Task { @MainActor [weak self] in
                guard let self, self.online != connected else { return }
                self.online = connected
                if !connected { self.cancelWorker(); self.usingSavedContent = true }
                NotificationCenter.default.post(name: .nativeOfflineConnectionChanged, object: nil)
            }
        }
        monitor.start(queue: DispatchQueue(label: "pixl.native.connectivity"))
        expiryClock = Timer.publish(every: 60, on: .main, in: .common).autoconnect().sink { [weak self] _ in
            self?.objectWillChange.send()
        }
    }

    func cacheKey(_ path: String, headers: [String: String] = [:]) -> String? {
        guard ["supporter/schedule", "supporter/profile", "supporter/season-stats", "supporter/hype-card",
               "supporter/hype-card/cutout-photo"].contains(path) else { return nil }
        let suffix = headers.sorted { $0.key < $1.key }.map { $0.key + "=" + $0.value }.joined(separator: "&")
        return "get/" + path + (suffix.isEmpty ? "" : "?" + suffix)
    }

    func saved(_ key: String, subject: String?) throws -> Data? {
        let data = try vault.read(key, subject: subject)
        if data != nil { usingSavedContent = true }
        return data
    }

    /// A confirmed profile write supersedes profile downloads already in flight.
    func cacheSavedAthleteProfile(_ data: Data) {
        athleteProfileCacheRevision = UUID()
        cache(data, key: "get/supporter/profile")
    }

    func cache(_ data: Data, key: String) {
        do {
            try vault.write(data, key: key)
            if key.hasPrefix("workspace/") {
                try vault.allowAutomaticDownload(String(key.dropFirst(10)), subject: vault.subject)
            }
            storageError = nil
        }
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
                recentlySyncedEventCardTokens.removeAll()
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
        downloadEpochs.invalidate(event: nil)
        try vault.clear()
        models.removeAll()
        activeDrains.removeAll()
        recentlySyncedEventCardTokens.removeAll()
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

    func recentlySyncedEventCardToken(id: String, subject: String) -> String? {
        guard vault.canContinue(subject: subject), let scope = vault.namespace else { return nil }
        return recentlySyncedEventCardTokens[scope + "|" + id]
    }

    func pendingEventCards(subject: String?) -> [NativePendingEventCardChange] {
        guard let subject, vault.canContinue(subject: subject) else { return [] }
        var changes: [NativePendingEventCardChange] = []
        for id in vault.pendingEventCardIDs {
            do {
                guard let data = try vault.read("pending/event-card/" + id, subject: subject) else { continue }
                let change = try JSONDecoder().decode(NativePendingEventCardChange.self, from: data)
                guard change.id == id else { continue }
                changes.append(change)
            } catch {}
        }
        return changes.sorted { $0.createdAt < $1.createdAt }
    }

    func savePendingEventCard(_ change: NativePendingEventCardChange, subject: String) throws {
        guard UUID(uuidString: change.id) != nil,
              vault.canContinue(subject: subject),
              vault.subject == subject else { throw NativeOfflineError.locked }
        let key = "pending/event-card/" + change.id
        try vault.write(JSONEncoder().encode(change), key: key)
        storageChanged()
    }

    func removePendingEventCard(id: String, subject: String) throws {
        guard vault.canContinue(subject: subject), vault.subject == subject else {
            throw NativeOfflineError.locked
        }
        try vault.write(nil, key: "pending/event-card/" + id)
        storageChanged()
    }

    func discardPendingEventCard(id: String, subject: String) {
        do { try removePendingEventCard(id: id, subject: subject) }
        catch { storageError = "This saved Event Card could not be removed from this iPhone." }
    }

    func stageEventCardDeletion(
        event: AthleteFanEvent,
        teamName: String?,
        athleteName: String,
        seasonName: String?,
        subject: String
    ) throws -> NativeEventCardDeletionStageResult {
        let draft = NativeEventCardDraft.from(event)
        var change = pendingEventCards(subject: subject).first(where: { $0.id == event.eventId })
            ?? NativePendingEventCardChange(
                operation: .delete,
                draft: draft,
                teamName: teamName,
                athleteName: athleteName,
                seasonName: seasonName,
                shareToken: event.shareToken,
                baseDraft: draft,
                attemptedDraft: nil,
                conflictDraft: nil,
                conflictMessage: nil,
                lastError: nil,
                createdAt: Date()
            )

        if change.operation == .create,
           change.shareToken == nil,
           change.attemptedDraft == nil {
            try removePendingEventCard(id: event.eventId, subject: subject)
            return .cancelledLocalDraft
        }

        change.operation = .delete
        change.draft = draft
        change.shareToken = event.shareToken
        change.baseDraft = change.baseDraft ?? draft
        change.conflictDraft = nil
        change.conflictMessage = nil
        change.lastError = nil
        try savePendingEventCard(change, subject: subject)
        return .queuedForSync
    }

    func stagePendingEventCardDeletion(
        id: String,
        subject: String
    ) throws -> NativeEventCardDeletionStageResult {
        guard var change = pendingEventCards(subject: subject).first(where: { $0.id == id }) else {
            throw NativeOfflineError.locked
        }
        if change.operation == .create,
           change.shareToken == nil,
           change.attemptedDraft == nil {
            try removePendingEventCard(id: id, subject: subject)
            return .cancelledLocalDraft
        }
        change.operation = .delete
        change.conflictDraft = nil
        change.conflictMessage = nil
        change.lastError = nil
        try savePendingEventCard(change, subject: subject)
        return .queuedForSync
    }

    func keepLocalEventCardAfterConflict(id: String, subject: String, clerk: Clerk) async {
        guard let change = pendingEventCards(subject: subject).first(where: { $0.id == id }),
              let remote = change.conflictDraft else { return }
        var resolved = change
        resolved.baseDraft = remote
        resolved.attemptedDraft = nil
        resolved.conflictDraft = nil
        resolved.conflictMessage = nil
        resolved.lastError = nil
        do {
            try savePendingEventCard(resolved, subject: subject)
            await retryPendingEventCards(clerk: clerk, onlyID: id)
        } catch {
            storageError = "The Event Card edit is still saved on this iPhone, but could not be prepared to sync."
        }
    }

    func recreatePendingEventCardAsNew(id: String, subject: String, clerk: Clerk) async {
        guard var change = pendingEventCards(subject: subject).first(where: { $0.id == id }) else { return }
        let oldID = change.id
        change.draft = NativeEventCardDraft(
            id: UUID().uuidString.lowercased(),
            type: change.draft.type,
            date: change.draft.date,
            time: change.draft.time,
            timezone: change.draft.timezone,
            location: change.draft.location,
            opponent: change.draft.opponent
        )
        change.operation = .create
        change.shareToken = nil
        change.baseDraft = nil
        change.attemptedDraft = nil
        change.conflictDraft = nil
        change.conflictMessage = nil
        change.lastError = nil
        change.createdAt = Date()
        do {
            try savePendingEventCard(change, subject: subject)
            try removePendingEventCard(id: oldID, subject: subject)
            await retryPendingEventCards(clerk: clerk, onlyID: change.id)
        } catch {
            storageError = "The Event Card remains saved on this iPhone, but could not be prepared as a new card."
        }
    }

    func retryPendingEventCards(clerk: Clerk, onlyID: String? = nil) async -> [String: String] {
        guard let subject = clerk.user?.id,
              clerk.isAuthFlowComplete,
              vault.canContinue(subject: subject),
              let scope = vault.namespace else { return [:] }
        let syncKey = scope
        guard activeEventCardSyncs.insert(syncKey).inserted else {
            queuedEventCardSyncClerks[syncKey] = clerk
            return [:]
        }
        defer {
            activeEventCardSyncs.remove(syncKey)
            if let retryClerk = queuedEventCardSyncClerks.removeValue(forKey: syncKey) {
                Task { await retryPendingEventCards(clerk: retryClerk) }
            }
        }

        var syncedTokens: [String: String] = [:]
        do {
            let schedule = try await SupporterHomeAPI.fetchAuthoritativePrivateSchedule(clerk: clerk)
            guard schedule.status == "linked",
                  clerk.user?.id == subject,
                  vault.namespace == scope,
                  vault.canContinue(subject: subject) else { return [:] }
            let changes = pendingEventCards(subject: subject).filter {
                onlyID == nil || $0.id == onlyID
            }
            var didSyncAny = false
            for change in changes {
                guard clerk.user?.id == subject, vault.namespace == scope,
                      vault.canContinue(subject: subject) else { return syncedTokens }
                for _ in 0..<3 {
                    guard let current = pendingEventCards(subject: subject).first(where: { $0.id == change.id }),
                          !current.isConflicted else { break }
                    let operation = current.operation
                    do {
                        if let token = try await syncPendingEventCard(
                            current,
                            clerk: clerk,
                            subject: subject,
                            scope: scope
                        ) {
                            syncedTokens[change.id] = token
                            if operation != .delete {
                                recentlySyncedEventCardTokens[scope + "|" + change.id] = token
                                if recentlySyncedEventCardTokens.count > 50,
                                   let oldKey = recentlySyncedEventCardTokens.keys.first(where: {
                                       $0 != scope + "|" + change.id
                                   }) {
                                    recentlySyncedEventCardTokens.removeValue(forKey: oldKey)
                                }
                            }
                            didSyncAny = true
                            break
                        }
                    } catch {
                        guard let latest = pendingEventCards(subject: subject).first(where: { $0.id == change.id }) else {
                            break
                        }
                        // A delete may replace an update/create while its
                        // request is in flight. Never let that old response
                        // clear or overwrite the newer tombstone.
                        guard latest.operation == operation else { continue }
                        if let accountError = error as? NativeAccountLinkError,
                           accountError.statusCode == 409,
                           operation != .delete {
                            await recordEventCardConflict(
                                id: change.id,
                                clerk: clerk,
                                subject: subject,
                                scope: scope
                            )
                        } else {
                            recordEventCardFailure(id: change.id, error: error, subject: subject)
                        }
                        break
                    }
                    guard let latest = pendingEventCards(subject: subject).first(where: { $0.id == change.id }),
                          latest.operation != operation else { break }
                }
            }
            if didSyncAny {
                NotificationCenter.default.post(name: .nativeEventCardQueueSynced, object: nil)
            }
        } catch {
            for change in pendingEventCards(subject: subject) where onlyID == nil || change.id == onlyID {
                recordEventCardFailure(id: change.id, error: error, subject: subject)
            }
        }
        return syncedTokens
    }

    private func syncPendingEventCard(
        _ original: NativePendingEventCardChange,
        clerk: Clerk,
        subject: String,
        scope: String
    ) async throws -> String? {
        guard var change = pendingEventCards(subject: subject).first(where: { $0.id == original.id }) else {
            return nil
        }
        for _ in 0..<4 {
            guard clerk.user?.id == subject, vault.namespace == scope,
                  vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }

            if change.operation == .delete {
                return try await syncPendingEventCardDeletion(
                    change,
                    clerk: clerk,
                    subject: subject,
                    scope: scope
                )
            }

            if change.operation == .create {
                let submitted = change.attemptedDraft ?? change.draft
                if change.attemptedDraft == nil {
                    change.attemptedDraft = submitted
                    change.lastError = nil
                    try savePendingEventCard(change, subject: subject)
                }
                if change.shareToken == nil {
                    let token = try await SupporterHomeAPI.createEventCard(
                        draft: submitted,
                        teamName: change.teamName,
                        athleteName: change.athleteName,
                        seasonName: change.seasonName,
                        clerk: clerk,
                        forceNetworkAttempt: true
                    )
                    guard let latestAfterCreate = pendingEventCards(subject: subject).first(where: {
                        $0.id == change.id
                    }), latestAfterCreate.operation == .create,
                          latestAfterCreate.attemptedDraft == submitted else { return nil }
                    change = latestAfterCreate
                    change.shareToken = token
                    change.baseDraft = submitted
                    try savePendingEventCard(change, subject: subject)
                }
                guard let token = change.shareToken else { throw SupporterHomeAPIError.invalidResponse }
                let schedule = try await SupporterHomeAPI.fetchAuthoritativePrivateSchedule(clerk: clerk)
                guard let latestAfterCreateConfirmation = pendingEventCards(subject: subject).first(where: {
                    $0.id == change.id
                }), latestAfterCreateConfirmation.operation == .create,
                      latestAfterCreateConfirmation.attemptedDraft == submitted else { return nil }
                change = latestAfterCreateConfirmation
                guard let event = schedule.events.first(where: {
                    $0.shareToken == token && $0.eventId == change.id
                }) else {
                    throw SupporterHomeAPIError.eventSaveNotConfirmed
                }
                guard submitted.matches(event) else {
                    let remote = NativeEventCardDraft.from(event)
                    if remote == change.draft {
                        try removePendingEventCard(id: change.id, subject: subject)
                        return token
                    }
                    change.operation = .update
                    change.baseDraft = remote
                    change.conflictDraft = remote
                    change.conflictMessage = "This Event Card already exists with different details. Choose which version to keep."
                    change.lastError = nil
                    try savePendingEventCard(change, subject: subject)
                    return nil
                }
                if change.draft == submitted {
                    try removePendingEventCard(id: change.id, subject: subject)
                    return token
                }
                change.operation = .update
                change.baseDraft = submitted
                change.attemptedDraft = nil
                try savePendingEventCard(change, subject: subject)
                continue
            }

            guard change.operation == .update else { continue }
            guard let token = change.shareToken, let base = change.baseDraft else {
                change.conflictMessage = "The saved Event Card edit needs review before it can sync."
                try savePendingEventCard(change, subject: subject)
                return nil
            }
            let schedule = try await SupporterHomeAPI.fetchAuthoritativePrivateSchedule(clerk: clerk)
            guard let latestAfterRead = pendingEventCards(subject: subject).first(where: { $0.id == change.id }),
                  latestAfterRead.operation == .update else { return nil }
            change = latestAfterRead
            guard let event = schedule.events.first(where: { $0.shareToken == token && $0.eventId == change.id }) else {
                change.conflictDraft = nil
                change.conflictMessage = "This Event Card is no longer on the server. Your edits remain saved on this iPhone."
                change.lastError = nil
                try savePendingEventCard(change, subject: subject)
                return nil
            }
            let remote = NativeEventCardDraft.from(event)
            if remote == change.draft {
                try removePendingEventCard(id: change.id, subject: subject)
                return token
            }
            if let attempted = change.attemptedDraft, remote == attempted {
                if attempted == change.draft {
                    try removePendingEventCard(id: change.id, subject: subject)
                    return token
                }
                change.baseDraft = remote
                change.attemptedDraft = nil
                try savePendingEventCard(change, subject: subject)
                continue
            }
            guard remote == base else {
                change.conflictDraft = remote
                change.conflictMessage = "This Event Card changed on another device. Choose whether to keep your iPhone edits or use the server version."
                change.lastError = nil
                try savePendingEventCard(change, subject: subject)
                return nil
            }
            if change.attemptedDraft == nil {
                change.attemptedDraft = change.draft
                change.lastError = nil
                try savePendingEventCard(change, subject: subject)
            }
            let attempted = change.attemptedDraft!
            _ = try await SupporterHomeAPI.updateEventCard(
                shareToken: token,
                draft: attempted,
                expected: base,
                clerk: clerk,
                forceNetworkAttempt: true
            )
            guard let latestAfterUpdate = pendingEventCards(subject: subject).first(where: { $0.id == change.id }),
                  latestAfterUpdate.operation == .update else { return nil }
            change = latestAfterUpdate
            let confirmedSchedule = try await SupporterHomeAPI.fetchAuthoritativePrivateSchedule(clerk: clerk)
            guard let latestAfterConfirmation = pendingEventCards(subject: subject).first(where: {
                $0.id == change.id
            }), latestAfterConfirmation.operation == .update else { return nil }
            change = latestAfterConfirmation
            guard let confirmed = confirmedSchedule.events.first(where: {
                $0.shareToken == token && $0.eventId == change.id
            }) else { throw SupporterHomeAPIError.eventSaveNotConfirmed }
            guard attempted.matches(confirmed) else {
                change.conflictDraft = NativeEventCardDraft.from(confirmed)
                change.conflictMessage = "This Event Card changed while your edit was syncing. Choose which version to keep."
                try savePendingEventCard(change, subject: subject)
                return nil
            }
            if attempted == change.draft {
                try removePendingEventCard(id: change.id, subject: subject)
                return token
            }
            change.baseDraft = attempted
            change.attemptedDraft = nil
            try savePendingEventCard(change, subject: subject)
        }
        return nil
    }

    private func syncPendingEventCardDeletion(
        _ original: NativePendingEventCardChange,
        clerk: Clerk,
        subject: String,
        scope: String
    ) async throws -> String? {
        guard var change = pendingEventCards(subject: subject).first(where: { $0.id == original.id }),
              change.operation == .delete else { return nil }
        let schedule = try await SupporterHomeAPI.fetchAuthoritativePrivateSchedule(clerk: clerk)
        guard clerk.user?.id == subject, vault.namespace == scope,
              vault.canContinue(subject: subject),
              let latest = pendingEventCards(subject: subject).first(where: { $0.id == change.id }),
              latest.operation == .delete else { return nil }
        change = latest

        let token: String
        if let shareToken = change.shareToken {
            guard schedule.events.contains(where: { $0.shareToken == shareToken }) else {
                try removePendingEventCard(id: change.id, subject: subject)
                return shareToken
            }
            token = shareToken
        } else {
            let matchingEvents = schedule.events.filter { $0.eventId == change.id }
            guard let event = matchingEvents.first else {
                // The create never reached the server, so cancelling its
                // tombstone cannot affect a public card or recorded game.
                try removePendingEventCard(id: change.id, subject: subject)
                return nil
            }
            guard matchingEvents.count == 1,
                  (change.attemptedDraft ?? change.draft).matches(event) else {
                change.lastError = "PIXL couldn’t safely identify the Event Card from this iPhone draft. It remains saved here."
                try savePendingEventCard(change, subject: subject)
                return nil
            }
            token = event.shareToken
            change.shareToken = token
            change.baseDraft = NativeEventCardDraft.from(event)
            try savePendingEventCard(change, subject: subject)
        }

        guard let current = pendingEventCards(subject: subject).first(where: { $0.id == change.id }),
              current.operation == .delete,
              clerk.user?.id == subject, vault.namespace == scope,
              vault.canContinue(subject: subject) else { return nil }
        do {
            try await SupporterHomeAPI.deleteEventCard(shareToken: token, clerk: clerk)
        } catch let error as NativeAccountLinkError where error.statusCode == 404 {
            // A second device may already have removed this exact share.
        }

        guard let current = pendingEventCards(subject: subject).first(where: { $0.id == change.id }),
              current.operation == .delete,
              clerk.user?.id == subject, vault.namespace == scope,
              vault.canContinue(subject: subject) else { return nil }
        let confirmedSchedule = try await SupporterHomeAPI.fetchAuthoritativePrivateSchedule(clerk: clerk)
        guard let confirmedChange = pendingEventCards(subject: subject).first(where: { $0.id == change.id }),
              confirmedChange.operation == .delete else { return nil }
        guard !confirmedSchedule.events.contains(where: { $0.shareToken == token }) else {
            throw SupporterHomeAPIError.eventSaveNotConfirmed
        }
        try removePendingEventCard(id: change.id, subject: subject)
        return token
    }

    private func recordEventCardConflict(
        id: String,
        clerk: Clerk,
        subject: String,
        scope: String
    ) async {
        guard var change = pendingEventCards(subject: subject).first(where: { $0.id == id }) else { return }
        let operation = change.operation
        do {
            guard let token = change.shareToken else { return }
            let schedule = try await SupporterHomeAPI.fetchAuthoritativePrivateSchedule(clerk: clerk)
            guard clerk.user?.id == subject, vault.namespace == scope,
                  vault.canContinue(subject: subject),
                  let latest = pendingEventCards(subject: subject).first(where: { $0.id == id }),
                  latest.operation == operation,
                  operation != .delete else { return }
            change = latest
            if let event = schedule.events.first(where: { $0.shareToken == token && $0.eventId == id }) {
                change.conflictDraft = NativeEventCardDraft.from(event)
                change.conflictMessage = "This Event Card changed on another device. Choose whether to keep your iPhone edits or use the server version."
            } else {
                change.conflictDraft = nil
                change.conflictMessage = "This Event Card is no longer on the server. Your edits remain saved on this iPhone."
            }
            change.lastError = nil
            try savePendingEventCard(change, subject: subject)
        } catch {
            recordEventCardFailure(id: id, error: error, subject: subject)
        }
    }

    private func recordEventCardFailure(id: String, error: Error, subject: String) {
        guard var change = pendingEventCards(subject: subject).first(where: { $0.id == id }) else { return }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .notConnectedToInternet, .networkConnectionLost:
                change.lastError = change.operation == .delete
                    ? "The deletion is saved on this iPhone and will retry when PIXL is reachable."
                    : "PIXL could not be reached. This draft is saved on this iPhone and will retry when you sync."
            case .timedOut, .cannotFindHost, .cannotConnectToHost, .dnsLookupFailed, .secureConnectionFailed:
                change.lastError = change.operation == .delete
                    ? "PIXL did not respond. This deletion is saved on this iPhone; try syncing again."
                    : "The PIXL server did not respond. This draft is saved on this iPhone; try syncing again."
            default:
                change.lastError = change.operation == .delete
                    ? "PIXL could not confirm the deletion. It is still saved on this iPhone."
                    : "PIXL could not confirm the save. This draft is still saved on this iPhone."
            }
        } else if let accountError = error as? NativeAccountLinkError,
                  let status = accountError.statusCode {
            switch status {
            case 401:
                change.lastError = change.operation == .delete
                    ? "Reconnect your iPhone account to finish deleting this Event Card."
                    : "Reconnect your iPhone account to sync this saved Event Card."
            case 403, 409, 423:
                change.lastError = accountError.localizedDescription
            case 429:
                change.lastError = change.operation == .delete
                    ? "PIXL is rate-limiting requests (HTTP 429). This deletion will retry shortly."
                    : "PIXL is rate-limiting requests (HTTP 429). This Event Card remains saved on this iPhone; try again shortly."
            case 400..<500:
                change.lastError = change.operation == .delete
                    ? "PIXL needs attention before this deletion can sync: \(accountError.localizedDescription)"
                    : "PIXL needs a correction before this saved Event Card can sync: \(accountError.localizedDescription)"
            case 500..<600:
                change.lastError = change.operation == .delete
                    ? "PIXL returned a server error (HTTP \(status)). The deletion is saved on this iPhone; try again later."
                    : "PIXL returned a server error (HTTP \(status)). This Event Card remains saved on this iPhone; try again later."
            default:
                change.lastError = change.operation == .delete
                    ? "PIXL is temporarily unavailable. The deletion is saved on this iPhone."
                    : "PIXL is temporarily unavailable. This Event Card remains saved on this iPhone."
            }
        } else if error is NativeAccountLinkEndpoint.ConfigurationError {
            change.lastError = change.operation == .delete
                ? "This iPhone’s PIXL server address could not be checked. The deletion remains saved here."
                : "This iPhone’s PIXL server address could not be checked. The Event Card remains saved here."
        } else {
            change.lastError = change.operation == .delete
                ? "PIXL could not confirm the deletion. It is still saved on this iPhone."
                : "PIXL could not confirm the save. This draft is still saved on this iPhone."
        }
        do { try savePendingEventCard(change, subject: subject) }
        catch { storageError = "The Event Card remains in protected iPhone storage, but its sync status could not be updated." }
    }
    func workspaceDownloadStamp(for token: String) -> NativeOfflineDownloadEpochs.Stamp {
        downloadEpochs.stamp(for: token)
    }
    func acceptsWorkspaceDownload(_ stamp: NativeOfflineDownloadEpochs.Stamp, for token: String) -> Bool {
        downloadEpochs.accepts(stamp, for: token)
    }
    func removeDownloads(event token: String?, subject: String?, namespace: String) throws {
        guard vault.namespace == namespace, vault.canContinue(subject: subject) else {
            throw NativeOfflineError.locked
        }
        cancelWorker()
        defer { storageChanged() }
        let removed = try vault.storageSnapshot(subject: subject).events.filter {
            !$0.protected && (token == nil || $0.id == token)
        }
        // Invalidate before filesystem work: even partially successful cleanup
        // must reject ordinary Event Card responses started before removal.
        downloadEpochs.invalidate(event: token)
        defer {
            // Partial filesystem failure may already have removed a download.
            // Do not keep serving its old in-memory model after cleanup.
            for event in removed { models.removeValue(forKey: modelKey(event.id)) }
        }
        try vault.removeDisposableContent(event: token, subject: subject)
        preparation = "Downloads removed. Open an event online to download it again."
        storageError = nil
    }

    func downloadEvent(_ token: String, clerk: Clerk, namespace: String) async throws {
        guard online, vault.namespace == namespace, vault.canContinue(subject: clerk.user?.id) else {
            throw NativeOfflineError.onlineOnly
        }
        let data = try await NativeAccountLinkClient().postData(
            "supporter/event-workspace", body: ["shareToken": token], clerk: clerk,
            allowCachedWorkspace: false)
        guard vault.namespace == namespace, vault.canContinue(subject: clerk.user?.id),
              try vault.read("workspace/" + token, subject: clerk.user?.id) == data else {
            throw NativeOfflineError.protectedStorage
        }
        try vault.allowAutomaticDownload(token, subject: clerk.user?.id)
        storageChanged()
    }
    func receivedFreshContent() { usingSavedContent = false }

    /// Settings drafts are never synced here. The API checks for the durable
    /// save-intent record created only after the owner taps Save.
    func syncPendingHypeCardSettings(
        clerk: Clerk,
        notifyWhenFinished: Bool = true
    ) async -> NativeHypeCardSettings? {
        guard online, clerk.isAuthFlowComplete,
              let subject = clerk.user?.id,
              vault.canContinue(subject: subject),
              let scope = vault.namespace else { return nil }
        guard activeHypeCardSettingsSyncs.insert(scope).inserted else { return nil }
        let client = NativeAccountLinkClient()
        guard (try? client.loadHypeCardSettingsSaveIntent(subject: subject)) != nil else {
            activeHypeCardSettingsSyncs.remove(scope)
            return nil
        }

        defer {
            activeHypeCardSettingsSyncs.remove(scope)
            if notifyWhenFinished {
                NotificationCenter.default.post(name: .nativeHypeCardSettingsQueueSynced, object: nil)
            }
        }
        do {
            let saved = try await SupporterHomeAPI.syncQueuedNativeHypeCardSettings(clerk: clerk)
            guard clerk.user?.id == subject,
                  vault.namespace == scope,
                  vault.canContinue(subject: subject) else { return nil }
            return saved
        } catch {
            // The durable save intent and any uncertain-response marker remain
            // in the account vault for a later reconnect or relaunch.
            return nil
        }
    }

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
                _ = await syncPendingHypeCardSettings(clerk: clerk)
                guard !Task.isCancelled, vault.namespace == scope,
                      vault.canContinue(subject: clerk.user?.id) else { return }
                await retryPendingEventCards(clerk: clerk)
                guard !Task.isCancelled, vault.namespace == scope,
                      vault.canContinue(subject: clerk.user?.id) else { return }
                await prepare(page, clerk: clerk, scope: scope)
#if DEBUG
                if ProcessInfo.processInfo.arguments.contains("--prep-hold-auto-retry") { return }
#endif
                for delay in [0, 2, 5, 15, 60] {
                    if delay > 0 { try await Task.sleep(for: .seconds(delay)) }
                    guard !Task.isCancelled, online, vault.namespace == scope,
                          vault.canContinue(subject: clerk.user?.id) else { return }
                    _ = await syncPendingHypeCardSettings(clerk: clerk)
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
        var removed = 0
        for event in selected {
            guard !Task.isCancelled, online, vault.namespace == scope else { return }
            do {
                if try vault.skipsAutomaticDownload(event.shareToken) {
                    removed += 1
                    continue
                }
            } catch {
                storageError = error.localizedDescription
                return
            }
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
            } catch {
                guard !Task.isCancelled, vault.namespace == scope else { return }
                preparation = "Ready offline: \(prepared) of \(selected.count - removed). Tap Retry to finish."
                return
            }
        }
        preparation = selected.isEmpty ? "Saved dashboard available offline" :
            "Ready offline: \(prepared) upcoming events" + (events.count > 24 ? " · open other events to prepare them" : "")
        if removed > 0 { preparation += " · \(removed) removed downloads need an online download" }
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
