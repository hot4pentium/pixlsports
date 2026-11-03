@main
struct NativeOfflineStoragePolicyChecks {
    static func main() {
        typealias Policy = NativeOfflineStoragePolicy
        let keys: Set<String> = [
            "get/supporter/schedule", "get/supporter/profile", "cache/settings",
            "workspace/queued", "workspace/draft", "workspace/clean",
            "get/supporter/hype-card", "outbox/queued", "draft/draft",
            "pending/hype-card-settings"
        ]
        for key in ["get/supporter/schedule", "get/supporter/profile", "cache/settings",
                    "outbox/queued", "draft/draft", "pending/hype-card-settings",
                    "workspace/queued", "workspace/draft",
                    "unknown/future-recovery", "get/supporter/schedule?variant=1"] {
            precondition(!Policy.isDisposable(key, knownKeys: keys), "Recovery record must survive: \(key)")
        }
        precondition(Policy.isDisposable("workspace/clean", knownKeys: keys))
        precondition(Policy.isDisposable("get/supporter/hype-card", knownKeys: keys))
        precondition(Policy.isDisposable("get/supporter/hype-card/cutout-photo?size=small", knownKeys: keys))

        // A broken index must not hide work: callers union the Keychain pending
        // catalog with indexed keys, without decoding (possibly corrupt) drafts.
        let recoveryCatalog: Set<String> = ["outbox/unindexed", "draft/unreadable"]
        precondition(!Policy.isDisposable("workspace/unindexed", knownKeys: recoveryCatalog))
        precondition(!Policy.isDisposable("workspace/unreadable", knownKeys: recoveryCatalog))
        // Re-evaluate at execution time, not from the confirmation's stale list.
        var beforeConfirmation: Set<String> = ["workspace/just-edited"]
        precondition(Policy.isDisposable("workspace/just-edited", knownKeys: beforeConfirmation))
        beforeConfirmation.insert("draft/just-edited")
        precondition(!Policy.isDisposable("workspace/just-edited", knownKeys: beforeConfirmation))

        // Account catalogs remain independent; neither account may enumerate or
        // mutate the other's keys. The vault additionally enforces subject/lease.
        let accountA: Set<String> = ["workspace/same-token", "outbox/same-token"]
        let accountB: Set<String> = ["workspace/same-token"]
        precondition(!Policy.isDisposable("workspace/same-token", knownKeys: accountA))
        precondition(Policy.isDisposable("workspace/same-token", knownKeys: accountB))
        precondition(Policy.pendingEvents(keys: accountA) == ["same-token"])
        precondition(Policy.pendingEvents(keys: accountB).isEmpty)
        precondition(Policy.isPending("pending/hype-card-settings"))
        precondition(Policy.pendingEvents(keys: ["pending/hype-card-settings"]).isEmpty,
                     "Account settings drafts must not be mistaken for an Event Card draft.")
        precondition(Policy.pendingBudget > Policy.cacheBudget)

        let lowSpace = NativeOfflineStorageSnapshot(totalBytes: 100, removableBytes: 20,
                                                    deviceAvailableBytes: 1, events: [])
        precondition(lowSpace.lowStorage && lowSpace.protectedBytes == 80)
        let nearBudget = NativeOfflineStorageSnapshot(totalBytes: Policy.cacheBudget, removableBytes: 0,
                                                      deviceAvailableBytes: nil, events: [])
        precondition(nearBudget.lowStorage)
        let normal = NativeOfflineStorageSnapshot(totalBytes: 100, removableBytes: 40,
                                                  deviceAvailableBytes: 200 * 1_024 * 1_024, events: [])
        precondition(!normal.lowStorage && normal.protectedBytes == 60)
        // An ordinary Event Card load is NOT the cancelled preparation worker.
        // A response started before removal must not cache or return old data.
        var downloads = NativeOfflineDownloadEpochs()
        let ordinaryCardRequest = downloads.stamp(for: "clean")
        let otherEventRequest = downloads.stamp(for: "other")
        precondition(downloads.accepts(ordinaryCardRequest, for: "clean"))
        downloads.invalidate(event: "clean")
        precondition(!downloads.accepts(ordinaryCardRequest, for: "clean"))
        precondition(downloads.accepts(otherEventRequest, for: "other"))
        let explicitReopen = downloads.stamp(for: "clean")
        precondition(downloads.accepts(explicitReopen, for: "clean"),
                     "An explicit open after removal must be allowed to download again.")
        downloads.invalidate(event: nil)
        precondition(!downloads.accepts(explicitReopen, for: "clean"))
        precondition(!downloads.accepts(otherEventRequest, for: "other"))
        let downloadAgain = downloads.stamp(for: "other")
        precondition(downloads.accepts(downloadAgain, for: "other"))
        // Repeated individual and bulk removals must never revive an old stamp.
        downloads.invalidate(event: "other")
        downloads.invalidate(event: nil)
        precondition(!downloads.accepts(downloadAgain, for: "other"))
        precondition(!downloads.accepts(ordinaryCardRequest, for: "clean"))
        print("Offline storage policy: pending work, recovery catalog, account catalogs, low storage, and overlapping download/removal checks passed.")
    }
}
