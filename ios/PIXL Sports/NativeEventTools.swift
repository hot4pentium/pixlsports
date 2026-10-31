import SwiftUI
import Combine
import ClerkKit

extension Notification.Name {
    static let nativeEventToolsSaved = Notification.Name("pixl.nativeEventToolsSaved")
}

struct NativePrepItem: Codable, Identifiable, Equatable {
    var id: String
    var label: String
    var completed: Bool
    var section: String?
}

struct NativeEventWorkspace: Decodable {
    struct Prep: Decodable {
        let items: [NativePrepItem]
        let notes: String
    }
    struct Rules: Decodable {
        struct Stat: Decodable, Identifiable {
            let id: String
            let label: String
            let points: Int
        }
        let phaseLabel: String
        let stats: [Stat]
    }
    struct Game: Decodable {
        struct Play: Decodable, Identifiable {
            let id: String
            let statId: String
            let attribution: String?
            let possessionSide: String?
            let period: Int
            let yards: Int?
        }
        let id: String
        let sport: String
        let status: String
        let period: Int
        let soccerPeriodFormat: String?
        let score: Int
        let opponentScore: Int
        let scoreRecorded: Bool?
        let outcome: String?
        let stats: [String: Int]
        let opponentStats: [String: Int]?
        let events: [Play]
        var hasRecordedScore: Bool { scoreRecorded ?? (score != 0 || opponentScore != 0) }
    }
    let linkId: String
    let prepRevision: Int
    let trackerRevision: Int
    let sport: String
    let prep: Prep
    let rules: Rules
    let game: Game?
}

struct NativeEventToolCommand: Codable {
    let shareToken: String
    let mutationId: String
    let linkId: String
    let expectedRevision: Int
    let kind: String
    var statId: String? = nil
    var athlete: Bool? = nil
    var opponent: Bool? = nil
    var yards: Int? = nil
    var delta: Int? = nil
    var soccerFormat: String? = nil
    var recordScore: Bool? = nil
    var outcome: String? = nil
    var items: [NativePrepItem]? = nil
    var notes: String? = nil
}

/// Each saved tap is acknowledged by the server before another can be sent.
/// A timed-out request keeps the same mutation ID, including after relaunch.
@MainActor
final class NativeEventToolModel: ObservableObject {
    @Published var workspace: NativeEventWorkspace?
    @Published var busy = false
    @Published var errorMessage: String?
    @Published var pending: NativeEventToolCommand?
    @Published var reloadGeneration = 0
    private let shareToken: String
    private let storageKey: String

    init(shareToken: String, accountID: String) {
        self.shareToken = shareToken
        storageKey = "pixl-native-event-pending:\(accountID):\(shareToken)"
        if let data = UserDefaults.standard.data(forKey: storageKey) {
            pending = try? JSONDecoder().decode(NativeEventToolCommand.self, from: data)
        }
    }

    func load(clerk: Clerk) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let data = try await NativeAccountLinkClient().postData(
                "supporter/event-workspace", body: ["shareToken": shareToken], clerk: clerk
            )
            workspace = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
            errorMessage = pending == nil ? nil : "A previous change is waiting for confirmation. Retry it before making another change."
        } catch { errorMessage = error.localizedDescription }
    }

    func save(
        _ kind: String, clerk: Clerk, statID: String? = nil,
        athlete: Bool? = nil, opponent: Bool? = nil, yards: Int? = nil,
        delta: Int? = nil, soccerFormat: String? = nil,
        recordScore: Bool? = nil, outcome: String? = nil,
        items: [NativePrepItem]? = nil, notes: String? = nil
    ) async {
        guard !busy, pending == nil, let workspace else { return }
        var command = NativeEventToolCommand(
            shareToken: shareToken, mutationId: UUID().uuidString,
            linkId: workspace.linkId,
            expectedRevision: kind == "prep" ? workspace.prepRevision : workspace.trackerRevision,
            kind: kind
        )
        command.statId = statID
        command.athlete = athlete
        command.opponent = opponent
        command.yards = yards
        command.delta = delta
        command.soccerFormat = soccerFormat
        command.recordScore = recordScore
        command.outcome = outcome
        command.items = items
        command.notes = notes
        do {
            let encoded = try JSONEncoder().encode(command)
            UserDefaults.standard.set(encoded, forKey: storageKey)
            pending = command
            await retry(clerk: clerk)
        } catch { errorMessage = "The pending change could not be prepared. Nothing was sent." }
    }

    func retry(clerk: Clerk) async {
        guard !busy, let pending else { return }
        busy = true
        errorMessage = nil
        defer { busy = false }
        do {
            let data = try await NativeAccountLinkClient().postData(
                "supporter/event-workspace-save", body: pending, clerk: clerk
            )
            workspace = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
            self.pending = nil
            UserDefaults.standard.removeObject(forKey: storageKey)
            NotificationCenter.default.post(name: .nativeEventToolsSaved, object: nil)
        } catch {
            errorMessage = "\(error.localizedDescription) Your pending change has been kept on this iPhone."
        }
    }

    func discardAndReload(clerk: Clerk) async {
        guard !busy else { return }
        pending = nil
        UserDefaults.standard.removeObject(forKey: storageKey)
        await load(clerk: clerk)
        reloadGeneration += 1
    }
}

struct NativeToolSaveNotice: View {
    @ObservedObject var model: NativeEventToolModel
    let clerk: Clerk
    var hasUnsavedChanges = false
    @State private var confirmingDiscard = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if model.busy {
                HStack { ProgressView(); Text("Syncing with PIXL…") }
            }
            if let message = model.errorMessage {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                if model.pending != nil {
                    Button("Retry pending save") { Task { await model.retry(clerk: clerk) } }
                    Button("Discard pending change and reload", role: .destructive) {
                        confirmingDiscard = true
                    }
                } else {
                    Button("Try again") { Task { await model.load(clerk: clerk) } }
                }
            } else if model.workspace != nil && !model.busy {
                Label(hasUnsavedChanges ? "Unsaved prep changes" : "Connected to your PIXL account",
                      systemImage: hasUnsavedChanges ? "pencil.circle" : "checkmark.shield")
                    .font(.caption)
            }
        }
        .disabled(model.busy)
        .confirmationDialog("Discard this pending change?", isPresented: $confirmingDiscard, titleVisibility: .visible) {
            Button("Discard and reload", role: .destructive) {
                Task { await model.discardAndReload(clerk: clerk) }
            }
        } message: {
            Text("The server may already have saved it. Reloading checks the latest saved data; an unsent change will not be applied.")
        }
    }
}
