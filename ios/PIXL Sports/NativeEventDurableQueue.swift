import Foundation

struct NativePrepItem: Codable, Identifiable, Equatable {
    var id: String
    var label: String
    var completed: Bool
    var section: String?
}

struct NativeEventToolCommand: Codable {
    let shareToken: String
    let mutationId: String
    let linkId: String
    var expectedRevision: Int
    let kind: String
    var statId: String? = nil
    var athlete: Bool? = nil
    var opponent: Bool? = nil
    var yards: Int? = nil
    var delta: Int? = nil
    var soccerFormat: String? = nil
    var recordScore: Bool? = nil
    var outcome: String? = nil
    var items: [NativePrepItem]? = nil
    var notes: String? = nil
}

enum NativeTrackerRecoveryStatus: String, Codable, Equatable {
    case revisionConflict
    case linkChanged
    case gameChanged
    case gameFinished
    case serverRejected

    var permitsLocalEntry: Bool { self == .revisionConflict }

    var message: String {
        switch self {
        case .revisionConflict:
            "PIXL has a newer tracker version. Your actions are saved on this iPhone; keep tracking and try syncing again when ready."
        case .linkChanged:
            "This Event Card is now connected to a different PIXL account. Your iPhone changes are still here and will not be sent to that account."
        case .gameChanged:
            "The game on PIXL no longer matches this iPhone copy. Your pending actions are still here and will not be sent to a different game."
        case .gameFinished:
            "This game is already finished on PIXL. Your pending actions are still saved on this iPhone and were not sent to the final game."
        case .serverRejected:
            "PIXL could not apply a pending tracker action. Your changes are still saved on this iPhone; check the event before syncing again."
        }
    }
}

/// Account-scoped durable storage for the native Event Card command outbox.
/// The model serializes commands in order and writes each queue transition before
/// sending a request or dropping an acknowledged command.
final class NativeEventDurableQueue<Command: Codable> {
    private struct Snapshot: Codable {
        var version: Int? = 1
        var commands: [Command]
        var conflictBlocked: Bool
        var trackerRecoveryStatus: NativeTrackerRecoveryStatus? = nil
    }

    private let storageKey: String
    private let defaults: UserDefaults
    private let protectedRead: (() throws -> Data?)?
    private let protectedWrite: ((Data?) throws -> Void)?
    private(set) var commands: [Command]
    private(set) var conflictBlocked: Bool
    private(set) var trackerRecoveryStatus: NativeTrackerRecoveryStatus?
    private(set) var storageError: Error?

    init(
        storageKey: String,
        defaults: UserDefaults = .standard,
        initialCommands: [Command] = [],
        initialConflictBlocked: Bool = false,
        initialTrackerRecoveryStatus: NativeTrackerRecoveryStatus? = nil,
        protectedRead: (() throws -> Data?)? = nil,
        protectedWrite: ((Data?) throws -> Void)? = nil,
        validateLegacy: ((Data) throws -> Void)? = nil
    ) {
        self.storageKey = storageKey
        self.defaults = defaults
        self.protectedRead = protectedRead
        self.protectedWrite = protectedWrite
        let data: Data?
        let readProtected: Bool
        do {
            if let protectedData = try protectedRead?() { data = protectedData; readProtected = true }
            else {
                readProtected = false
                data = defaults.data(forKey: storageKey)
                if let data { try validateLegacy?(data) }
            }
        }
        catch {
            commands = []
            conflictBlocked = true
            trackerRecoveryStatus = nil
            storageError = error
            return
        }
        if let data,
           let saved = try? JSONDecoder().decode(Snapshot.self, from: data),
           saved.version == nil || saved.version == 1 {
            commands = saved.commands
            conflictBlocked = saved.conflictBlocked
            trackerRecoveryStatus = saved.trackerRecoveryStatus
            if protectedWrite != nil {
                do {
                    try persist()
                    defaults.removeObject(forKey: storageKey)
                } catch { storageError = error }
            }
        } else {
            commands = initialCommands
            conflictBlocked = initialConflictBlocked
            trackerRecoveryStatus = initialTrackerRecoveryStatus
            if data != nil && (readProtected || initialCommands.isEmpty) {
                storageError = NativeEventDurableQueueError.unreadableQueue
            } else if !commands.isEmpty {
                do {
                    try persist()
                    if protectedWrite != nil { defaults.removeObject(forKey: storageKey) }
                } catch { storageError = error }
            }
        }
    }

    func save(
        commands: [Command],
        conflictBlocked: Bool,
        trackerRecoveryStatus: NativeTrackerRecoveryStatus? = nil
    ) throws {
        let previousCommands = self.commands
        let previousConflictBlocked = self.conflictBlocked
        let previousTrackerRecoveryStatus = self.trackerRecoveryStatus
        self.commands = commands
        self.conflictBlocked = conflictBlocked
        self.trackerRecoveryStatus = trackerRecoveryStatus
        do {
            try persist()
        } catch {
            self.commands = previousCommands
            self.conflictBlocked = previousConflictBlocked
            self.trackerRecoveryStatus = previousTrackerRecoveryStatus
            throw error
        }
    }

    func removeAll() throws {
        try save(commands: [], conflictBlocked: false)
    }

    private func persist() throws {
        guard !commands.isEmpty || conflictBlocked || trackerRecoveryStatus != nil else {
            if let protectedWrite { try protectedWrite(nil) }
            defaults.removeObject(forKey: storageKey)
            storageError = nil
            return
        }
        let data = try JSONEncoder().encode(
            Snapshot(commands: commands, conflictBlocked: conflictBlocked,
                     trackerRecoveryStatus: trackerRecoveryStatus)
        )
        if let protectedWrite {
            try protectedWrite(data)
            storageError = nil
            return
        }
        defaults.set(data, forKey: storageKey)
        guard defaults.data(forKey: storageKey) == data else {
            throw NativeEventDurableQueueError.writeFailed
        }
        storageError = nil
    }
}

enum NativeEventDurableQueueError: LocalizedError {
    case unreadableQueue
    case writeFailed

    var errorDescription: String? {
        switch self {
        case .unreadableQueue:
            return "The saved Event Card changes could not be read. They have not been cleared."
        case .writeFailed:
            return "The pending Event Card change could not be stored on this iPhone."
        }
    }
}
