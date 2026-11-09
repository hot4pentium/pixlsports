/// Reminder inputs only. Scores, tracker revisions, Prep and sync metadata
/// cannot change a future opening. This cache is an optimization, never authority.
struct NativeReminderInvalidationPolicy {
    struct Workspace: Equatable {
        let linkID: String
        let complete: Bool
    }
    struct ToolState: Equatable {
        let complete: Bool
        let unreadable: Bool
    }
    struct Impact {
        let routine: Bool
        let availability: Bool
        static let all = Impact(routine: true, availability: true)
        static let none = Impact(routine: false, availability: false)
    }
    private var scope: String?
    private var workspaces: [String: Workspace] = [:]
    private var tools: [String: ToolState] = [:]

    mutating func reset(scope: String?) {
        self.scope = scope
        workspaces = [:]
        tools = [:]
    }

    mutating func cache(key: String, scope: String?, workspace: Workspace?) -> Impact {
        if self.scope != scope { reset(scope: scope) }
        if key == "get/supporter/schedule" { return .all }
        guard key.hasPrefix("workspace/") else { return .none }
        let token = String(key.dropFirst(10))
        // Missing/failed decoding must retain the conservative rebuild path.
        guard let workspace else {
            workspaces.removeValue(forKey: token)
            return .all
        }
        let changed = workspaces[token] != workspace
        workspaces[token] = workspace
        return Impact(routine: changed, availability: changed)
    }

    mutating func tool(token: String, scope: String?, state: ToolState) -> Bool {
        if self.scope != scope { reset(scope: scope) }
        let changed = tools[token] != state
        tools[token] = state
        return changed
    }
}

#if DEBUG
/// Reset in the debugger before a scoring burst. Counts work, never identity,
/// score contents or timing-sensitive wall-clock samples.
struct NativeReminderWorkCounts {
    var rebuilds = 0
    var workspaceReads = 0
    var settingsQueries = 0
    var pendingQueries = 0
    var adds = 0
}
#endif
