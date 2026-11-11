/// The foreground runtime uses this worker too. A forced refresh received
/// during a download must run after that pass, not disappear behind its task.
@MainActor
final class NativeEventPreparationWorker {
    private var task: Task<Void, Never>?
    private var pending: (@MainActor () async -> Void)?
    private var generation = 0
    var isRunning: Bool { task != nil }

    func request(force: Bool, operation: @escaping @MainActor () async -> Void) {
        guard !Task.isCancelled else { return }
        guard task == nil else {
            if force { pending = operation }
            return
        }
        start(operation)
    }

    func cancel() {
        pending = nil
        generation += 1
        task?.cancel()
        task = nil
    }

    private func start(_ operation: @escaping @MainActor () async -> Void) {
        generation += 1
        let revision = generation
        task = Task {
            await operation()
            guard generation == revision else { return }
            task = nil
            if let next = pending {
                pending = nil
                start(next)
            }
        }
    }

    /// Also used by the deterministic checks; no sleep/polling interval.
    func waitForIdle() async {
        while let current = task { await current.value }
    }
}

/// Shared production orchestration, independent of Clerk and transport. The
/// runtime supplies verified reads and checks persisted workspace bytes; tests
/// suspend these same await boundaries without contacting a real account.
@MainActor
enum NativeEventPreparationFlow {
    enum Availability { case removed, ready, download }
    struct Outcome {
        var selected = 0
        var prepared = 0
        var removed = 0
        var failed = 0
    }

    static func run<Page, Event>(
        initialPage: Page,
        synchronize: () async throws -> Bool,
        refreshSchedule: () async throws -> Page,
        isCurrent: () -> Bool,
        select: (Page) -> [Event],
        availability: (Event) throws -> Availability,
        download: (Event) async throws -> Void,
        progress: (Outcome) -> Void,
        reconcile: () async throws -> Void
    ) async throws -> Outcome {
        func check() throws {
            try Task.checkCancellation()
            guard isCurrent() else { throw CancellationError() }
        }
        try check()
        let changed = try await synchronize()
        try check()
        // A successful sync may have introduced the card absent from the
        // initial page. Only a fresh verified page can authorize its download.
        let page: Page
        if changed { page = try await refreshSchedule() }
        else { page = initialPage }
        try check()
        let events = select(page)
        var result = Outcome(selected: events.count)
        for event in events {
            try check()
            switch try availability(event) {
            case .removed:
                result.removed += 1
                continue
            case .ready:
                result.prepared += 1
                continue
            case .download: break
            }
            do {
                try await download(event)
                try check()
                result.prepared += 1
            } catch is CancellationError {
                throw CancellationError()
            } catch {
                // An earlier unavailable card cannot starve later reminders.
                try check()
                result.failed += 1
            }
            progress(result)
        }
        try check()
        try await reconcile()
        try check()
        return result
    }
}
