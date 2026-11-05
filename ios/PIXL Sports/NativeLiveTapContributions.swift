import Foundation

struct LiveTapCheer: Codable, Identifiable {
    let key: String
    let label: String
    let emoji: String
    let count: Int
    var id: String { key }
}

struct NativeLiveTapReceipt: Codable {
    let id: String
    let gameId: String
    let cheerKey: String
}

struct NativeLiveTapCompletion: Codable, Identifiable {
    let id: String
    let gameId: String
    let eventId: String?
    let athleteName: String
    let eventTitle: String
    let sport: String
    let seasonId: String?
    let endedAt: String?
    let cheers: [LiveTapCheer]
    var total: Int { cheers.reduce(0) { $0 + $1.count } }
}

struct NativeLiveTapEndResult: Decodable {
    let completion: NativeLiveTapCompletion?
}

struct LiveTapSummary: Codable {
    let active: Bool
    let gameId: String?
    let cheers: [LiveTapCheer]
    var seasonCheers: [LiveTapCheer]? = nil
    var completedSessions: [NativeLiveTapCompletion]? = nil
    var receipt: NativeLiveTapReceipt? = nil
}

struct SavedLiveTap: Codable, Identifiable {
    let id: String
    let gameId: String
    let cheerKey: String
    let accessToken: String?
    let savedAt: Date
    var needsAttention = false
}

struct SavedLiveTapSession: Codable {
    var version = 1
    let scope: String
    let inviteToken: String
    let ownerSubject: String?
    let ownerNamespace: String?
    let eventId: String?
    let sport: String
    var summary: LiveTapSummary?
    var accessToken: String?
    var pending: [SavedLiveTap] = []
    // Optional for backward compatibility. Missing reliability means legacy/unknown.
    var attributionReliable: Bool? = true
    var confirmedReceipts: [String: NativeLiveTapReceipt]? = nil
    var presentedCompletionIDs: Set<String>? = nil
    var endingGameID: String? = nil
    var acceptedLegacyGameIDs: Set<String>? = nil

    var confirmedCount: Int { confirmedReceipts?.count ?? 0 }

    func personalTotal(gameId: String) -> Int? {
        guard attributionReliable == true else { return nil }
        return confirmedReceipts?.values.filter { $0.gameId == gameId }.count ?? 0
    }

    mutating func acknowledge(_ item: SavedLiveTap, receipt: NativeLiveTapReceipt?) -> Bool {
        if let receipt {
            guard receipt.id == item.id, receipt.gameId == item.gameId,
                  receipt.cheerKey == item.cheerKey else { return false }
            var receipts = confirmedReceipts ?? [:]
            receipts[receipt.id] = receipt
            confirmedReceipts = receipts
        } else {
            // Older servers can acknowledge delivery, but not attributable totals.
            attributionReliable = false
            var accepted = acceptedLegacyGameIDs ?? []
            accepted.insert(item.gameId)
            acceptedLegacyGameIDs = accepted
        }
        pending.removeAll { $0.id == item.id }
        return true
    }

    mutating func claim(_ completion: NativeLiveTapCompletion, ownerEnded: Bool) -> Bool {
        let knownGame = summary?.gameId == completion.gameId || endingGameID == completion.gameId
            || confirmedReceipts?.values.contains(where: { $0.gameId == completion.gameId }) == true
            || acceptedLegacyGameIDs?.contains(completion.gameId) == true
        guard !(presentedCompletionIDs ?? []).contains(completion.id),
              completion.sport == sport,
              eventId == nil || completion.eventId == eventId || completion.gameId == eventId
                || (completion.eventId == nil && knownGame) else { return false }
        let participated = confirmedReceipts?.values.contains { $0.gameId == completion.gameId } == true
            || acceptedLegacyGameIDs?.contains(completion.gameId) == true
        guard participated || (ownerEnded && ownerSubject != nil) else { return false }
        var presented = presentedCompletionIDs ?? []
        presented.insert(completion.id)
        presentedCompletionIDs = presented
        return true
    }
}

struct NativeLiveTapCelebration: Identifiable {
    let completion: NativeLiveTapCompletion
    let personalTotal: Int?
    let pendingCount: Int
    var id: String { completion.id }
}
