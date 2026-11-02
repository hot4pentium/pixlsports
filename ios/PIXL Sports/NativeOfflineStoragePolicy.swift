/// Shared by manual removal and budget eviction. Unknown records fail closed.
enum NativeOfflineStoragePolicy {
    static let cacheBudget = 59 * 1_024 * 1_024
    static let pendingBudget = 79 * 1_024 * 1_024

    static func pendingEvents(keys: Set<String>) -> Set<String> {
        Set(keys.compactMap { key in
            if key.hasPrefix("outbox/") { return String(key.dropFirst(7)) }
            if key.hasPrefix("draft/") { return String(key.dropFirst(6)) }
            return nil
        })
    }

    static func isDisposable(_ key: String, knownKeys: Set<String>) -> Bool {
        if key.hasPrefix("workspace/") {
            return !pendingEvents(keys: knownKeys).contains(String(key.dropFirst(10)))
        }
        return key == "get/supporter/hype-card" || key.hasPrefix("get/supporter/hype-card?")
            || key == "get/supporter/hype-card/cutout-photo"
            || key.hasPrefix("get/supporter/hype-card/cutout-photo?")
    }
}

struct NativeOfflineStorageSnapshot {
    struct Event: Identifiable {
        let id: String
        let title: String
        let detail: String
        let bytes: Int
        let ready: Bool
        let protected: Bool
    }
    let totalBytes: Int
    let removableBytes: Int
    let deviceAvailableBytes: Int64?
    let events: [Event]
    var protectedBytes: Int { max(0, totalBytes - removableBytes) }
    var lowStorage: Bool {
        totalBytes >= NativeOfflineStoragePolicy.cacheBudget
            || deviceAvailableBytes.map { $0 < 100 * 1_024 * 1_024 } == true
    }
}

/// Removal invalidates every older download for the affected event, including
/// ordinary Event Card loads that do not belong to the preparation worker.
/// These stamps are cache freshness only, never authentication authority.
struct NativeOfflineDownloadEpochs {
    struct Stamp: Equatable {
        let all: UInt64
        let event: UInt64
    }
    private var all: UInt64 = 0
    private var events: [String: UInt64] = [:]

    func stamp(for token: String) -> Stamp {
        Stamp(all: all, event: events[token] ?? 0)
    }
    func accepts(_ stamp: Stamp, for token: String) -> Bool {
        stamp == self.stamp(for: token)
    }
    mutating func invalidate(event token: String?) {
        if let token {
            events[token, default: 0] += 1
        } else {
            all += 1
            events.removeAll()
        }
    }
}
