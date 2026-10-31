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

/// Account-scoped durable storage for the native Event Card command outbox.
/// The model serializes commands in order and writes each queue transition before
/// sending a request or dropping an acknowledged command.
final class NativeEventDurableQueue<Command: Codable> {
    private struct Snapshot: Codable {
        var commands: [Command]
        var conflictBlocked: Bool
    }

    private let storageKey: String
    private let defaults: UserDefaults
    private(set) var commands: [Command]
    private(set) var conflictBlocked: Bool
    private(set) var storageError: Error?

    init(
        storageKey: String,
        defaults: UserDefaults = .standard,
        initialCommands: [Command] = [],
        initialConflictBlocked: Bool = false
    ) {
        self.storageKey = storageKey
        self.defaults = defaults
        if let data = defaults.data(forKey: storageKey),
           let saved = try? JSONDecoder().decode(Snapshot.self, from: data) {
            commands = saved.commands
            conflictBlocked = saved.conflictBlocked
        } else {
            commands = initialCommands
            conflictBlocked = initialConflictBlocked
            if defaults.data(forKey: storageKey) != nil && initialCommands.isEmpty {
                storageError = NativeEventDurableQueueError.unreadableQueue
            } else if !commands.isEmpty {
                do { try persist() } catch { storageError = error }
            }
        }
    }

    func save(commands: [Command], conflictBlocked: Bool) throws {
        let previousCommands = self.commands
        let previousConflictBlocked = self.conflictBlocked
        self.commands = commands
        self.conflictBlocked = conflictBlocked
        do {
            try persist()
        } catch {
            self.commands = previousCommands
            self.conflictBlocked = previousConflictBlocked
            throw error
        }
    }

    func removeAll() {
        commands.removeAll()
        conflictBlocked = false
        defaults.removeObject(forKey: storageKey)
        storageError = nil
    }

    private func persist() throws {
        guard !commands.isEmpty || conflictBlocked else {
            defaults.removeObject(forKey: storageKey)
            storageError = nil
            return
        }
        let data = try JSONEncoder().encode(
            Snapshot(commands: commands, conflictBlocked: conflictBlocked)
        )
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
