import SwiftUI
import ClerkKit

/// Reads confirmed server prep only; never restores or writes an editor draft.
@MainActor
struct NativeEventPrepSummaryView: View {
    let shareToken: String
    let clerk: Clerk?
    var fixturePrep: NativeEventWorkspace.Prep? = nil
    @State private var state: SnapshotState = .loading
    @State private var expanded = false

    private enum SnapshotState {
        case loading
        case ready(NativeEventWorkspace.Prep, identity: String)
        case failed(String)
    }

    private var requestIdentity: String {
        "\(shareToken):\(clerk?.user?.id ?? "signed-out")"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Label("Saved prep", systemImage: "checklist")
                    .font(.headline)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                Text("Read only")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.muted)
            }
            snapshotContent
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 22))
        .overlay {
            RoundedRectangle(cornerRadius: 22)
                .strokeBorder(Color.white.opacity(0.10), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("event-detail-prep-summary")
        .task(id: requestIdentity) { await load() }
    }

    @ViewBuilder
    private var snapshotContent: some View {
        switch state {
        case .loading:
            loadingContent
        case let .ready(prep, identity):
            if identity == requestIdentity {
                savedContent(prep)
            } else {
                loadingContent
            }
        case let .failed(message):
            VStack(alignment: .leading, spacing: 10) {
                Label(message, systemImage: "exclamationmark.triangle")
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Retry prep summary") { Task { await load() } }
                    .font(.subheadline.weight(.bold))
                    .foregroundStyle(SupporterHomeColors.accent)
                    .accessibilityIdentifier("event-detail-prep-retry")
            }
        }
    }

    private var loadingContent: some View {
        HStack(spacing: 10) {
            ProgressView().tint(SupporterHomeColors.accent)
            Text("Loading saved prep…")
                .font(.subheadline)
                .foregroundStyle(SupporterHomeColors.muted)
        }
    }

    private func savedContent(_ prep: NativeEventWorkspace.Prep) -> some View {
        let readyCount = prep.items.filter(\.completed).count
        let visibleItems = Array(prep.items.prefix(expanded ? prep.items.count : 4))
        let hasNotes = !prep.notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return VStack(alignment: .leading, spacing: 12) {
            if prep.items.isEmpty {
                Text("No checklist tasks saved yet. Use Prep below to get ready.")
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .accessibilityIdentifier("event-detail-prep-empty")
            } else {
                Text("\(readyCount) of \(prep.items.count) ready")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.accent)
                    .accessibilityIdentifier("event-detail-prep-progress")
                ProgressView(value: Double(readyCount), total: Double(prep.items.count))
                    .tint(SupporterHomeColors.accent)
                ForEach(visibleItems) { item in
                    HStack(alignment: .top, spacing: 9) {
                        Image(systemName: item.completed ? "checkmark.circle.fill" : "circle")
                            .foregroundStyle(item.completed ? SupporterHomeColors.accent : SupporterHomeColors.muted)
                            .accessibilityHidden(true)
                        Text(item.label)
                            .font(.subheadline)
                            .foregroundStyle(item.completed ? SupporterHomeColors.muted : .white)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(item.completed ? "Ready" : "Not ready"): \(item.label)")
                    .accessibilityIdentifier("event-detail-prep-item-\(item.id)")
                }
            }
            if hasNotes {
                Divider().overlay(Color.white.opacity(0.10))
                Text("Notes").font(.caption.weight(.bold)).foregroundStyle(SupporterHomeColors.accent)
                Text(prep.notes)
                    .font(.subheadline)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .lineLimit(expanded ? nil : 3)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("event-detail-prep-notes")
            }
            if prep.items.count > 4 || hasNotes {
                Button(expanded ? "Show less" : "Show full prep") { expanded.toggle() }
                    .font(.caption.weight(.bold))
                    .foregroundStyle(SupporterHomeColors.accent)
                    .accessibilityIdentifier("event-detail-prep-expand")
            }
        }
    }

    private func load() async {
        let identity = requestIdentity
        state = .loading
        if let fixturePrep {
            state = .ready(fixturePrep, identity: identity)
            return
        }
        guard let clerk, clerk.user?.id != nil else {
            state = .failed("Sign in to view saved prep.")
            return
        }
        do {
            let data = try await NativeAccountLinkClient().postData(
                "supporter/event-workspace", body: ["shareToken": shareToken], clerk: clerk
            )
            let workspace = try JSONDecoder().decode(NativeEventWorkspace.self, from: data)
            guard !Task.isCancelled, identity == requestIdentity else { return }
            state = .ready(workspace.prep, identity: identity)
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled, identity == requestIdentity else { return }
            state = .failed(error.localizedDescription)
        }
    }
}
