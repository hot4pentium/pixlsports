import Foundation
import CryptoKit
import Security

/// Visitor QR credentials are encrypted too. Never put them in preferences.
@MainActor
struct NativeLiveTapOutboxStorage {
    private var directory: URL {
        get throws {
            let origin = try NativeAccountLinkClient.apiOrigin().absoluteString
            let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("LiveTapOutbox", isDirectory: true)
                .appendingPathComponent(Self.digest(origin), isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            var folder = root
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try folder.setResourceValues(values)
            return folder
        }
    }

    private static func digest(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    private func encryptionKey() throws -> SymmetricKey {
        let origin = try NativeAccountLinkClient.apiOrigin().absoluteString
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "pixl.live-taps.outbox." + Self.digest(origin),
            kSecAttrAccount as String: "encryption-key",
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data, data.count == 32 {
            return SymmetricKey(data: data)
        }
        guard status == errSecItemNotFound else { throw NativeOfflineError.protectedStorage }
        // Never overwrite an existing encrypted queue with a new unreadable key.
        guard try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).isEmpty else {
            throw NativeOfflineError.protectedStorage
        }
        let key = SymmetricKey(size: .bits256)
        var item = query
        item.removeValue(forKey: kSecReturnData as String)
        item.removeValue(forKey: kSecMatchLimit as String)
        item[kSecValueData as String] = key.withUnsafeBytes { Data($0) }
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else {
            throw NativeOfflineError.protectedStorage
        }
        return key
    }

    func load() throws -> [String: SavedLiveTapSession] {
        let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "queue" }
        guard !files.isEmpty else { return [:] }
        let key = try encryptionKey()
        var sessions: [String: SavedLiveTapSession] = [:]
        for file in files {
            let name = file.deletingPathExtension().lastPathComponent
            let sealed = try AES.GCM.SealedBox(combined: Data(contentsOf: file))
            let data = try AES.GCM.open(sealed, using: key, authenticating: Data(name.utf8))
            let session = try JSONDecoder().decode(SavedLiveTapSession.self, from: data)
            guard session.version == 1, Self.digest(session.scope) == name else { throw NativeOfflineError.corrupt }
            sessions[session.scope] = session
        }
        return sessions
    }

    func save(_ session: SavedLiveTapSession) throws {
        let name = Self.digest(session.scope)
        let sealed = try AES.GCM.seal(
            JSONEncoder().encode(session), using: encryptionKey(), authenticating: Data(name.utf8)
        )
        guard let data = sealed.combined else { throw NativeOfflineError.protectedStorage }
        try data.write(to: directory.appendingPathComponent(name + ".queue"),
                       options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    func remove(_ scope: String) throws {
        let file = try directory.appendingPathComponent(Self.digest(scope) + ".queue")
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
}
