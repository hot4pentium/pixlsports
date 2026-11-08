import SwiftUI
import ClerkKit

@MainActor
struct NativeSeasonStatsView: View {
    let clerk: Clerk?
    let schedule: NativeSupporterSchedule?
    @ObservedObject private var offline = NativeOfflineRuntime.shared
    @Environment(\.scenePhase) private var scenePhase
    @State private var payload: NativeSeasonStats?
    @State private var payloadSubject: String?
    @State private var payloadNamespace: String?
    @State private var loading = false
    @State private var loadID: UUID?
    @State private var refreshQueued = false
    @State private var notice: String?
    @State private var scope: NativeSeasonStatScope = .athlete
    @State private var selectedMetric = ""

    private var isFixture: Bool {
#if DEBUG
        return SupporterDashboardFixtures.isRequested
#else
        return false
#endif
    }

    private var subject: String? {
        guard let clerk else { return nil }
        if clerk.isLoaded && clerk.user == nil { return nil }
        return clerk.user?.id ?? offline.vault.subject
    }

    private var visiblePayload: NativeSeasonStats? {
        if isFixture { return payload }
        guard let subject, subject == payloadSubject,
              payloadNamespace == offline.vault.namespace,
              offline.vault.canContinue(subject: subject) else { return nil }
        return payload
    }

    var body: some View {
        ZStack {
            NativePageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Season Stats")
                        .font(.largeTitle.weight(.black))
                        .foregroundStyle(SupporterHomeColors.background)
                    if let data = visiblePayload {
                        Text([data.athleteName, data.seasonName, data.sport?.capitalized ?? ""]
                            .filter { !$0.isEmpty }.joined(separator: " · "))
                            .foregroundStyle(SupporterHomeColors.lightMuted)
                        if let notice {
                            Text(notice).font(.footnote)
                                .foregroundStyle(SupporterHomeColors.lightMuted)
                                .accessibilityIdentifier("season-stats-save-status")
                        }
                        if data.games.isEmpty {
                            emptyState("No completed games yet",
                                       detail: "Finish a game in Track Stats to begin your season history.")
                        } else {
                            NativeSeasonStatsContent(
                                data: data, scope: $scope, selectedMetric: $selectedMetric
                            )
                        }
                    } else if loading {
                        ProgressView("Loading your saved stats…")
                    } else {
                        emptyState("Season stats aren’t available yet",
                                   detail: notice ?? "Connect once to load your private season history. It will then be available on this iPhone.")
                    }
                    if !isFixture {
                        Button("Refresh stats") { Task { await load() } }
                            .buttonStyle(.bordered)
                            .disabled(loading)
                            .accessibilityIdentifier("season-stats-refresh")
                    }
                }
                .padding(22)
                .frame(maxWidth: 760, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .refreshable { await load() }
        }
        .navigationTitle("Season Stats")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("native-season-stats-page")
        .task { await load() }
        .onChange(of: clerk?.user?.id) { _, _ in
            payload = nil
            payloadSubject = nil
            loadID = nil
            loading = false
            refreshQueued = false
            Task { await load() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await load() } }
        }
        .onChange(of: offline.online) { _, online in
            if online { Task { await load() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nativeEventScheduleChanged)) { _ in
            Task { await load() }
        }
        .onChange(of: offline.revocationGeneration) { _, _ in
            payload = nil
            payloadSubject = nil
            loadID = nil
            loading = false
            refreshQueued = false
        }
    }

    private func emptyState(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: "chart.xyaxis.line").font(.headline)
            Text(detail).font(.subheadline).fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.white)
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 22))
        .accessibilityIdentifier("season-stats-empty")
    }

    private func load() async {
        if loading {
            refreshQueued = true
            return
        }
#if DEBUG
        if isFixture {
            payload = NativeSeasonStatsFixtures.make(empty: ProcessInfo.processInfo.arguments.contains("--season-stats-empty"))
            return
        }
#endif
        guard let subject, offline.vault.canContinue(subject: subject) else {
            payload = nil
            notice = "Sign in to view your private season stats."
            return
        }
        loading = true
        let requestID = UUID()
        loadID = requestID
        defer {
            if loadID == requestID {
                loading = false
                if refreshQueued {
                    refreshQueued = false
                    Task { await load() }
                }
            }
        }
        let namespace = offline.vault.namespace
        payloadSubject = subject
        payloadNamespace = namespace
        do {
            if let saved = try offline.vault.read("get/supporter/season-stats", subject: subject) {
                payload = try JSONDecoder().decode(NativeSeasonStats.self, from: saved)
            }
            payload = try addingLocalFinals(to: payload, subject: subject)
            notice = offline.online ? nil : "Showing stats saved on this iPhone. Updates will appear when you reconnect."
        } catch {
            notice = "Some saved stats couldn’t be read. Reconnect and refresh to reload them."
        }
        guard offline.online, let clerk else { return }
        do {
            let bytes = try await NativeAccountLinkClient().getAuthoritativeData("supporter/season-stats", clerk: clerk)
            guard loadID == requestID, self.subject == subject, offline.vault.namespace == namespace,
                  offline.vault.canContinue(subject: subject), !Task.isCancelled else { return }
            let saved = try JSONDecoder().decode(NativeSeasonStats.self, from: bytes)
            payload = try addingLocalFinals(to: saved, subject: subject)
            notice = payload?.games.contains(where: \.pending) == true
                ? "Includes finished games saved on this iPhone that are waiting to sync." : nil
        } catch {
            guard loadID == requestID, self.subject == subject, offline.vault.namespace == namespace,
                  !Task.isCancelled else { return }
            if !offline.vault.canContinue(subject: subject) { payload = nil }
            notice = payload == nil
                ? "We couldn’t load your private stats. Check your sign-in and try again."
                : "Showing saved stats. We couldn’t check for updates; you can try again."
        }
    }

    private func addingLocalFinals(to saved: NativeSeasonStats?, subject: String) throws -> NativeSeasonStats? {
        var result = saved
        for token in offline.vault.preparedEvents.sorted(by: {
            (offline.vault.date("workspace/" + $0) ?? .distantPast) >
                (offline.vault.date("workspace/" + $1) ?? .distantPast)
        }) {
            guard let bytes = try offline.vault.read("workspace/" + token, subject: subject) else { continue }
            let workspace = try JSONDecoder().decode(NativeEventWorkspace.self, from: bytes)
            let event = schedule?.events.first { $0.shareToken == token }
            let model = offline.eventModel(token: token, accountID: subject)
            guard let game = model.displayedGame, game.status == "final",
                  game.liveTapsOnly != true, event?.type != "practice",
                  model.trackerRecoveryStatus == nil || model.trackerRecoveryStatus == .revisionConflict else { continue }
            let verifiedCurrentEvent = event?.type == "game" && schedule?.linkId == workspace.linkId
            if result == nil, verifiedCurrentEvent,
               workspace.trackerProjectId != nil || model.pendingStatCount > 0 {
                result = NativeSeasonStats(athleteName: schedule?.athleteName ?? "Your athlete",
                                          teamName: schedule?.teamName ?? "Your team",
                                          seasonName: schedule?.seasonName ?? "",
                                          sport: workspace.sport, trackerProjectId: workspace.trackerProjectId, games: [])
            }
            guard result != nil, NativeSeasonAnalysis.canMerge(
                project: result?.trackerProjectId, workspaceProject: workspace.trackerProjectId,
                pending: model.pendingStatCount > 0, verifiedCurrentEvent: verifiedCurrentEvent
            ),
                  workspace.sport == result?.sport else { continue }
            let existing = result?.games.first { $0.id == game.id }
            // A corrected cloud final outranks an older device snapshot.
            guard existing == nil || model.pendingStatCount > 0 else { continue }
            var athlete: [String: Int] = [:]
            for play in game.events where play.attribution == "athlete" && play.possessionSide != "opponent" {
                let yards = play.statId == "pass-yard" || play.statId == "rush-yard"
                athlete[play.statId, default: 0] += yards ? max(0, play.yards ?? 0) : 1
            }
            var local = NativeSeasonStatGame(
                id: game.id, sourceEventId: game.sourceEventId ?? event?.eventId,
                date: existing?.date ?? game.date ?? event?.date ?? "",
                opponent: existing?.opponent ?? game.opponent ?? event?.opponent ?? "",
                score: game.score, opponentScore: game.opponentScore, scoreRecorded: game.hasRecordedScore,
                stats: game.stats, athleteStats: athlete
            )
            local.pending = model.pendingStatCount > 0
            result?.games.removeAll { $0.id == local.id }
            result?.games.append(local)
        }
        if let games = result?.games { result?.games = NativeSeasonAnalysis.sorted(games) }
        return result
    }
}

#if DEBUG
enum NativeSeasonStatsFixtures {
    static func make(empty: Bool = false) -> NativeSeasonStats {
        let games = empty ? [] : (1...5).map { index in
            NativeSeasonStatGame(id: "fixture-\(index)", sourceEventId: nil,
                                date: "2026-11-0\(index)", opponent: "Opponent \(index)",
                                score: index + 1, opponentScore: 1, scoreRecorded: index != 2,
                                stats: ["goal": index, "save": index + 4],
                                athleteStats: ["goal": index - 1, "save": index + 2])
        }
        return NativeSeasonStats(athleteName: "Jordan", teamName: "Tigers", seasonName: "Fall 2026",
                                 sport: "soccer", trackerProjectId: "fixture", games: games)
    }
}
#endif
