import Foundation

@main
enum NativeReminderBehaviorChecks {
    @MainActor
    static func main() async throws {
        // Only a deadlock watchdog; task ordering/assertions use explicit gates.
        DispatchQueue.global().asyncAfter(deadline: .now() + 45) {
            fatalError("Reminder behavioral checks stalled at an await boundary.")
        }
        try await overlappingSave()
        try await freshScheduleAfterSync()
        try await failedEarlierDownload()
        try await cancelledPreparation()
        await staleWorkerCannotClearNewWorker()
        try await coalescedSubmission()
        try await lateAcceptanceAfterCancellation()
        try await taskCancellationDuringAcceptance()
        try await authorityChangesAtReads()
        try await acceptanceFailureAndRetry()
        try await verifiedWorkspaceAuthority()
        try await consumedReminderCannotReplay()
        try await editedKickoffReplacesAcceptedRequest()
        print("PASS: 13 deterministic reminder behavior checks (fake notification center; not OS delivery).")
    }

    @MainActor
    static func overlappingSave() async throws {
        let fixture = ReminderPreparationFixture()
        defer { fixture.cleanup() }
        fixture.events = [.event("old")]
        let coordinator = fixture.makeCoordinator()
        try await coordinator.activate(preferences: fixture.preferences)
        let gate = ReminderGate()
        fixture.downloadGates["old"] = gate
        let worker = NativeEventPreparationWorker()
        worker.request(force: false) { await fixture.operation(coordinator) }
        await gate.waitUntilEntered()
        // A different save finishes while the initial snapshot is downloading.
        fixture.events.append(.event("new"))
        worker.request(force: true) { await fixture.operation(coordinator) }
        worker.request(force: true) { await fixture.operation(coordinator) }
        gate.open()
        await worker.waitForIdle()
        precondition(fixture.passes == 2 && fixture.scheduleReads == 2)
        precondition(fixture.downloadCalls == ["old", "new"])
        precondition(fixture.reconciliations == 2)
        precondition(fixture.center.submissions.count == 4, "Two types per event, no resubmitted old alert.")
        precondition(Set(fixture.center.submissions.map(\.identifier)).count == 4)
        print("PASS: a save during preparation triggers one fresh pass, without duplicate submission")
    }

    @MainActor
    static func freshScheduleAfterSync() async throws {
        let fixture = ReminderPreparationFixture()
        defer { fixture.cleanup() }
        fixture.events = [.event("old")]
        fixture.syncAdds = [.event("synced")]
        let coordinator = fixture.makeCoordinator()
        try await coordinator.activate(preferences: fixture.preferences)
        let result = try await fixture.run(coordinator)
        precondition(fixture.scheduleReads == 2 && result.prepared == 2)
        precondition(fixture.downloadCalls == ["old", "synced"])
        precondition(fixture.center.accepted.count == 4)
        print("PASS: syncing a new card refreshes the verified schedule before selection")
    }

    @MainActor
    static func failedEarlierDownload() async throws {
        let fixture = ReminderPreparationFixture()
        defer { fixture.cleanup() }
        fixture.events = [.event("old-failure"), .event("removed"), .event("unpersisted"), .event("later")]
        fixture.failures = ["old-failure"]
        fixture.removed = ["removed"]
        fixture.unpersisted = ["unpersisted"]
        let coordinator = fixture.makeCoordinator()
        try await coordinator.activate(preferences: fixture.preferences)
        let result = try await fixture.run(coordinator)
        precondition(result.failed == 2 && result.removed == 1 && result.prepared == 1)
        precondition(fixture.downloadCalls == ["old-failure", "unpersisted", "later"])
        precondition(fixture.reconciliations == 1)
        precondition(fixture.center.accepted.count == 2)
        precondition(fixture.center.accepted.allSatisfy { $0.identifier.contains("later|") })
        print("PASS: a failed download cannot starve later events or override removed-download choices")
    }

    @MainActor
    static func cancelledPreparation() async throws {
        let fixture = ReminderPreparationFixture()
        defer { fixture.cleanup() }
        fixture.events = [.event("blocked"), .event("must-not-start")]
        let coordinator = fixture.makeCoordinator()
        try await coordinator.activate(preferences: fixture.preferences)
        let gate = ReminderGate()
        fixture.downloadGates["blocked"] = gate
        let worker = NativeEventPreparationWorker()
        let finished = ReminderGate()
        worker.request(force: true) {
            await fixture.operation(coordinator)
            finished.open()
        }
        await gate.waitUntilEntered()
        worker.request(force: true) { await fixture.operation(coordinator) }
        worker.cancel()
        coordinator.cancel(disable: true, resetSelection: true)
        fixture.scope = "account-b"
        gate.open()
        await finished.wait()
        precondition(fixture.passes == 1 && fixture.cancelledPasses == 1)
        precondition(fixture.downloadCalls == ["blocked"])
        precondition(fixture.progressWrites == 0 && fixture.reconciliations == 0)
        precondition(fixture.center.accepted.isEmpty && !worker.isRunning)
        print("PASS: cancellation/account changes discard pending refresh and late download work")
    }

    @MainActor
    static func staleWorkerCannotClearNewWorker() async {
        let worker = NativeEventPreparationWorker()
        let old = ReminderGate(), new = ReminderGate(), oldFinished = ReminderGate()
        var newPasses = 0
        worker.request(force: false) { await old.wait(); oldFinished.open() }
        await old.waitUntilEntered()
        worker.cancel()
        worker.request(force: false) { newPasses += 1; await new.wait() }
        await new.waitUntilEntered()
        old.open()
        await oldFinished.wait()
        precondition(worker.isRunning, "A cancelled worker cannot clear its replacement.")
        new.open()
        await worker.waitForIdle()
        precondition(newPasses == 1 && !worker.isRunning)
        print("PASS: late worker completion cannot clear a replacement worker")
    }

    @MainActor
    static func coalescedSubmission() async throws {
        let fixture = ReminderPreparationFixture()
        defer { fixture.cleanup() }
        fixture.events = [.event("ready"), .event("ready")]
        fixture.downloaded = ["ready"]; fixture.readable = ["ready"]
        let coordinator = fixture.makeCoordinator()
        let gate = ReminderGate()
        fixture.center.addGate = gate
        let activation = Task { try await coordinator.activate(preferences: fixture.preferences) }
        await gate.waitUntilEntered()
        precondition(coordinator.status.isEmpty, "Do not claim saved before notification-center acceptance.")
        for _ in 0..<5 { await coordinator.reconcile() }
        gate.open()
        try await activation.value
        await coordinator.reconcile()
        precondition(fixture.center.submissions.count == 2 && fixture.center.pending.count == 2)
        print("PASS: overlapping reconciliations and duplicate events submit each unchanged request once")
    }

    @MainActor
    static func lateAcceptanceAfterCancellation() async throws {
        let fixture = ReminderPreparationFixture()
        defer { fixture.cleanup() }
        fixture.events = [.event("old")]
        fixture.downloaded = ["old"]; fixture.readable = ["old"]
        let unrelated = NativeEventReminderRequest(identifier: "other-feature", title: "", body: "", fire: nil)
        let tool = NativeEventReminderRequest(identifier: NativeLocalReminderEnvironment.toolReminderPrefix + "kept",
                                              title: "", body: "", fire: nil)
        fixture.center.pending = [unrelated.identifier: unrelated, tool.identifier: tool]
        let coordinator = fixture.makeCoordinator()
        let gate = ReminderGate()
        fixture.center.addGate = gate
        let activation = Task { try await coordinator.activate(preferences: fixture.preferences) }
        await gate.waitUntilEntered()
        coordinator.cancel(disable: true, resetSelection: true)
        fixture.scope = "account-b"
        gate.open()
        try await activation.value
        precondition(Set(fixture.center.pending.keys) == Set([unrelated.identifier, tool.identifier]))
        precondition(!coordinator.isSelected && coordinator.status.isEmpty)
        print("PASS: late notification acceptance is removed after account cancellation; other categories survive")
    }

    @MainActor
    static func taskCancellationDuringAcceptance() async throws {
        let fixture = ReminderPreparationFixture()
        defer { fixture.cleanup() }
        fixture.events = [.event("ready")]
        fixture.downloaded = ["ready"]; fixture.readable = ["ready"]
        let coordinator = fixture.makeCoordinator()
        let gate = ReminderGate()
        fixture.center.addGate = gate
        let activation = Task { try await coordinator.activate(preferences: fixture.preferences) }
        await gate.waitUntilEntered()
        activation.cancel()
        gate.open()
        try await activation.value
        precondition(fixture.center.accepted.count == 1 && fixture.center.pending.isEmpty)
        precondition(coordinator.status.isEmpty)
        print("PASS: task cancellation removes an accepted late request rather than leaving an orphan")
    }

    @MainActor
    static func authorityChangesAtReads() async throws {
        for atAuthorization in [true, false] {
            let fixture = ReminderPreparationFixture()
            defer { fixture.cleanup() }
            fixture.events = [.event("ready")]
            fixture.downloaded = ["ready"]; fixture.readable = ["ready"]
            let coordinator = fixture.makeCoordinator()
            let gate = ReminderGate()
            if atAuthorization { fixture.center.authorizationGate = gate }
            else { fixture.center.pendingGate = gate }
            let activation = Task { try await coordinator.activate(preferences: fixture.preferences) }
            await gate.waitUntilEntered()
            fixture.authorized = false
            fixture.scope = "account-b"
            gate.open()
            try await activation.value
            precondition(fixture.center.submissions.isEmpty && coordinator.status.isEmpty)
        }
        print("PASS: authorization and pending-request awaits recheck account authority before submitting")
    }

    @MainActor
    static func acceptanceFailureAndRetry() async throws {
        let fixture = ReminderPreparationFixture()
        defer { fixture.cleanup() }
        fixture.events = [.event("ready")]
        fixture.downloaded = ["ready"]; fixture.readable = ["ready"]
        let coordinator = fixture.makeCoordinator()
        fixture.center.rejected = true
        try await coordinator.activate(preferences: fixture.preferences)
        precondition(coordinator.errorMessage != nil && coordinator.status.isEmpty)
        precondition(fixture.center.pending.isEmpty)
        fixture.center.rejected = false
        await coordinator.reconcile()
        precondition(coordinator.errorMessage == nil && fixture.center.pending.count == 2)
        let count = fixture.center.submissions.count
        await coordinator.reconcile()
        precondition(fixture.center.submissions.count == count)
        print("PASS: rejected notification acceptance remains retryable and never claims readiness")
    }

    @MainActor
    static func verifiedWorkspaceAuthority() async throws {
        let fixture = ReminderPreparationFixture()
        defer { fixture.cleanup() }
        fixture.events = [.event("readable"), .event("unreadable"), .event("unprepared"), .event("finished", status: "completed")]
        fixture.downloaded = ["readable", "unreadable", "finished"]
        fixture.readable = ["readable", "unprepared", "finished"]
        fixture.scheduleLinkID = "different-link"
        let coordinator = fixture.makeCoordinator()
        try await coordinator.activate(preferences: fixture.preferences)
        precondition(fixture.center.submissions.isEmpty)
        fixture.scheduleLinkID = fixture.linkID
        await coordinator.reconcile()
        precondition(fixture.center.pending.count == 2)
        precondition(fixture.center.accepted.allSatisfy { $0.identifier.hasPrefix(NativeLocalEventReminderCoordinator.prefix + "readable|") })
        fixture.center.authorized = false
        await coordinator.reconcile()
        precondition(fixture.center.pending.isEmpty)
        print("PASS: link, prepared catalog, readable workspace, completion and OS permission remain authoritative")
    }

    @MainActor
    static func consumedReminderCannotReplay() async throws {
        let fixture = ReminderPreparationFixture()
        defer { fixture.cleanup() }
        fixture.events = [.event("ready")]
        fixture.downloaded = ["ready"]; fixture.readable = ["ready"]
        let coordinator = fixture.makeCoordinator()
        try await coordinator.activate(preferences: fixture.preferences)
        fixture.now = ISO8601DateFormatter().date(from: "2026-11-12T17:05:00Z")!
        fixture.center.pending = [:] // The OS no longer reports the fired requests.
        await coordinator.reconcile()
        coordinator.cancel(disable: true)
        precondition((fixture.defaults.object(forKey: NativeLocalEventReminderCoordinator.resumePushKey(scope: "account-a")) as? Date)! > fixture.now)
        try await coordinator.activate(preferences: fixture.preferences)
        precondition(fixture.center.submissions.count == 2 && fixture.center.pending.isEmpty)
        print("PASS: consumed reminders do not replay and preserve the push-resume exclusion window")
    }

    @MainActor
    static func editedKickoffReplacesAcceptedRequest() async throws {
        let fixture = ReminderPreparationFixture()
        defer { fixture.cleanup() }
        let event = ReminderPreparationFixture.Event.event("edited")
        fixture.events = [event]
        fixture.downloaded = ["edited"]; fixture.readable = ["edited"]
        let coordinator = fixture.makeCoordinator()
        try await coordinator.activate(preferences: fixture.preferences)
        let original = fixture.center.pending
        fixture.events = [.init(shareToken: event.shareToken, id: event.id, date: event.date,
                                time: "20:00", title: event.title, type: event.type,
                                status: event.status, timezone: event.timezone)]
        await coordinator.reconcile()
        precondition(Set(original.keys) == Set(fixture.center.pending.keys))
        precondition(fixture.center.submissions.count == 3, "Only the changed one-hour request is replaced.")
        let key = NativeLocalEventReminderCoordinator.prefix + event.id + "|" + event.date + "|one_hour"
        guard let before = original[key]?.fire, let after = fixture.center.pending[key]?.fire else {
            preconditionFailure("The one-hour request must exist before and after a kickoff edit.")
        }
        precondition(after == before.addingTimeInterval(7200))
        print("PASS: kickoff edits replace the changed request, retaining IDs and unchanged event-day acceptance")
    }
}
