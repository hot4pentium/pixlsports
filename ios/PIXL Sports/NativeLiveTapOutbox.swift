import Foundation
import Combine
import UIKit
import ClerkKit

/// Save before sending; remove only after a server receipt is durably recorded.
/// A lost response retries the same UUID, never a new cheer.
@MainActor
final class NativeLiveTapOutbox: ObservableObject {
    static let shared = NativeLiveTapOutbox()
    @Published private(set) var revision = 0
    @Published private(set) var sending = Set<String>()
    @Published private(set) var messages: [String: String] = [:]
    private var sessions: [String: SavedLiveTapSession] = [:]
    private let storage = NativeLiveTapOutboxStorage()
    private var loaded = false
    private var worker: Task<Void, Never>?
    private var clerk: Clerk?
    private var retryAfter: [String: Date] = [:]
    private var failures: [String: Int] = [:]

    func start(clerk: Clerk? = nil) {
        if let clerk { self.clerk = clerk }
        guard worker == nil else { return }
        worker = Task { [weak self] in
            while !Task.isCancelled {
                if UIApplication.shared.applicationState == .active {
                    try? self?.load()
                    await self?.flushAll()
                }
                try? await Task.sleep(for: .seconds(4))
            }
        }
    }

    private func load() throws {
        guard !loaded else { return }
        sessions = try storage.load()
        loaded = true
    }

    private func commit(_ session: SavedLiveTapSession) throws {
        try storage.save(session)
        sessions[session.scope] = session
        revision += 1
    }

    func prepare(inviteToken: String, sport: String, ownerClerk: Clerk?, accessToken: String?, eventId: String?) throws -> String {
        try load()
        let subject: String?
        if let ownerClerk {
            self.clerk = ownerClerk
            if let id = ownerClerk.user?.id {
                guard NativeOfflineRuntime.shared.vault.canContinue(subject: id) else { throw NativeOfflineError.locked }
                subject = id
            } else if !ownerClerk.isLoaded, NativeOfflineRuntime.shared.canContinue {
                subject = NativeOfflineRuntime.shared.vault.subject
            } else {
                throw NativeOfflineError.locked
            }
            guard subject != nil else { throw NativeOfflineError.locked }
        } else { subject = nil }
        let namespace = subject == nil ? nil : NativeOfflineRuntime.shared.vault.namespace
        guard subject == nil || namespace != nil else { throw NativeOfflineError.locked }
        let scope = (subject.map { "owner:" + $0 + ":" + (namespace ?? "") } ?? "family")
            + "|" + inviteToken + "|" + (eventId ?? "current")
        var session = sessions[scope] ?? SavedLiveTapSession(
            scope: scope, inviteToken: inviteToken, ownerSubject: subject, ownerNamespace: namespace,
            eventId: eventId, sport: sport
        )
        guard session.sport == sport else { throw NativeOfflineError.corrupt }
        if let accessToken { session.accessToken = accessToken }
        try commit(session)
        start(clerk: ownerClerk)
        return scope
    }

    func snapshot(_ scope: String) -> SavedLiveTapSession? { sessions[scope] }

    func beginEnding(gameID: String, scope: String) throws {
        guard var session = sessions[scope], session.ownerSubject != nil else { throw NativeOfflineError.locked }
        session.endingGameID = gameID
        try commit(session)
    }

    func claimCelebration(_ completion: NativeLiveTapCompletion, scope: String, ownerEnded: Bool = false) throws -> NativeLiveTapCelebration? {
        guard var session = sessions[scope] else { return nil }
        if let subject = session.ownerSubject {
            guard clerk?.user?.id == subject,
                  session.ownerNamespace == NativeOfflineRuntime.shared.vault.namespace,
                  NativeOfflineRuntime.shared.vault.canContinue(subject: subject) else { return nil }
        }
        guard let celebration = session.claimCelebration(
            completion, among: Array(sessions.values), ownerEnded: ownerEnded
        ) else { return nil }
        // Save display eligibility before presenting. The receipt journal and
        // outbox acknowledgement share this same encrypted atomic file.
        try commit(session)
        return celebration
    }

    func remember(_ summary: LiveTapSummary, scope: String, accessToken: String?) throws {
        guard var session = sessions[scope] else { throw NativeOfflineError.locked }
        session.summary = summary
        if let accessToken { session.accessToken = accessToken }
        try commit(session)
    }

    func enqueue(_ cheerKey: String, scope: String, accessToken: String?) throws {
        guard var session = sessions[scope], let summary = session.summary,
              summary.active, let gameId = summary.gameId else {
            throw NativeAccountLinkError.message("Open this game with a connection before saving cheers.")
        }
        guard session.ownerSubject != nil || accessToken != nil else {
            throw NativeAccountLinkError.message("Scan the family QR before saving cheers.")
        }
        if let subject = session.ownerSubject {
            guard (clerk?.user?.id == subject || clerk?.isLoaded == false),
                  session.ownerNamespace == NativeOfflineRuntime.shared.vault.namespace,
                  NativeOfflineRuntime.shared.vault.canContinue(subject: subject) else { throw NativeOfflineError.locked }
        }
        guard session.pending.count < 5000 else {
            throw NativeAccountLinkError.message("Send or review your saved cheers before adding more.")
        }
        session.pending.append(SavedLiveTap(
            id: UUID().uuidString.lowercased(), gameId: gameId, cheerKey: cheerKey,
            accessToken: session.ownerSubject == nil ? accessToken : nil, savedAt: Date(), gameRef: summary.gameRef
        ))
        try commit(session)
        Task { await flush(scope) }
    }

    func pendingCount(inviteToken: String, ownerSubject: String, eventId: String) -> Int {
        sessions.values.filter { $0.inviteToken == inviteToken && $0.ownerSubject == ownerSubject
            && $0.ownerNamespace == NativeOfflineRuntime.shared.vault.namespace && $0.eventId == eventId }
            .reduce(0) { $0 + $1.pending.filter { !$0.needsAttention }.count }
    }

    func flushAll() async {
        guard NativeOfflineRuntime.shared.online else { return }
        for scope in Array(sessions.keys) { await flush(scope) }
    }

    func retry(_ scope: String) async {
        guard var session = sessions[scope] else { return }
        for index in session.pending.indices { session.pending[index].needsAttention = false }
        do { try commit(session) } catch {
            messages[scope] = "Couldn’t update your saved cheers. They have not been removed."
            return
        }
        retryAfter[scope] = nil
        await flush(scope)
    }

    func discard(_ scope: String) throws {
        guard !sending.contains(scope), var session = sessions[scope] else {
            throw NativeAccountLinkError.message("Wait for the current send to finish.")
        }
        session.pending = []
        try commit(session)
        messages[scope] = nil
    }

    /// Only an explicitly confirmed account removal purges protected queues.
    /// Sign-out and lost access leave them encrypted and unable to send.
    func removeOwner(subject: String) throws {
        try load()
        for scope in Array(sessions.keys) where sessions[scope]?.ownerSubject == subject {
            try storage.remove(scope)
            sessions[scope] = nil
            messages[scope] = nil
        }
        revision += 1
    }

    func flush(_ scope: String) async {
        guard NativeOfflineRuntime.shared.online, !sending.contains(scope),
              let session = sessions[scope], !session.pending.isEmpty,
              (retryAfter[scope] ?? .distantPast) <= Date() else { return }
        if let subject = session.ownerSubject {
            guard clerk?.isLoaded == true, clerk?.user?.id == subject,
                  session.ownerNamespace == NativeOfflineRuntime.shared.vault.namespace,
                  NativeOfflineRuntime.shared.vault.canContinue(subject: subject) else { return }
        }
        sending.insert(scope)
        defer { sending.remove(scope) }
        while NativeOfflineRuntime.shared.online,
              let item = sessions[scope]?.pending.first(where: { !$0.needsAttention }) {
            do {
                if let subject = session.ownerSubject, clerk?.user?.id != subject { return }
                let updated = try await SupporterHomeAPI.sendLiveTap(
                    inviteToken: session.inviteToken, accessToken: item.accessToken,
                    cheerKey: item.cheerKey, clerk: session.ownerSubject == nil ? nil : clerk,
                    gameId: item.gameId, clientMutationId: item.id, expectedEventId: session.eventId
                )
                guard var next = sessions[scope] else { return }
                guard next.acknowledge(item, receipt: updated.receipt) else {
                    messages[scope] = "Couldn’t confirm this cheer’s receipt. It is still saved here."
                    return
                }
                if next.summary?.gameId == updated.gameId
                    || (updated.gameRef != nil && next.summary?.gameRef == updated.gameRef) { next.summary = updated }
                do { try commit(next) } catch {
                    messages[scope] = "Your cheer reached PIXL, but this iPhone couldn’t update its saved copy. It will safely check again."
                    return
                }
                messages[scope] = nil
                failures[scope] = nil
                retryAfter[scope] = nil
            } catch {
                let status = (error as? NativeAccountLinkError)?.statusCode
                if let status, [400, 401, 403, 404, 409, 410, 422, 423].contains(status),
                   var next = sessions[scope] {
                    for index in next.pending.indices where next.pending[index].gameId == item.gameId
                        && next.pending[index].accessToken == item.accessToken {
                        next.pending[index].needsAttention = true
                    }
                    if status == 409, next.summary?.gameId == item.gameId, let summary = next.summary {
                        next.summary = LiveTapSummary(active: false, gameId: summary.gameId, cheers: summary.cheers,
                            seasonCheers: summary.seasonCheers, completedSessions: summary.completedSessions)
                    }
                    if status == 403, session.ownerSubject == nil, next.accessToken == item.accessToken {
                        next.accessToken = nil
                    }
                    do { try commit(next) } catch {
                        messages[scope] = "Your saved cheers are still on this iPhone. Try again."
                        return
                    }
                    messages[scope] = status == 409
                        ? "Some cheers couldn’t be sent to their original game. They are still saved here."
                        : "Some cheers need your access checked. They are still saved here."
                } else {
                    failures[scope, default: 0] += 1
                    let delay = status == 429 ? 60 : min(60, pow(2, Double(min(failures[scope] ?? 1, 5))) * 2)
                    retryAfter[scope] = Date().addingTimeInterval(delay)
                    messages[scope] = "Waiting for a connection. Your cheers are saved on this iPhone."
                }
                return
            }
        }
    }
}
