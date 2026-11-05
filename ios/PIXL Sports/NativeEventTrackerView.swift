import SwiftUI
import ClerkKit

struct NativeEventTrackerView: View {
    let event: AthleteFanEvent
    let teamName: String
    let athleteName: String
    let clerk: Clerk
    let embedded: Bool
    let compact: Bool
    @StateObject private var model: NativeEventToolModel
    @State private var attribution = "athlete"
    @State private var opponentPossession = false
    @State private var yards = 0
    @State private var soccerFormat = "halves"
    @State private var showingFinish = false
    @State private var recordScore = false
    @State private var outcome = ""

    init(event: AthleteFanEvent, teamName: String, athleteName: String, clerk: Clerk,
         model: NativeEventToolModel? = nil, embedded: Bool = false, compact: Bool = false) {
        self.event = event
        self.teamName = teamName
        self.athleteName = athleteName
        self.clerk = clerk
        self.embedded = embedded
        self.compact = compact
        _model = StateObject(wrappedValue: model ?? NativeEventToolModel.shared(
            shareToken: event.shareToken, accountID: clerk.user?.id ?? NativeOfflineRuntime.shared.accountID
        ))
    }

    var body: some View {
        Group {
            if embedded {
                trackerContent
            } else {
                ScrollView { trackerContent.padding(20) }
            }
        }
        .eventToolNavigationTitle("Track Stats", embedded: embedded)
        .tint(NativeEventToolColors.trackStats)
        .task {
            if model.workspace == nil { await model.load(clerk: clerk) }
        }
        .sheet(isPresented: $showingFinish) { finishSheet }
    }

    private var trackerContent: some View {
            VStack(alignment: .leading, spacing: compact ? 12 : 22) {
                if !embedded { Text(event.title).font(.title2.bold()) }
                if !embedded || model.busy || model.errorMessage != nil || model.pendingCount > 0 {
                    NativeToolSaveNotice(model: model, clerk: clerk)
                }
                if let workspace = model.workspace {
                    if let game = model.displayedGame {
                        tracker(workspace: workspace, game: game)
                    } else {
                        if compact {
                            Text("Keep score").font(.headline)
                            Text("Start the game to update the team scores. Player stats are optional in the full tracker.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            HStack(alignment: .top, spacing: 20) {
                                scoreboard(teamName, score: 0, opponent: false, editable: false)
                                scoreboard(event.opponent.isEmpty ? "Opponent" : event.opponent, score: 0, opponent: true, editable: false)
                            }
                        } else {
                            Text("Track \(workspace.sport.capitalized) for \(athleteName). Each tap saves to your existing PIXL game history.")
                        }
                        if workspace.sport == "soccer" {
                            Picker("Soccer format", selection: $soccerFormat) {
                                Text("Halves").tag("halves")
                                Text("Quarters").tag("quarters")
                            }
                            .pickerStyle(.segmented)
                        }
                        Button(compact ? "Start game" : "Start tracking") {
                            Task { await model.save("start", clerk: clerk, soccerFormat: workspace.sport == "soccer" ? soccerFormat : nil) }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(!model.canEditLocally || event.status == "final")
                        .accessibilityIdentifier("native-event-start-game")
                    }
                }
            }
    }

    private func tracker(workspace: NativeEventWorkspace, game: NativeEventWorkspace.Game) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text(game.status.uppercased()).font(.caption.bold())
                Spacer()
                if !compact {
                    Text("\(phaseLabel(workspace: workspace, game: game)) \(game.period)")
                        .font(.headline)
                }
            }
            HStack(alignment: .top, spacing: 20) {
                let canEditScore = game.status == "live" && model.canEditLocally
                scoreboard(teamName, score: game.score, opponent: false, editable: canEditScore)
                scoreboard(event.opponent.isEmpty ? "Opponent" : event.opponent, score: game.opponentScore, opponent: true, editable: canEditScore)
            }
            if game.status == "final" {
                if model.pendingFinal {
                    Text("Final saved on this iPhone · not yet saved to PIXL")
                        .font(.subheadline.bold()).foregroundStyle(.orange)
                        .accessibilityIdentifier("native-event-final-pending")
                }
                Text(game.hasRecordedScore
                     ? "Final score recorded."
                     : "No final score recorded\(game.outcome.map { " · \($0.capitalized)" } ?? "").")
                NavigationLink("Open HYPE Card to share") { SupporterHypeCardView(clerk: clerk) }
                    .buttonStyle(.borderedProminent)
            } else {
                if !compact {
                if game.sport == "football" {
                    Toggle("Opponent possession", isOn: $opponentPossession)
                    Stepper("Yards on next play: \(yards)", value: $yards, in: 0...100)
                }
                Picker("Stat attribution", selection: $attribution) {
                    Text(athleteName).tag("athlete")
                    Text("Team").tag("team")
                }
                .pickerStyle(.segmented)
                .disabled(opponentPossession)
                Text(opponentPossession
                     ? "Opponent plays are kept separate from your athlete."
                     : "Athlete taps record individual stats. Team taps and score controls update the team scoreboard.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                    ForEach(Array(workspace.rules.stats.prefix(compact ? 4 : workspace.rules.stats.count))) { stat in
                        Button {
                            Task {
                                await model.save("stat", clerk: clerk, statID: stat.id,
                                                 athlete: attribution == "athlete", opponent: opponentPossession, yards: yards)
                            }
                        } label: {
                            VStack(spacing: 6) {
                                Text(stat.label).font(.subheadline.bold()).multilineTextAlignment(.center)
                                Text("\(statTotal(game: game, statID: stat.id))")
                                    .font(.title2.bold())
                                if !opponentPossession {
                                    Text("\(athleteCount(game: game, statID: stat.id)) athlete")
                                        .font(.caption2)
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: compact ? 72 : 92)
                            .background(NativeEventToolColors.trackStats.opacity(0.16), in: RoundedRectangle(cornerRadius: 16))
                        }
                        .buttonStyle(.plain)
                        .disabled(!model.canQueueStat)
                        .accessibilityLabel("Record \(stat.label), \(opponentPossession ? "opponent" : attribution == "athlete" ? athleteName : teamName)")
                    }
                }
                HStack {
                    Button(game.status == "live" ? "Pause" : "Resume") {
                        Task { await model.save(game.status == "live" ? "pause" : "resume", clerk: clerk) }
                    }
                    .disabled(!model.canEditLocally)
                    Spacer()
                    Button("Next \(phaseLabel(workspace: workspace, game: game).lowercased())") {
                        Task { await model.save("period", clerk: clerk) }
                    }
                    .accessibilityIdentifier("native-event-next-period")
                    .disabled(game.status != "live" || !model.canEditLocally)
                }
                Button("Undo last stat") { Task { await model.save("undo", clerk: clerk) } }
                    .disabled(game.events.isEmpty || game.status != "live" || !model.canEditLocally)
            } else if game.status == "paused" {
                Button("Resume game") {
                    Task { await model.save("resume", clerk: clerk) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!model.canEditLocally)
            }
            endGameControl(for: game)
            }
            if !compact && !game.events.isEmpty {
                Text("RECENT STATS").font(.caption.bold())
                ForEach(Array(game.events.suffix(8).reversed())) { play in
                    HStack {
                        Text(workspace.rules.stats.first { $0.id == play.statId }?.label ?? play.statId)
                        Spacer()
                        Text(play.possessionSide == "opponent" ? "Opponent" : play.attribution == "athlete" ? athleteName : "Team")
                    }
                    .font(.caption)
                }
            }
        }
    }

    @ViewBuilder
    private func endGameControl(for game: NativeEventWorkspace.Game) -> some View {
        if compact {
            HStack {
                Spacer(minLength: 0)
                endGameButton(for: game)
                Spacer(minLength: 0)
            }
        } else {
            endGameButton(for: game)
        }
    }

    private func endGameButton(for game: NativeEventWorkspace.Game) -> some View {
        Button(compact ? "End game" : "Finish game", role: .destructive) {
            recordScore = game.hasRecordedScore
            outcome = ""
            showingFinish = true
        }
        .buttonStyle(.bordered)
        .disabled(!model.canEditLocally)
        .accessibilityIdentifier("native-event-end-game")
    }

    private func scoreboard(_ label: String, score: Int, opponent: Bool, editable: Bool) -> some View {
        VStack(spacing: 8) {
            Text(label).font(.subheadline.bold()).multilineTextAlignment(.center)
            Text("\(score)")
                .font(.system(.largeTitle, design: .rounded).bold())
                .accessibilityIdentifier("native-event-score-\(opponent ? "opponent" : "team")-value")
            if editable {
                HStack {
                    Button { adjustScore(opponent: opponent, delta: -1) } label: {
                        Image(systemName: "minus.circle.fill").font(.title2).frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityIdentifier("native-event-score-\(opponent ? "opponent" : "team")-subtract")
                    .disabled(score == 0)
                     .accessibilityLabel("Decrease \(label) score")
                    Button { adjustScore(opponent: opponent, delta: 1) } label: {
                        Image(systemName: "plus.circle.fill").font(.title2).frame(minWidth: 44, minHeight: 44)
                    }
                    .accessibilityIdentifier("native-event-score-\(opponent ? "opponent" : "team")-add")
                     .accessibilityLabel("Increase \(label) score")
                }
                .accessibilityLabel("\(label) score")
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func adjustScore(opponent: Bool, delta: Int) {
        Task { await model.save("score", clerk: clerk, opponent: opponent, delta: delta) }
    }

    private func athleteCount(game: NativeEventWorkspace.Game, statID: String) -> Int {
        game.events.filter { $0.statId == statID && $0.attribution == "athlete" && $0.possessionSide != "opponent" }.count
    }

    private func statTotal(game: NativeEventWorkspace.Game, statID: String) -> Int {
        opponentPossession ? game.opponentStats?[statID] ?? 0 : game.stats[statID] ?? 0
    }

    private func phaseLabel(workspace: NativeEventWorkspace, game: NativeEventWorkspace.Game) -> String {
        game.sport == "soccer" && game.soccerPeriodFormat == "quarters" ? "Quarter" : workspace.rules.phaseLabel
    }

    private var finishSheet: some View {
        NavigationStack {
            Form {
                Section("Final result") {
                    Toggle("Record the displayed final score", isOn: $recordScore)
                    if let game = model.displayedGame {
                        Text("\(teamName) \(game.score) – \(game.opponentScore) \(event.opponent)")
                    }
                    if !recordScore {
                        Picker("Result without a score", selection: $outcome) {
                            Text("No result recorded").tag("")
                            Text("Win").tag("win")
                            Text("Loss").tag("loss")
                            Text("Tie").tag("tie")
                        }
                    }
                    Text("Finishing saves this game and marks its Event Card complete. It will be read-only in this native tracker.")
                        .font(.footnote)
                }
                NativeToolSaveNotice(model: model, clerk: clerk)
                Button("Confirm finished game") {
                    Task {
                        await model.save("finish", clerk: clerk, recordScore: recordScore, outcome: outcome.isEmpty ? nil : outcome)
                        if model.workspace?.game?.status == "final" { showingFinish = false }
                    }
                }
                .accessibilityIdentifier("native-event-confirm-final")
                .disabled(!model.canEditLocally)
            }
            .navigationTitle("Finish game")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showingFinish = false }
                }
            }
        }
    }
}
