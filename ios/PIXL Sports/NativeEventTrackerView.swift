import SwiftUI
import Combine
import ClerkKit
import UIKit

struct NativeEventTrackerView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject private var offline = NativeOfflineRuntime.shared
    let event: AthleteFanEvent
    let teamName: String
    let athleteName: String
    let clerk: Clerk
    let embedded: Bool
    let compact: Bool
    let scheduleTimeZone: String?
    @StateObject private var model: NativeEventToolModel
    @State private var attribution = "athlete"
    @State private var opponentPossession = false
    @State private var yards = 0
    @State private var soccerFormat = "halves"
    @State private var showingFinish = false
    @State private var recordScore = false
    @State private var outcome = ""
    @State private var accessDate = Date()

    init(event: AthleteFanEvent, teamName: String, athleteName: String, clerk: Clerk,
         model: NativeEventToolModel? = nil, embedded: Bool = false, compact: Bool = false,
         scheduleTimeZone: String? = nil) {
        self.event = event
        self.teamName = teamName
        self.athleteName = athleteName
        self.clerk = clerk
        self.embedded = embedded
        self.compact = compact
        self.scheduleTimeZone = scheduleTimeZone
        _model = StateObject(wrappedValue: model ?? NativeEventToolModel.shared(
            shareToken: event.shareToken, accountID: clerk.user?.id ?? NativeOfflineRuntime.shared.accountID
        ))
    }

    var body: some View {
        Group {
            if !trackingAccess.isAllowed {
                Text(trackingAccess.message(timeZone: TimeZone(identifier: event.timezone ?? scheduleTimeZone ?? "") ?? .current))
                    .padding(20)
                    .accessibilityIdentifier("native-full-tracker-locked")
            } else if embedded {
                trackerContent
            } else {
                ScrollView { trackerContent.padding(20) }
            }
        }
        .eventToolNavigationTitle("Track Stats", embedded: embedded)
        .tint(NativeEventToolColors.trackStats)
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { date in
            if access(at: date) != access(at: accessDate) { accessDate = date }
        }
        .task {
            if model.workspace == nil { await model.load(clerk: clerk) }
        }
        .sheet(isPresented: $showingFinish) { finishSheet }
        .onChange(of: trackingAccess) { _, access in
            if !access.isAllowed { showingFinish = false }
        }
        .onChange(of: model.trackerIsComplete) { _, complete in
            if complete {
                showingFinish = false
                if !embedded { dismiss() }
            }
        }
    }

    private var trackingAccess: NativeEventTrackingAccess { access(at: max(accessDate, Date())) }

    private func access(at date: Date) -> NativeEventTrackingAccess {
        guard let current = offline.workingEvent(event, subject: clerk.user?.id) else { return .complete }
        return .resolve(start: current.parsedStart(timezone: current.timezone ?? scheduleTimeZone), isGame: current.type == "game",
                 isComplete: model.trackerIsComplete || NativeEventDetailStep.gameIsComplete(eventStatus: event.status),
                 now: date)
    }

    private var trackerHeading: String {
        model.displayedGame?.status.uppercased() ?? (compact ? "Keep score" : "Track stats")
    }

    private var trackerPhase: String? {
        guard !compact, let workspace = model.workspace, let game = model.displayedGame else { return nil }
        return "\(phaseLabel(workspace: workspace, game: game)) \(game.period)"
    }

    private var trackerAdvanceLabel: String? {
        guard !compact, let workspace = model.workspace, let game = model.displayedGame else { return nil }
        return "Next \(phaseLabel(workspace: workspace, game: game).lowercased())"
    }

    private var trackerContent: some View {
            VStack(alignment: .leading, spacing: compact ? 12 : 22) {
                if !embedded { Text(event.title).font(.title2.bold()) }
                NativeTrackerSaveStatusView(model: model, clerk: clerk, title: trackerHeading,
                                            phase: trackerPhase, advanceLabel: trackerAdvanceLabel)
                if let workspace = model.workspace {
                    if let game = model.displayedGame {
                        tracker(workspace: workspace, game: game)
                    } else {
                        if compact {
                            Text("Start the game to update the team scores. Player stats are optional in the full tracker.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            HStack(alignment: .top, spacing: 20) {
                                scoreboard(teamName, score: 0, opponent: false, editable: false, showsControls: false)
                                scoreboard(event.opponent.isEmpty ? "Opponent" : event.opponent, score: 0, opponent: true, editable: false, showsControls: false)
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
                        HStack {
                            Spacer(minLength: 0)
                            Button {
                                Task { await model.save("start", clerk: clerk, soccerFormat: workspace.sport == "soccer" ? soccerFormat : nil) }
                            } label: {
                                Text(compact ? "Start game" : "Start tracking")
                                    .multilineTextAlignment(.center)
                                    .frame(minWidth: 44, minHeight: 44)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(!model.canEditTrackerLocally
                                      || event.status == "final"
                                      || workspace.eventStatus?.lowercased() == "final")
                            .accessibilityIdentifier("native-event-start-game")
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity)
                        .accessibilityIdentifier("native-event-start-game-row")
                    }
                }
            }
    }

    private func tracker(workspace: NativeEventWorkspace, game: NativeEventWorkspace.Game) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            if !compact {
                Text("TEAM SCOREBOARD")
                    .font(.caption.weight(.heavy))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("native-event-team-scoreboard-title")
            }
            HStack(alignment: .top, spacing: 20) {
                let canEditScore = game.status == "live" && model.canEditTrackerLocally
                scoreboard(teamName, score: game.score, opponent: false, editable: canEditScore, showsControls: game.status == "live")
                scoreboard(event.opponent.isEmpty ? "Opponent" : event.opponent, score: game.opponentScore, opponent: true, editable: canEditScore, showsControls: game.status == "live")
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
                modePicker
                modeBanner
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                    ForEach(Array(workspace.rules.stats.prefix(compact ? 4 : workspace.rules.stats.count))) { stat in
                        Button {
                            Task {
                                await model.save("stat", clerk: clerk, statID: stat.id,
                                                 athlete: attribution == "athlete", opponent: opponentPossession, yards: yards)
                            }
                        } label: {
                            statTileLabel(stat.label, game: game, statID: stat.id)
                        }
                        .buttonStyle(.plain)
                        .disabled(!model.canQueueStat)
                        .accessibilityLabel("Record \(stat.label) for \(trackerMode.ownerName(athlete: athleteName, team: teamName, opponent: opponentName))")
                        .accessibilityValue(statTileAccessibilityValue(game: game, statID: stat.id))
                        .accessibilityHint(trackerMode.title + " mode")
                        .accessibilityIdentifier("native-event-stat-tile-\(trackerMode.rawValue)-\(stat.id)")
                    }
                }
                .accessibilityIdentifier("native-event-stat-grid-\(trackerMode.rawValue)")
                Button("Undo last stat") { Task { await model.save("undo", clerk: clerk) } }
                    .disabled(game.events.isEmpty || game.status != "live" || !model.canEditTrackerLocally)
            } else if game.status == "paused" {
                Button("Resume game") {
                    Task { await model.save("resume", clerk: clerk) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!model.canEditTrackerLocally)
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
        .disabled(!model.canEditTrackerLocally)
        .accessibilityIdentifier("native-event-end-game")
    }

    private func scoreboard(_ label: String, score: Int, opponent: Bool, editable: Bool, showsControls: Bool) -> some View {
        VStack(spacing: 8) {
            Text(label).font(.subheadline.bold()).multilineTextAlignment(.center)
            Text("\(score)")
                .font(.system(.largeTitle, design: .rounded).bold())
                .accessibilityIdentifier("native-event-score-\(opponent ? "opponent" : "team")-value")
            if showsControls {
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
                .disabled(!editable)
                .accessibilityLabel("\(label) score")
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func adjustScore(opponent: Bool, delta: Int) {
        Task { await model.save("score", clerk: clerk, opponent: opponent, delta: delta) }
    }

    // MARK: - Tracker mode presentation (presentation only; save semantics unchanged)

    private enum TrackerMode: String {
        case athlete, team, opponent

        var title: String {
            switch self {
            case .athlete: return "Athlete"
            case .team: return "Team"
            case .opponent: return "Opponent"
            }
        }

        var symbol: String {
            switch self {
            case .athlete: return "person.fill"
            case .team: return "person.3.fill"
            case .opponent: return "shield.lefthalf.filled"
            }
        }

        var color: Color {
            switch self {
            case .athlete: return NativeEventToolColors.trackStats
            case .team: return NativeEventToolColors.prep
            case .opponent: return Color.secondary
            }
        }

        func ownerName(athlete: String, team: String, opponent: String) -> String {
            switch self {
            case .athlete: return athlete
            case .team: return team
            case .opponent: return opponent
            }
        }
    }

    private var trackerMode: TrackerMode {
        opponentPossession ? .opponent : (attribution == "athlete" ? .athlete : .team)
    }

    private var opponentName: String { event.opponent.isEmpty ? "Opponent" : event.opponent }

    private var modeSelectionInk: Color { Color(red: 0.06, green: 0.10, blue: 0.18) }

    private var modePicker: some View {
        HStack(spacing: 10) {
            modeChoice(.athlete, value: "athlete", name: athleteName)
            modeChoice(.team, value: "team", name: teamName)
        }
        .disabled(opponentPossession)
        .opacity(opponentPossession ? 0.5 : 1)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Stat attribution")
        .accessibilityIdentifier("native-event-tracker-mode-picker")
    }

    private func modeChoice(_ mode: TrackerMode, value: String, name: String) -> some View {
        let selected = !opponentPossession && attribution == value
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        return Button { attribution = value } label: {
            HStack(spacing: 8) {
                Image(systemName: selected ? "checkmark.circle.fill" : mode.symbol)
                    .font(.body.weight(.semibold))
                VStack(alignment: .leading, spacing: 0) {
                    Text(mode.title.uppercased())
                        .font(.caption2.weight(.heavy))
                        .tracking(0.8)
                    Text(name)
                        .font(.subheadline.bold())
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                }
                Spacer(minLength: 0)
            }
            .foregroundStyle(selected ? modeSelectionInk : Color.primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .background(selected ? mode.color : mode.color.opacity(0.10), in: shape)
            .overlay(shape.strokeBorder(mode.color, lineWidth: selected ? 0 : 1.5))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(mode.title) mode, \(name)")
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("native-event-tracker-mode-\(value)")
    }

    private var modeBanner: some View {
        let mode = trackerMode
        let name = mode.ownerName(athlete: athleteName, team: teamName, opponent: opponentName)
        let detail: String
        switch mode {
        case .athlete: detail = "Taps record individual stats for \(athleteName)."
        case .team: detail = "Taps count for the team only. Score buttons update the scoreboard."
        case .opponent: detail = "Opponent plays stay separate from your athlete and team."
        }
        let shape = RoundedRectangle(cornerRadius: 14, style: .continuous)
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: mode.symbol)
                .font(.title3.weight(.bold))
                .foregroundStyle(mode == .athlete ? modeSelectionInk : Color.primary)
                .frame(width: 40, height: 40)
                .background(mode == .athlete ? mode.color : mode.color.opacity(0.14), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("TRACKING \(mode.title.uppercased())")
                    .font(.caption.weight(.heavy))
                    .tracking(1)
                    .foregroundStyle(.primary)
                Text(name)
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(mode == .athlete ? mode.color.opacity(0.14) : Color.clear, in: shape)
        .overlay(
            shape.strokeBorder(mode.color.opacity(mode == .opponent ? 0.6 : 1),
                               style: StrokeStyle(lineWidth: mode == .athlete ? 0 : 1.5,
                                                  dash: mode == .opponent ? [6, 4] : []))
        )
        .overlay(alignment: .leading) {
            if mode == .athlete {
                Rectangle().fill(mode.color).frame(width: 5).clipShape(shape)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("native-event-tracker-mode-banner-\(mode.rawValue)")
    }

    private func statTileLabel(_ label: String, game: NativeEventWorkspace.Game, statID: String) -> some View {
        let mode = trackerMode
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        let total = statTotal(game: game, statID: statID)
        return VStack(spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: mode.symbol).font(.caption2.weight(.bold))
                Text(mode.title.uppercased())
                    .font(.caption2.weight(.heavy))
                    .tracking(0.6)
            }
            .foregroundStyle(.primary)
            .accessibilityHidden(true)
            Text(label).font(.subheadline.bold()).multilineTextAlignment(.center)
            Text("\(total)")
                .font(.system(.title2, design: .rounded).bold())
                .monospacedDigit()
            Text(mode == .opponent ? "opponent total" : "team total")
                .font(.caption2)
                .foregroundStyle(.secondary)
            if mode == .athlete {
                Text("\(athleteCount(game: game, statID: statID)) by \(athleteName)")
                    .font(.caption2.weight(mode == .athlete ? .bold : .regular))
                    .foregroundStyle(mode == .athlete ? Color.primary : Color.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity, minHeight: compact ? 72 : 108)
        .background(mode == .athlete ? mode.color.opacity(0.16) : mode.color.opacity(0.05), in: shape)
        .overlay(
            shape.strokeBorder(mode.color.opacity(mode == .athlete ? 0 : 0.7),
                               style: StrokeStyle(lineWidth: 1.5, dash: mode == .opponent ? [6, 4] : []))
        )
        .contentShape(shape)
    }

    private func statTileAccessibilityValue(game: NativeEventWorkspace.Game, statID: String) -> String {
        let total = statTotal(game: game, statID: statID)
        if trackerMode == .opponent { return "\(total) opponent total" }
        if trackerMode == .team { return "\(total) team total" }
        return "\(total) team total, \(athleteCount(game: game, statID: statID)) by \(athleteName)"
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
                NativeToolSaveNotice(model: model, clerk: clerk, savedContentName: "Stat Tracker")
                Button("Confirm finished game") {
                    Task {
                        await model.save("finish", clerk: clerk, recordScore: recordScore, outcome: outcome.isEmpty ? nil : outcome)
                        if model.workspace?.game?.status == "final" { showingFinish = false }
                    }
                }
                .accessibilityIdentifier("native-event-confirm-final")
                .disabled(!model.canEditTrackerLocally)
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

private struct NativeTrackerSaveStatusView: View {
    @ObservedObject var model: NativeEventToolModel
    @ObservedObject private var offline = NativeOfflineRuntime.shared
    let clerk: Clerk
    let title: String
    let phase: String?
    let advanceLabel: String?
    @State private var showingDetails = false
    @ScaledMetric(relativeTo: .caption) private var rowHeight: CGFloat = 44

    private var showsGameControls: Bool {
        guard advanceLabel != nil, let game = model.displayedGame else { return false }
        return game.status == "live" || game.status == "paused"
    }

    private struct Status {
        let message: String
        let detail: String?
        let symbol: String
        let color: Color
        let announces: Bool
    }

    private var status: Status? {
        if model.unreadablePendingData {
            return Status(
                message: "Saved tracker data needs attention",
                detail: "A saved tracker change couldn’t be read. It hasn’t been removed.",
                symbol: "exclamationmark.triangle.fill", color: .orange, announces: true
            )
        }
        if let recovery = model.trackerRecoveryStatus {
            return Status(
                message: "Saved on iPhone · PIXL needs attention",
                detail: recovery.message,
                symbol: "exclamationmark.triangle.fill", color: .orange, announces: true
            )
        }
        if model.conflictBlocked {
            return Status(
                message: "Sync paused · review Prep",
                detail: "A Prep change needs review before tracker changes can sync.",
                symbol: "exclamationmark.triangle.fill", color: .orange, announces: true
            )
        }
        if model.errorMessage != nil {
            if model.pendingCount > 0 {
                return Status(
                    message: "Saved on iPhone · PIXL hasn’t confirmed",
                    detail: "We couldn’t confirm these changes reached PIXL. They’re still saved on this iPhone.",
                    symbol: "exclamationmark.triangle.fill", color: .orange, announces: true
                )
            }
            return Status(
                message: model.workspace == nil ? "Couldn’t load tracker" : "Tracker status needs attention",
                detail: "We couldn’t confirm the latest tracker status. Try again when you’re connected.",
                symbol: "exclamationmark.triangle.fill", color: .orange, announces: true
            )
        }
        if model.pendingCount > 0 {
            if !offline.online {
                return Status(
                    message: "Saved on iPhone · waiting for connection",
                    detail: "Your tracker actions are saved on this iPhone and will sync when a connection is available.",
                    symbol: "wifi.slash", color: NativeEventToolColors.trackStats, announces: true
                )
            }
            if model.busy {
                return Status(
                    message: "Saving to PIXL…",
                    detail: "Your tracker actions are saved on this iPhone while PIXL confirms them.",
                    symbol: "arrow.triangle.2.circlepath",
                    color: NativeEventToolColors.trackStats, announces: false
                )
            }
            return Status(
                message: "Saved on iPhone · waiting to sync",
                detail: "Your tracker actions are stored on this iPhone and waiting to sync.",
                symbol: "iphone", color: NativeEventToolColors.trackStats, announces: false
            )
        }
        if model.busy {
            return Status(
                message: "Checking PIXL…",
                detail: "Checking the latest tracker status.",
                symbol: "arrow.triangle.2.circlepath",
                color: NativeEventToolColors.trackStats, announces: false
            )
        }
        if !offline.online || offline.usingSavedContent {
            return Status(
                message: "Using saved iPhone copy",
                detail: "This tracker is using the saved iPhone copy. Reconnect to confirm the latest PIXL status.",
                symbol: "wifi.slash", color: NativeEventToolColors.trackStats, announces: true
            )
        }
        // Successful saves are silent. The game heading occupies this same
        // stable row, so hiding the notice neither shifts controls nor leaves
        // an empty banner-sized gap.
        if model.workspace != nil { return nil }
        return Status(
            message: "Checking PIXL…",
            detail: "Checking the latest tracker status.",
            symbol: "arrow.triangle.2.circlepath",
            color: NativeEventToolColors.trackStats, announces: false
        )
    }

    private var canRetry: Bool {
        offline.online && !model.busy && !model.unreadablePendingData && !model.conflictBlocked
            && (model.pendingCount > 0 || model.errorMessage != nil)
    }

    var body: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(title)
                        .font(model.displayedGame == nil ? .headline : .caption.bold())
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .accessibilityIdentifier("native-event-tracker-heading")
                    if showsGameControls, let game = model.displayedGame {
                        Button(game.status == "live" ? "Pause" : "Resume") {
                            Task { await model.save(game.status == "live" ? "pause" : "resume", clerk: clerk) }
                        }
                        .font(.caption.bold())
                        .buttonStyle(.bordered)
                        .frame(minHeight: 44)
                        .disabled(!model.canEditTrackerLocally)
                        .accessibilityIdentifier("native-event-pause-resume")
                    }
                    Spacer(minLength: 4)
                    if let phase {
                        VStack(spacing: 0) {
                            Text(phase)
                                .font(.caption.bold())
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                                .accessibilityIdentifier("native-event-tracker-phase")
                            if showsGameControls, let advanceLabel {
                                Button(advanceLabel) {
                                    Task { await model.save("period", clerk: clerk) }
                                }
                                .font(.caption.bold())
                                .buttonStyle(.bordered)
                                .disabled(model.displayedGame?.status != "live" || !model.canEditTrackerLocally)
                                .accessibilityIdentifier("native-event-next-period")
                            }
                        }
                    }
                }
                if let status {
                    Label(status.message, systemImage: status.symbol)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(status.color)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .accessibilityElement(children: .ignore)
                        .accessibilityLabel("Stat Tracker save status")
                        .accessibilityValue(status.detail ?? status.message)
                        .accessibilityIdentifier("native-event-tracker-save-status")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if canRetry {
                Button {
                    Task {
                        if model.pendingCount > 0 {
                            await model.retry(clerk: clerk)
                        } else {
                            await model.load(clerk: clerk)
                        }
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(model.pendingCount > 0 ? "Retry tracker sync" : "Reload tracker")
                .accessibilityIdentifier("native-event-tracker-save-retry")
            }

            if status?.detail != nil {
                Button {
                    showingDetails = true
                } label: {
                    Image(systemName: "info.circle")
                        .frame(width: 44, height: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Stat Tracker save details")
                .accessibilityIdentifier("native-event-tracker-save-details")
            }
        }
        .padding(.horizontal, 8)
        .frame(maxWidth: .infinity)
        // Reserve the controls' height independently of transient save messages.
        // Compact scorekeeping retains its existing 44-point status row.
        .frame(height: rowHeight + (showsGameControls ? 24 : 0))
        .background((status?.color ?? .clear).opacity(0.10), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityIdentifier("native-event-tracker-save-status-row")
        .onChange(of: status?.message) { _, message in
            if message == nil { showingDetails = false }
            guard let status, status.announces, let message else { return }
            UIAccessibility.post(notification: .announcement, argument: message)
        }
        .alert("Stat Tracker status", isPresented: $showingDetails) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(status?.detail ?? status?.message ?? "")
        }
    }
}
