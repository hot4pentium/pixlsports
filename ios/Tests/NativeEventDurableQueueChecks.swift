import Foundation

private struct QueueCommand: Codable, Equatable {
    var mutationID: String
    var revision: Int
    var attempted: Bool
}

@main
struct NativeEventDurableQueueChecks {
    static func main() throws {
        let suiteName = "NativeEventDurableQueueChecks-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }
        let key = "event-outbox"

        let first = QueueCommand(mutationID: "tap-1", revision: 7, attempted: true)
        let second = QueueCommand(mutationID: "tap-2", revision: 7, attempted: false)
        let queue = NativeEventDurableQueue<QueueCommand>(storageKey: key, defaults: defaults)
        try queue.save(commands: [first, second], conflictBlocked: false)

        // Simulate process suspension after sending the first tap but before
        // receiving its response. Relaunch must replay the same command.
        let relaunched = NativeEventDurableQueue<QueueCommand>(storageKey: key, defaults: defaults)
        precondition(relaunched.commands == [first, second])
        precondition(!relaunched.conflictBlocked)

        var next = second
        next.revision = 8
        try relaunched.save(commands: [next], conflictBlocked: false)
        let interruptedBatch = NativeEventDurableQueue<QueueCommand>(storageKey: key, defaults: defaults)
        precondition(interruptedBatch.commands == [QueueCommand(mutationID: "tap-2", revision: 8, attempted: false)])

        try interruptedBatch.save(commands: [QueueCommand(mutationID: "tap-2", revision: 8, attempted: true)],
                                  conflictBlocked: true)
        let conflictRelaunch = NativeEventDurableQueue<QueueCommand>(storageKey: key, defaults: defaults)
        precondition(conflictRelaunch.conflictBlocked)
        precondition(conflictRelaunch.commands.first?.attempted == true)
        conflictRelaunch.removeAll()
        precondition(conflictRelaunch.commands.isEmpty)
        precondition(!conflictRelaunch.conflictBlocked)
        print("Native Event durable queue interruption checks passed.")
    }
}
