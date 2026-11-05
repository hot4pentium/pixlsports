import Foundation

@main
struct NativeLiveTapContributionChecks {
    static func roundTrip(_ session: SavedLiveTapSession) throws -> SavedLiveTapSession {
        try JSONDecoder().decode(SavedLiveTapSession.self, from: JSONEncoder().encode(session))
    }

    static func checkOpaqueRecovery() throws {
        // Native tracking can use the Event Card ID as the saved game ID.
        let eventID = "event-card-also-used-as-game"
        let reference = "lt_invite_scoped_reference"
        let item = SavedLiveTap(id: "93395f63-de5c-4dcf-82ad-0ad176956bdb",
            gameId: eventID, cheerKey: "goal", accessToken: "fixture-grant-a",
            savedAt: Date(timeIntervalSince1970: 1_700_000_000), gameRef: reference)
        let receipt = NativeLiveTapReceipt(id: item.id, gameId: reference,
            cheerKey: item.cheerKey, gameRef: reference)
        let completion = NativeLiveTapCompletion(id: "completion-hidden", gameId: reference,
            eventId: nil, athleteName: "Athlete", eventTitle: "Completed game", sport: "soccer",
            seasonId: nil, endedAt: nil,
            cheers: [LiveTapCheer(key: "goal", label: "Goal", emoji: "", count: 48)],
            gameRef: reference)
        var saved = SavedLiveTapSession(scope: "family|invite-a|current", inviteToken: "invite-a",
            ownerSubject: nil, ownerNamespace: nil, eventId: nil, sport: "soccer")
        saved.summary = LiveTapSummary(active: true, gameId: eventID, cheers: [], gameRef: reference)
        saved.pending = [item]
        // Accepted on the server, but its reply was lost before local acknowledgement.
        saved = try roundTrip(saved)
        precondition(saved.pending[0].id == item.id)
        precondition(saved.pending[0].gameId == eventID)
        precondition(saved.pending[0].gameRef == reference)
        precondition(saved.pending[0].accessToken == "fixture-grant-a")
        precondition(!saved.claim(completion, ownerEnded: false), "queued is not confirmed")
        let badReceipts = [
            NativeLiveTapReceipt(id: "different-uuid", gameId: reference, cheerKey: "goal", gameRef: reference),
            NativeLiveTapReceipt(id: item.id, gameId: reference, cheerKey: "assist", gameRef: reference),
            NativeLiveTapReceipt(id: item.id, gameId: "lt_other", cheerKey: "goal", gameRef: "lt_other")
        ]
        for bad in badReceipts {
            precondition(!saved.acknowledge(item, receipt: bad))
            precondition(saved.pending.count == 1 && saved.confirmedCount == 0)
        }
        precondition(saved.acknowledge(saved.pending[0], receipt: receipt))
        saved = try roundTrip(saved)
        precondition(saved.pending.isEmpty && saved.confirmedCount == 1)
        precondition(saved.acknowledge(item, receipt: receipt), "same UUID recovery is idempotent")
        precondition(saved.confirmedCount == 1)
        precondition(saved.personalTotal(gameId: eventID) == 1, "active original ID")
        precondition(saved.personalTotal(gameId: reference) == 1, "completed opaque ID")
        saved.summary = LiveTapSummary(active: false, gameId: reference, cheers: completion.cheers,
            completedSessions: [completion], gameRef: reference)
        let audience = [saved]
        let celebration = saved.claimCelebration(completion, among: audience, ownerEnded: false)
        precondition(celebration?.personalTotal == 1 && celebration?.completion.total == 48)
        precondition(celebration?.pendingCount == 0)
        saved = try roundTrip(saved)
        let relaunchedAudience = [saved]
        precondition(saved.claimCelebration(completion, among: relaunchedAudience, ownerEnded: false) == nil)

        // Decode an actual old on-disk queue, not an initializer with new defaults.
        let oldJSON = """
        {"version":1,"scope":"family|invite-a|current","inviteToken":"invite-a","sport":"soccer",
         "pending":[{"id":"\(item.id)","gameId":"\(eventID)","cheerKey":"goal",
                     "accessToken":"fixture-grant-a","savedAt":0,"needsAttention":false}]}
        """
        var old = try JSONDecoder().decode(SavedLiveTapSession.self, from: Data(oldJSON.utf8))
        precondition(old.pending[0].gameRef == nil && old.attributionReliable == nil)
        precondition(old.acknowledge(old.pending[0], receipt: receipt))
        old = try roundTrip(old)
        precondition(old.pending.isEmpty && old.personalTotal(gameId: reference) == nil)
        let legacyAudience = [old]
        let legacyCelebration = old.claimCelebration(completion, among: legacyAudience, ownerEnded: false)
        precondition(legacyCelebration != nil && legacyCelebration?.personalTotal == nil)
        precondition(legacyCelebration?.completion.total == 48, "legacy combined total is still available")
        print("PASS: opaque Event Card identity, lost reply UUID, active/final totals, legacy queue and relaunch.")
    }

    static func checkAudienceIsolation() throws {
        let item = SavedLiveTap(id: "c58871cd-033e-412f-a037-2a5196a4b6e5", gameId: "game-a",
            cheerKey: "goal", accessToken: nil, savedAt: Date())
        let receipt = NativeLiveTapReceipt(id: item.id, gameId: item.gameId, cheerKey: item.cheerKey)
        let completion = NativeLiveTapCompletion(id: "completion-a", gameId: "game-a", eventId: "event-a",
            athleteName: "Athlete", eventTitle: "Game", sport: "soccer", seasonId: nil,
            endedAt: nil, cheers: [])
        func session(_ scope: String, _ invite: String = "invite-a",
                     _ subject: String? = "owner-a", _ namespace: String? = "link-a") -> SavedLiveTapSession {
            SavedLiveTapSession(scope: scope, inviteToken: invite, ownerSubject: subject,
                ownerNamespace: namespace, eventId: "event-a", sport: "soccer")
        }
        let empty = session("selected")
        let strangers = [
            session("other-owner", "invite-a", "owner-b"),
            session("other-link", "invite-a", "owner-a", "link-b"),
            session("other-invite", "invite-b"),
            session("family", "invite-a", nil, nil)
        ]
        for var stranger in strangers {
            precondition(stranger.acknowledge(item, receipt: receipt))
            var selected = empty
            precondition(selected.claimCelebration(completion, among: [empty, stranger], ownerEnded: false) == nil,
                "another account/link/invite/family cannot supply participation")
            precondition(stranger.claim(completion, ownerEnded: false))
            selected = empty
            precondition(selected.acknowledge(item, receipt: receipt))
            let audience = [selected, stranger]
            precondition(selected.claimCelebration(completion, among: audience, ownerEnded: false)?.personalTotal == 1,
                "another audience's presentation marker cannot suppress this audience")
        }
        var contributor = session("another-event-scope")
        precondition(contributor.acknowledge(item, receipt: receipt))
        var selected = empty
        precondition(selected.acknowledge(item, receipt: receipt))
        let duplicateAudience = [selected, contributor]
        precondition(selected.claimCelebration(completion, among: duplicateAudience, ownerEnded: false)?.personalTotal == 1,
            "same UUID in two scopes counts once")
        selected = try roundTrip(selected)
        precondition(contributor.claimCelebration(completion, among: [selected, contributor], ownerEnded: false) == nil,
            "same audience across scopes must not replay after relaunch")

        var pendingOnly = empty
        pendingOnly.pending = [item]
        precondition(pendingOnly.claimCelebration(completion, among: [pendingOnly], ownerEnded: false) == nil)
        let pendingAudience = [pendingOnly]
        precondition(pendingOnly.claimCelebration(completion, among: pendingAudience, ownerEnded: true)?.personalTotal == 0,
            "an owner may explicitly end with no confirmed personal cheers")
        let otherSport = NativeLiveTapCompletion(id: "wrong-sport", gameId: completion.gameId,
            eventId: completion.eventId, athleteName: completion.athleteName, eventTitle: completion.eventTitle,
            sport: "basketball", seasonId: nil, endedAt: nil, cheers: [])
        var sportSession = empty
        precondition(sportSession.acknowledge(item, receipt: receipt))
        precondition(sportSession.claimCelebration(otherSport, among: [sportSession], ownerEnded: false) == nil)

        // A newly scanned grant must not rewrite old queued requests.
        var family = session("family-queue", "invite-a", nil, nil)
        family.accessToken = "fixture-replacement-grant"
        family.pending = [
            SavedLiveTap(id: item.id, gameId: item.gameId, cheerKey: item.cheerKey,
                accessToken: "fixture-original-grant", savedAt: item.savedAt)
        ]
        family = try roundTrip(family)
        precondition(family.accessToken == "fixture-replacement-grant")
        precondition(family.pending[0].accessToken == "fixture-original-grant")
        precondition(family.pending[0].id == item.id && family.pending[0].gameId == item.gameId)
        print("PASS: account/link/invite audience isolation, cross-scope dedup and original queued grant.")
    }

    static func main() throws {
        try checkOpaqueRecovery()
        try checkAudienceIsolation()
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
        let opaqueItem = SavedLiveTap(id: "opaque-tap", gameId: "private-event", cheerKey: "goal",
            accessToken: nil, savedAt: Date(), gameRef: "lt_opaque")
        var opaqueSession = SavedLiveTapSession(scope: "family|opaque", inviteToken: "invite",
            ownerSubject: nil, ownerNamespace: nil, eventId: nil, sport: "soccer")
        opaqueSession.pending = [opaqueItem]
        let opaqueReceipt = NativeLiveTapReceipt(id: opaqueItem.id, gameId: "lt_opaque",
            cheerKey: "goal", gameRef: "lt_opaque")
        precondition(opaqueSession.acknowledge(opaqueItem, receipt: opaqueReceipt))
        precondition(opaqueSession.personalTotal(gameId: "lt_opaque") == 1)
        opaqueSession.summary = LiveTapSummary(active: true, gameId: "private-event", cheers: [],
            seasonCheers: [], gameRef: "lt_opaque")
        precondition(opaqueSession.personalTotal(gameId: "private-event") == 1, "active and completed identities match")
        let opaqueCompletion = NativeLiveTapCompletion(id: "opaque-completion", gameId: "lt_opaque",
            eventId: nil, athleteName: "Athlete", eventTitle: "Completed game", sport: "soccer",
            seasonId: nil, endedAt: nil, cheers: completion.cheers, gameRef: "lt_opaque")
        precondition(opaqueSession.claim(opaqueCompletion, ownerEnded: false))
        precondition(!opaqueSession.claim(opaqueCompletion, ownerEnded: false))
        var olderSession = SavedLiveTapSession(scope: "family|older", inviteToken: "invite",
            ownerSubject: nil, ownerNamespace: nil, eventId: nil, sport: "soccer")
        let olderItem = SavedLiveTap(id: opaqueItem.id, gameId: opaqueItem.gameId, cheerKey: "goal",
            accessToken: nil, savedAt: Date())
        olderSession.pending = [olderItem]
        precondition(olderSession.acknowledge(olderItem, receipt: opaqueReceipt))
        precondition(olderSession.pending.isEmpty)
        precondition(olderSession.personalTotal(gameId: "lt_opaque") == nil, "legacy attribution stays unknown")
        precondition(olderSession.claim(opaqueCompletion, ownerEnded: false))
        print("Live Taps receipt, atomic-snapshot roundtrip, eligibility and replay checks passed.")
    }
}
