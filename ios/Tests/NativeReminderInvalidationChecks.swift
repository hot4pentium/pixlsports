@main
struct NativeReminderInvalidationChecks {
    static func main() {
        typealias Policy = NativeReminderInvalidationPolicy
        var policy = Policy()
        let live = Policy.Workspace(linkID: "verified-link", complete: false)
        let final = Policy.Workspace(linkID: "verified-link", complete: true)
        let tool = Policy.ToolState(complete: false, unreadable: false)
        var routine = 0
        var availability = 0
        func record(_ impact: Policy.Impact) {
            if impact.routine { routine += 1 }
            if impact.availability { availability += 1 }
        }

        // Eight selected future games plus the game currently being scored.
        for token in (0..<8).map({ "future-\($0)" }) + ["live"] {
            _ = policy.cache(key: "workspace/" + token, scope: "account-A", workspace: live)
            _ = policy.tool(token: token, scope: "account-A", state: tool)
        }
        // Real routing inputs: pending write, optimistic projection, response
        // cache, acknowledgement write, confirmed projection. No timer sleeps.
        for _ in 0..<40 {
            precondition(!policy.tool(token: "live", scope: "account-A", state: tool))
            record(policy.cache(key: "workspace/live", scope: "account-A", workspace: live))
            precondition(!policy.tool(token: "live", scope: "account-A", state: tool))
            for key in ["get/supporter/profile", "get/supporter/hype-card", "get/supporter/season-stats"] {
                record(policy.cache(key: key, scope: "account-A", workspace: nil))
            }
        }
        precondition(routine == 0 && availability == 0, "Warm scoring must do zero reminder rebuilds.")
        print("Warm 40-score burst, 8 future selections: 0 rebuilds, 0 future-workspace reads, 0 OS queries.")

        // Even a cold scoring path has constant work independent of burst length.
        policy.reset(scope: "account-A")
        for _ in 0..<40 {
            record(policy.cache(key: "workspace/live", scope: "account-A", workspace: live))
            if policy.tool(token: "live", scope: "account-A", state: tool) { availability += 1 }
        }
        precondition(routine == 1 && availability == 2)
        print("Cold 40-score burst: at most 1 routine + 2 availability invalidations (before coalescing).")

        // Durable pending Final must invalidate without a response or projection.
        precondition(policy.tool(token: "live", scope: "account-A",
            state: .init(complete: true, unreadable: false)))
        precondition(!policy.tool(token: "live", scope: "account-A",
            state: .init(complete: true, unreadable: false)))
        precondition(policy.tool(token: "live", scope: "account-A", state: tool),
                     "Removing a pending Final must re-evaluate.")
        precondition(policy.tool(token: "live", scope: "account-A",
            state: .init(complete: false, unreadable: true)))
        precondition(policy.tool(token: "live", scope: "account-A", state: tool),
                     "Readability recovery must re-evaluate.")
        record(policy.cache(key: "workspace/live", scope: "account-A", workspace: final))
        precondition(routine == 2 && availability == 3, "Server Final must invalidate.")
        record(policy.cache(key: "workspace/live", scope: "account-A",
            workspace: .init(linkID: "different-link", complete: true)))
        precondition(routine == 3 && availability == 4, "Authority changes cannot use the old signature.")
        let schedule = policy.cache(key: "get/supporter/schedule", scope: "account-A", workspace: nil)
        precondition(schedule.routine && schedule.availability, "Time/status changes always re-evaluate.")
        let corrupt = policy.cache(key: "workspace/live", scope: "account-A", workspace: nil)
        precondition(corrupt.routine && corrupt.availability)
        let recovered = policy.cache(key: "workspace/live", scope: "account-A", workspace: live)
        precondition(recovered.routine && recovered.availability, "Unknown input cannot poison the signature.")
        let switched = policy.cache(key: "workspace/live", scope: "account-B", workspace: live)
        precondition(switched.routine && switched.availability)
        precondition(policy.tool(token: "live", scope: "account-B", state: tool))
        policy.reset(scope: "account-B") // verification, download removal, failed storage
        let refreshed = policy.cache(key: "workspace/live", scope: "account-B", workspace: live)
        precondition(refreshed.routine && refreshed.availability)
        print("Final, unreadable data, recovery, schedule, authority, account and reset checks passed.")
    }
}
