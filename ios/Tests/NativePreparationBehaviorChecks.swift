/// Standard-library execution of the actual production preparation worker/pass.
/// Foundation/Apple notification tests are a separate suite.
@MainActor
private final class PreparationGate {
    private var entered = false
    private var opened = false
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private var arrivals: [CheckedContinuation<Void, Never>] = []
    func wait() async {
        entered = true
        arrivals.forEach { $0.resume() }
        arrivals.removeAll()
        if !opened { await withCheckedContinuation { waiting.append($0) } }
    }
    func reached() async {
        if !entered { await withCheckedContinuation { arrivals.append($0) } }
    }
    func open() {
        opened = true
        waiting.forEach { $0.resume() }
        waiting.removeAll()
    }
}

@MainActor
private final class PreparationFixture {
    enum Failure: Error { case download }
    var page = ["old"]
    var syncAdds: [String] = []
    var current = true
    var removed: Set<String> = []
    var cached: Set<String> = []
    var failures: Set<String> = []
    var gates: [String: PreparationGate] = [:]
    var refreshGate: PreparationGate?
    var reads = 0, passes = 0, reconciles = 0, progress = 0, cancelled = 0
    var downloads: [String] = []
    func read() -> [String] { reads += 1; return page }
    func run() async throws -> NativeEventPreparationFlow.Outcome {
        passes += 1
        return try await NativeEventPreparationFlow.run(
            initialPage: read(),
            synchronize: {
                guard !self.syncAdds.isEmpty else { return false }
                self.page += self.syncAdds
                self.syncAdds = []
                return true
            },
            refreshSchedule: {
                if let gate = self.refreshGate { self.refreshGate = nil; await gate.wait() }
                return self.read()
            },
            isCurrent: { self.current },
            select: { $0 },
            availability: {
                if self.removed.contains($0) { return .removed }
                return self.cached.contains($0) ? .ready : .download
            },
            download: { event in
                self.downloads.append(event)
                if let gate = self.gates.removeValue(forKey: event) { await gate.wait() }
                if self.failures.contains(event) { throw Failure.download }
                // The live closure authorizes and checks bytes before caching.
                guard self.current, !Task.isCancelled else { throw CancellationError() }
                self.cached.insert(event)
            },
            progress: { _ in self.progress += 1 },
            reconcile: { self.reconciles += 1 })
    }
    func operation() async {
        do { _ = try await run() }
        catch is CancellationError { cancelled += 1 }
        catch { preconditionFailure("Unexpected preparation failure: \(error)") }
    }
}

@main
enum NativePreparationBehaviorChecks {
    @MainActor
    static func main() async throws {
        let watchdog = Task.detached {
            do { try await Task.sleep(nanoseconds: 30_000_000_000) }
            catch { return }
            fatalError("Preparation behavior checks stalled.")
        }
        defer { watchdog.cancel() }
        try await syncRefreshesPage()
        try await failureDoesNotStarve()
        await overlappingSave()
        await cancellationDiscardsRefresh()
        await staleWorkerCannotClearReplacement()
        await accountChangeDuringRefresh()
        print("PASS: 6 production preparation behavior checks (standard-library; no Apple IO).")
    }

    @MainActor
    static func syncRefreshesPage() async throws {
        let fixture = PreparationFixture()
        fixture.syncAdds = ["new"]
        let outcome = try await fixture.run()
        precondition(fixture.reads == 2 && fixture.downloads == ["old", "new"])
        precondition(outcome.prepared == 2 && fixture.reconciles == 1)
        print("PASS: a successful sync refreshes the schedule before downloading")
    }

    @MainActor
    static func failureDoesNotStarve() async throws {
        let fixture = PreparationFixture()
        fixture.page = ["old", "removed", "later"]
        fixture.failures = ["old"]
        fixture.removed = ["removed"]
        let outcome = try await fixture.run()
        precondition(fixture.downloads == ["old", "later"])
        precondition(outcome.failed == 1 && outcome.removed == 1 && outcome.prepared == 1)
        precondition(fixture.reconciles == 1 && fixture.cached == ["later"])
        print("PASS: later downloads and reconciliation survive an earlier failure")
    }

    @MainActor
    static func overlappingSave() async {
        let fixture = PreparationFixture()
        let gate = PreparationGate()
        fixture.gates["old"] = gate
        let worker = NativeEventPreparationWorker()
        worker.request(force: false) { await fixture.operation() }
        await gate.reached()
        fixture.page.append("new")
        worker.request(force: true) { await fixture.operation() }
        worker.request(force: true) { await fixture.operation() }
        gate.open()
        await worker.waitForIdle()
        precondition(fixture.passes == 2 && fixture.reads == 2)
        precondition(fixture.downloads == ["old", "new"] && fixture.reconciles == 2)
        print("PASS: overlapping saves coalesce into one fresh pass")
    }

    @MainActor
    static func cancellationDiscardsRefresh() async {
        let fixture = PreparationFixture()
        fixture.page.append("must-not-start")
        let gate = PreparationGate(), finished = PreparationGate()
        fixture.gates["old"] = gate
        let worker = NativeEventPreparationWorker()
        worker.request(force: false) { await fixture.operation(); finished.open() }
        await gate.reached()
        worker.request(force: true) { await fixture.operation() }
        worker.cancel()
        fixture.current = false
        gate.open()
        await finished.wait()
        precondition(fixture.passes == 1 && fixture.cancelled == 1)
        precondition(fixture.downloads == ["old"] && fixture.progress == 0 && fixture.reconciles == 0)
        precondition(fixture.cached.isEmpty && !worker.isRunning)
        print("PASS: cancellation fences a late download and drops its queued refresh")
    }

    @MainActor
    static func staleWorkerCannotClearReplacement() async {
        let worker = NativeEventPreparationWorker()
        let old = PreparationGate(), new = PreparationGate(), finished = PreparationGate()
        var staleRestarts = 0
        worker.request(force: false) {
            await old.wait()
            worker.request(force: true) { staleRestarts += 1 }
            finished.open()
        }
        await old.reached()
        worker.cancel()
        worker.request(force: false) { await new.wait() }
        await new.reached()
        old.open()
        await finished.wait()
        precondition(worker.isRunning)
        new.open()
        await worker.waitForIdle()
        precondition(!worker.isRunning && staleRestarts == 0)
        print("PASS: stale completion cannot clear the replacement worker")
    }

    @MainActor
    static func accountChangeDuringRefresh() async {
        let fixture = PreparationFixture()
        fixture.syncAdds = ["new"]
        let gate = PreparationGate()
        fixture.refreshGate = gate
        let operation = Task { await fixture.operation() }
        await gate.reached()
        fixture.current = false
        gate.open()
        await operation.value
        precondition(fixture.cancelled == 1 && fixture.downloads.isEmpty)
        precondition(fixture.progress == 0 && fixture.reconciles == 0)
        print("PASS: account authority is rechecked after the fresh schedule read")
    }
}
