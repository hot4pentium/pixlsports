import Foundation

@main
struct NativeLiveTapContributionChecks {
    static func main() throws {
        let item = SavedLiveTap(id: "tap-1", gameId: "game-a", cheerKey: "goal", accessToken: nil, savedAt: Date())
        var session = SavedLiveTapSession(scope: "family|invite|event-a", inviteToken: "invite",
            ownerSubject: nil, ownerNamespace: nil, eventId: "event-a", sport: "soccer")
        session.pending = [item]
        let completion = NativeLiveTapCompletion(id: "completion-a", gameId: "game-a", eventId: "event-a",
            athleteName: "Athlete", eventTitle: "Today vs Tigers", sport: "soccer",
            seasonId: "season-a", endedAt: "2026-11-05T01:00:00Z",
            cheers: [LiveTapCheer(key: "goal", label: "Goal", emoji: "", count: 48)])
        precondition(!session.claim(completion, ownerEnded: false), "pending alone is not participation")
        precondition(session.personalTotal(gameId: "game-a") == 0)
        precondition(!session.acknowledge(item, receipt: NativeLiveTapReceipt(id: item.id, gameId: "other", cheerKey: item.cheerKey)))
        precondition(session.pending.count == 1)
        let receipt = NativeLiveTapReceipt(id: item.id, gameId: item.gameId, cheerKey: item.cheerKey)
        precondition(session.acknowledge(item, receipt: receipt))
        precondition(session.acknowledge(item, receipt: receipt), "lost-response recovery deduplicates")
        precondition(session.personalTotal(gameId: "game-a") == 1)
        precondition(session.personalTotal(gameId: "game-b") == 0)
        precondition(session.pending.isEmpty)
        precondition(session.claim(completion, ownerEnded: false))
        let data = try JSONEncoder().encode(session)
        var relaunched = try JSONDecoder().decode(SavedLiveTapSession.self, from: data)
        precondition(!relaunched.claim(completion, ownerEnded: false), "relaunch cannot replay")
        precondition(relaunched.personalTotal(gameId: "game-a") == 1)

        var wrongEvent = SavedLiveTapSession(scope: "family|invite|event-b", inviteToken: "invite",
            ownerSubject: nil, ownerNamespace: nil, eventId: "event-b", sport: "soccer")
        _ = wrongEvent.acknowledge(item, receipt: receipt)
        precondition(!wrongEvent.claim(completion, ownerEnded: false))

        var owner = SavedLiveTapSession(scope: "owner|invite|event-a", inviteToken: "invite",
            ownerSubject: "owner", ownerNamespace: "account-link", eventId: "event-a", sport: "soccer")
        precondition(owner.claim(completion, ownerEnded: true), "owner explicit End is eligible with zero own cheers")
        precondition(owner.personalTotal(gameId: "game-a") == 0)

        let legacyJSON = """
        {"version":1,"scope":"family|invite|event-a","inviteToken":"invite",
         "eventId":"event-a","sport":"soccer","pending":[]}
        """
        var legacy = try JSONDecoder().decode(SavedLiveTapSession.self, from: Data(legacyJSON.utf8))
        precondition(legacy.personalTotal(gameId: "game-a") == nil, "legacy personal totals are unknown")
        _ = legacy.acknowledge(item, receipt: receipt)
        precondition(legacy.personalTotal(gameId: "game-a") == nil, "new receipts do not invent earlier attribution")
        precondition(legacy.claim(completion, ownerEnded: false), "known participation can show combined-only record")
        var oldServer = SavedLiveTapSession(scope: "legacy", inviteToken: "invite", ownerSubject: nil,
            ownerNamespace: nil, eventId: "event-a", sport: "soccer")
        precondition(oldServer.acknowledge(item, receipt: nil))
        precondition(oldServer.personalTotal(gameId: "game-a") == nil)
        precondition(oldServer.claim(completion, ownerEnded: false), "accepted legacy delivery shows combined-only celebration")
        var privateEvent = SavedLiveTapSession(scope: "private-event", inviteToken: "invite", ownerSubject: nil,
            ownerNamespace: nil, eventId: "event-a", sport: "soccer")
        _ = privateEvent.acknowledge(item, receipt: receipt)
        let redacted = NativeLiveTapCompletion(id: "private-completion", gameId: "game-a", eventId: nil,
            athleteName: completion.athleteName, eventTitle: "Completed game", sport: "soccer",
            seasonId: completion.seasonId, endedAt: nil, cheers: completion.cheers)
        precondition(privateEvent.claim(redacted, ownerEnded: false), "known game receipts work without disclosing hidden event fields")
        print("Live Taps receipt, atomic-snapshot roundtrip, eligibility and replay checks passed.")
    }
}
