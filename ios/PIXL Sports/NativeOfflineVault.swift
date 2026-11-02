import Foundation
import CryptoKit
import Security

enum NativeOfflineError: LocalizedError, Equatable {
    case locked, notPrepared, protectedStorage, corrupt, full, onlineOnly, pendingWork
    var errorDescription: String? {
        switch self {
        case .locked: "Reconnect and sign in to unlock your saved iPhone data."
        case .notPrepared: "Open this event with a connection first to prepare it for offline use."
        case .protectedStorage: "This iPhone could not securely save your changes. Nothing was sent."
        case .corrupt: "Saved data could not be read. Pending changes have not been deleted."
        case .full: "Offline storage is full. Remove disposable downloads in Settings or free iPhone space. Reconnect to sync your saved changes."
        case .onlineOnly: "This action needs a connection. Your saved Prep and Tracker remain available offline."
        case .pendingWork: "This event contains protected work or recovery data. Sync pending changes and save Prep drafts online before removing its download."
        }
    }
}

/// Encrypted, atomic, versioned files. The device-only Keychain holds the key and
/// bounded continuation lease; preferences and cached profiles confer no access.
@MainActor
final class NativeOfflineVault {
    static let shared = NativeOfflineVault()
    private struct Entry: Codable {
        var date: Date
        var bytes: Int
    }
    private struct Index: Codable {
        var version = 1
        var entries: [String: Entry] = [:]
    }
    private(set) var lease: NativeOfflineLease?
    private var index = Index()
    private let manager = FileManager.default
    private var service: String {
        let config = (try? NativeClerkConfiguration.load().get().publishableKey) ?? "unconfigured"
        return "pixl.native.offline." + Self.digest(config + origin)
    }
    var origin: String { (try? NativeAccountLinkEndpoint.load().absoluteString) ?? "" }
    var subject: String? { lease?.subject }
    var namespace: String? {
        lease.map { Self.digest($0.origin + "|" + $0.issuer + "|" + $0.subject + "|" + ($0.linkId ?? "")) }
    }
    var verifiedAt: Date? { lease?.verifiedAt }
    var checklistDraftEvents: [String] {
        let keys = Set(Array(index.entries.keys) + (lease?.pendingKeys ?? []))
        return keys.filter { $0.hasPrefix("draft/") }.compactMap { key in
            do {
                guard let data = try read(key) else { return nil }
                let draft = try JSONDecoder().decode(NativeOfflinePrepDraft.self, from: data)
                return draft.checklistDirty ? String(key.dropFirst("draft/".count)) : nil
            } catch {
                // Retain and expose damaged pending files; never overwrite them.
                return String(key.dropFirst("draft/".count))
            }
        }
    }
    var denied: Bool {
        namespace.map { UserDefaults.standard.bool(forKey: "pixl.native.offline.denied." + $0) } ?? true
    }
    var hasPending: Bool {
        !(lease?.pendingKeys ?? []).isEmpty
            || index.entries.keys.contains { $0.hasPrefix("outbox/") || $0.hasPrefix("draft/") }
    }
    var queuedEvents: [String] {
        Set(Array(index.entries.keys) + (lease?.pendingKeys ?? []))
            .filter { $0.hasPrefix("outbox/") }.map { String($0.dropFirst(7)) }.sorted()
    }
    var preparedEvents: [String] {
        index.entries.keys.filter { $0.hasPrefix("workspace/") }.map { String($0.dropFirst(10)) }
    }

    private var knownKeys: Set<String> {
        Set(Array(index.entries.keys) + (lease?.pendingKeys ?? []))
    }

    // Download preferences never confer authentication or extend the lease.
    private struct CacheSettings: Codable {
        var removedEvents = Set<String>()
    }
    private func cacheSettings() throws -> CacheSettings {
        guard let data = try read("cache/settings") else { return CacheSettings() }
        return try JSONDecoder().decode(CacheSettings.self, from: data)
    }
    func skipsAutomaticDownload(_ token: String) throws -> Bool {
        try cacheSettings().removedEvents.contains(token)
    }

    func storageSnapshot(subject: String?) throws -> NativeOfflineStorageSnapshot {
        guard canContinue(subject: subject) else { throw NativeOfflineError.locked }
        let settings = try cacheSettings()
        let keys = knownKeys
        let files = try manager.contentsOfDirectory(at: directory(), includingPropertiesForKeys: [.fileSizeKey])
        let total = try files.reduce(0) { try $0 + ($1.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) }
        func size(_ key: String) -> Int {
            (try? file(key).resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        }
        let removable = index.entries.keys.filter {
            NativeOfflineStoragePolicy.isDisposable($0, knownKeys: keys)
        }.reduce(0) { $0 + size($1) }
        let schedule = try read("get/supporter/schedule", subject: subject).map {
            try JSONDecoder().decode(NativeSupporterSchedule.self, from: $0)
        }
        let pending = NativeOfflineStoragePolicy.pendingEvents(keys: keys)
        let tokens = Set(preparedEvents).union(pending).union(settings.removedEvents)
            .union(schedule?.events.map(\.shareToken) ?? [])
        let events = tokens.sorted().map { token in
            let event = schedule?.events.first { $0.shareToken == token }
            let ready: Bool
            do {
                if let bytes = try read("workspace/" + token, subject: subject) {
                    _ = try JSONDecoder().decode(NativeEventWorkspace.self, from: bytes)
                    ready = true
                } else { ready = false }
            } catch { ready = false }
            return NativeOfflineStorageSnapshot.Event(
                id: token, title: event?.title ?? "Saved event",
                detail: event.map { $0.date + " " + $0.time } ?? "Not in the current saved schedule",
                bytes: size("workspace/" + token), ready: ready,
                protected: pending.contains(token)
                    || (index.entries["workspace/" + token] == nil && size("workspace/" + token) > 0))
        }
        var available: Int64?
#if os(iOS)
        available = try? directory().resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
            .volumeAvailableCapacityForImportantUsage
#endif
        return .init(totalBytes: total, removableBytes: removable,
                     deviceAvailableBytes: available, events: events.sorted {
                         ($0.detail, $0.title, $0.id) < ($1.detail, $1.title, $1.id)
                     })
    }

    /// Synchronous on MainActor: recheck live pending keys immediately before
    /// deleting. No await can race a newly queued command or Prep draft.
    func removeDisposableContent(event token: String? = nil, subject: String?) throws {
        guard canContinue(subject: subject) else { throw NativeOfflineError.locked }
        let keys = knownKeys
        let candidates = index.entries.keys.filter { key in
            (token.map { key == "workspace/" + $0 } ?? true)
                && NativeOfflineStoragePolicy.isDisposable(key, knownKeys: keys)
        }
        if let token {
            let exists = manager.fileExists(atPath: try file("workspace/" + token).path)
            if NativeOfflineStoragePolicy.pendingEvents(keys: keys).contains(token)
                || (index.entries["workspace/" + token] == nil && exists) {
                throw NativeOfflineError.pendingWork
            }
        }
        var settings = try cacheSettings()
        for key in candidates where key.hasPrefix("workspace/") {
            settings.removedEvents.insert(String(key.dropFirst(10)))
        }
        // Free disposable bytes before writing preferences so a full device can
        // recover space. Runtime has cancelled preparation; this is synchronous.
        // A failure is surfaced even if part of the cleanup already succeeded.
        for key in candidates {
            try write(nil, key: key)
        }
        try write(JSONEncoder().encode(settings), key: "cache/settings")
    }

    func allowAutomaticDownload(_ token: String, subject: String?) throws {
        guard canContinue(subject: subject) else { throw NativeOfflineError.locked }
        var settings = try cacheSettings()
        guard settings.removedEvents.contains(token) else { return }
        settings.removedEvents.remove(token)
        try write(JSONEncoder().encode(settings), key: "cache/settings")
    }

    private init() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "active",
            kSecReturnData as String: true
        ]
        var value: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &value) == errSecSuccess,
           let data = value as? Data {
            lease = try? JSONDecoder().decode(NativeOfflineLease.self, from: data)
            if let bytes = try? rawRead("index") {
                if let saved = try? JSONDecoder().decode(Index.self, from: bytes), saved.version == 1 { index = saved }
            }
        }
    }

    func canContinue(subject: String? = nil) -> Bool {
        !denied && lease?.permits(origin: origin, subject: subject) == true
            && ((try? file("get/supporter/schedule")).map { manager.fileExists(atPath: $0.path) } ?? false)
    }

    func verify(token: String, subject: String, schedule: Data) throws {
        let page = try JSONDecoder().decode(NativeSupporterSchedule.self, from: schedule)
        guard page.status == "linked", let linkID = page.linkId, UUID(uuidString: linkID) != nil else {
            throw NativeOfflineError.notPrepared
        }
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { throw NativeOfflineError.locked }
        var encoded = String(parts[1]).replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded),
              let claims = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let issuer = claims["iss"] as? String, !issuer.isEmpty,
              claims["sub"] as? String == subject else { throw NativeOfflineError.locked }
        // Called only AFTER an authenticated, linked schedule response succeeds.
        let sameIdentity = lease?.subject == subject && lease?.issuer == issuer
            && lease?.origin == origin && lease?.linkId == linkID
        if !sameIdentity {
            try clear()
            let key = SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
            lease = .init(version: 1, issuer: issuer, subject: subject, origin: origin,
                          verifiedAt: Date(), locked: false, key: key)
            lease?.linkId = linkID
        } else {
            lease?.verifiedAt = Date()
            lease?.locked = false
        }
        try saveLease()
        if let namespace { UserDefaults.standard.removeObject(forKey: "pixl.native.offline.denied." + namespace) }
        try write(schedule, key: "get/supporter/schedule")
    }

    func read(_ key: String, subject: String? = nil) throws -> Data? {
        guard !denied, lease?.permits(origin: origin, subject: subject) == true else { throw NativeOfflineError.locked }
        return try rawRead(key)
    }

    func date(_ key: String) -> Date? { index.entries[key]?.date }

    func write(_ data: Data?, key: String) throws {
        guard !denied, lease?.permits(origin: origin, subject: nil) == true else { throw NativeOfflineError.locked }
        if let data {
            if key.hasPrefix("outbox/") || key.hasPrefix("draft/") {
                if !(lease?.pendingKeys ?? []).contains(key) {
                    lease?.pendingKeys = (lease?.pendingKeys ?? []) + [key]
                    try saveLease()
                }
            }
            let files = (try? manager.contentsOfDirectory(at: directory(), includingPropertiesForKeys: [.fileSizeKey])) ?? []
            let occupied = files.reduce(0) { $0 + ((try? $1.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
            let previous = (try? file(key).resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            let total = occupied - previous + data.count + 28
            let isPending = key.hasPrefix("outbox/") || key.hasPrefix("draft/")
            // Small management metadata can use the reserve too, so cleanup can
            // finish while protected pending work exceeds the normal cache cap.
            let budget = (isPending || key == "cache/settings")
                ? NativeOfflineStoragePolicy.pendingBudget : NativeOfflineStoragePolicy.cacheBudget
            if total > budget {
                var remaining = total
                for (candidate, entry) in index.entries.sorted(by: { $0.value.date < $1.value.date }) {
                    guard remaining > budget else { break }
                    guard candidate != key,
                          NativeOfflineStoragePolicy.isDisposable(candidate, knownKeys: knownKeys) else { continue }
                    if manager.fileExists(atPath: try file(candidate).path) { try manager.removeItem(at: file(candidate)) }
                    index.entries.removeValue(forKey: candidate)
                    remaining -= entry.bytes
                }
                guard remaining <= budget else { throw NativeOfflineError.full }
            }
            // Catalog first: interruption may leave an empty catalog entry but
            // never an undiscoverable queued command after a successful write.
            index.entries[key] = Entry(date: Date(), bytes: data.count)
            try saveIndex()
            try rawWrite(data, key: key)
        } else {
            // Delete the file first. An interrupted delete cannot resurrect work.
            if manager.fileExists(atPath: try file(key).path) { try manager.removeItem(at: file(key)) }
            index.entries.removeValue(forKey: key)
            try saveIndex()
            if var updatedLease = lease,
               var pendingKeys = updatedLease.pendingKeys,
               pendingKeys.contains(key) {
                pendingKeys.removeAll { $0 == key }
                updatedLease.pendingKeys = pendingKeys
                lease = updatedLease
                try saveLease()
            }
        }
    }

    /// Session expiry locks, rather than discards, uncertain mutations.
    func lock() throws {
#if os(iOS)
        NativeLocalEventReminderCoordinator.shared.cancel()
#endif
        if let namespace { UserDefaults.standard.set(true, forKey: "pixl.native.offline.denied." + namespace) }
        lease?.locked = true
        try saveLease()
    }

    /// Explicit sign-out / accepted deletion / confirmed account revocation only.
    /// Deletion receipts and support references live elsewhere and are untouched.
    func clear() throws {
#if os(iOS)
        NativeLocalEventReminderCoordinator.shared.cancel(resetSelection: true)
#endif
        // Deny continuation even if later file cleanup is interrupted.
        if let namespace { UserDefaults.standard.set(true, forKey: "pixl.native.offline.denied." + namespace) }
        if lease != nil {
            lease?.locked = true
            try saveLease()
        }
        if let directory = try? directory(), manager.fileExists(atPath: directory.path) {
            try manager.removeItem(at: directory)
        }
        if let subject {
            let prefix = "pixl-native-event-pending:\(subject):"
            for key in UserDefaults.standard.dictionaryRepresentation().keys where key.hasPrefix(prefix) {
                UserDefaults.standard.removeObject(forKey: key)
            }
        }
        let status = SecItemDelete([
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "active"
        ] as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw NativeOfflineError.protectedStorage }
        lease = nil
        index = Index()
    }

    private func saveLease() throws {
        guard let lease else { return }
        let data = try JSONEncoder().encode(lease)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: "active"
        ]
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var item = query
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw NativeOfflineError.protectedStorage }
        } else if status != errSecSuccess { throw NativeOfflineError.protectedStorage }
    }

    private func directory() throws -> URL {
        guard let namespace else { throw NativeOfflineError.locked }
        return try manager.url(for: .applicationSupportDirectory, in: .userDomainMask,
                               appropriateFor: nil, create: true)
            .appendingPathComponent("NativeOffline", isDirectory: true)
            .appendingPathComponent(namespace, isDirectory: true)
    }
    private func file(_ key: String) throws -> URL {
        try directory().appendingPathComponent(Self.digest(key) + ".sealed")
    }
    private func rawRead(_ key: String) throws -> Data? {
        let path = try file(key)
        guard manager.fileExists(atPath: path.path) else { return nil }
        guard let lease else { throw NativeOfflineError.locked }
        do {
            let box = try AES.GCM.SealedBox(combined: Data(contentsOf: path))
            return try AES.GCM.open(box, using: SymmetricKey(data: lease.key),
                                    authenticating: Data((namespace! + "|" + key).utf8))
        } catch { throw NativeOfflineError.corrupt }
    }
    private func rawWrite(_ data: Data, key: String) throws {
        guard let lease, let namespace else { throw NativeOfflineError.locked }
        var directory = try directory()
        try manager.createDirectory(at: directory, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try directory.setResourceValues(values)
        let encrypted = try AES.GCM.seal(data, using: SymmetricKey(data: lease.key),
                                        authenticating: Data((namespace + "|" + key).utf8))
        guard let combined = encrypted.combined else { throw NativeOfflineError.protectedStorage }
        try combined.write(to: file(key), options: .atomic)
#if os(iOS)
        try manager.setAttributes([.protectionKey: FileProtectionType.complete], ofItemAtPath: file(key).path)
#endif
    }
    private func saveIndex() throws { try rawWrite(JSONEncoder().encode(index), key: "index") }
    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
