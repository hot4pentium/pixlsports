#if os(iOS)
import SwiftUI
import ClerkKit
import UIKit

struct NativeOfflineStorageView: View {
    let clerk: Clerk
    @ObservedObject private var offline = NativeOfflineRuntime.shared
    @State private var namespace = NativeOfflineVault.shared.namespace
    @State private var snapshot: NativeOfflineStorageSnapshot?
    @State private var errorMessage: String?
    @State private var notice: String?
    @State private var removal: Removal?
    @State private var downloading: String?

    private struct Removal: Identifiable {
        let token: String?
        let title: String
        var id: String { token ?? "all" }
    }
    private var hasAccess: Bool {
        namespace != nil && namespace == offline.vault.namespace
            && offline.vault.canContinue(subject: clerk.user?.id)
    }
    private func bytes(_ count: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(count), countStyle: .file)
    }

    var body: some View {
        Form {
            if hasAccess, let snapshot {
                Section("Protected iPhone storage") {
                    LabeledContent("Total saved", value: bytes(snapshot.totalBytes))
                    LabeledContent("Protected & recovery data", value: bytes(snapshot.protectedBytes))
                    LabeledContent("Removable downloads", value: bytes(snapshot.removableBytes))
                    if let available = snapshot.deviceAvailableBytes {
                        LabeledContent("Device space available", value: bytes(Int(available)))
                    }
                    Text("Encrypted and available only to this verified account on this iPhone. Queued Tracker changes, Prep drafts, and their base workspaces are never removed here. Your saved dashboard and profile are kept for recovery.")
                        .font(.footnote)
                    Text("Downloads use about 60 MB, with reserved space for pending work up to 80 MB. iPhone free space may limit saves sooner.")
                        .font(.footnote).foregroundStyle(.secondary)
                    if snapshot.lowStorage {
                        Label("Storage is running low. Remove disposable downloads or free space in iPhone Settings. Reconnect to sync pending changes; drafts remain protected.", systemImage: "exclamationmark.triangle")
                            .accessibilityIdentifier("native-storage-low")
                    }
                    Button("Remove disposable downloads", role: .destructive) {
                        removal = Removal(token: nil, title: "Remove disposable downloads?")
                    }
                    .disabled(snapshot.removableBytes == 0 || downloading != nil)
                    .accessibilityIdentifier("native-storage-remove-all")
                }
                Section("Downloaded events") {
                    if snapshot.events.isEmpty {
                        Text("No events downloaded. Open an event online to make Prep and Tracker available without reception.")
                    }
                    ForEach(snapshot.events) { event in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(event.title).font(.headline)
                            Text(event.detail).font(.subheadline).foregroundStyle(.secondary)
                            Label(event.ready ? "Available offline · \(bytes(event.bytes))" : "Needs an online download",
                                  systemImage: event.ready ? "checkmark.circle" : "arrow.down.circle")
                            if event.protected {
                                Text("Saved work or recovery data protected. Sync queued changes and save your Prep draft online before removing this event.")
                                    .font(.footnote)
                                if !event.ready {
                                    Text("The base download needs recovery. Your pending changes have not been deleted. Reconnect and open the event.")
                                        .font(.footnote)
                                }
                            } else if event.bytes > 0 {
                                Button("Remove download", role: .destructive) {
                                    removal = Removal(token: event.id, title: "Remove \(event.title) download?")
                                }
                                .disabled(downloading != nil)
                                .accessibilityLabel("Remove download for \(event.title), \(event.detail)")
                                .accessibilityIdentifier("native-storage-remove-\(event.id)")
                            }
                            if !event.ready {
                                Button("Download again") { download(event.id) }
                                    .disabled(!offline.online || downloading != nil)
                                    .accessibilityLabel("Download \(event.title) again, \(event.detail)")
                                    .accessibilityIdentifier("native-storage-download-\(event.id)")
                            }
                        }
                        .padding(.vertical, 4)
                        .accessibilityElement(children: .contain)
                    }
                }
                Section {
                    Text("Removing a download does not delete the event or anything already synced. Its Prep and Tracker need a connection to download again. Removed events stay out of automatic preparation until downloaded again. Photos may download again when viewed online. Videos are not saved here.")
                    Text("Saved access still expires up to 7 days after verification. Storage choices never sign you in or grant account access.")
                }
                .font(.footnote).foregroundStyle(.secondary)
            } else if !hasAccess {
                Section {
                    Text("Reconnect and sign in to this account to manage its protected saved content. Pending changes have not been deleted.")
                }
            }
            if downloading != nil { ProgressView("Downloading event") }
            if let notice {
                Text(notice).accessibilityIdentifier("native-storage-notice")
            }
            if let errorMessage {
                Text(errorMessage).foregroundStyle(.red)
                    .accessibilityIdentifier("native-storage-error")
            }
        }
        .navigationTitle("Saved iPhone content")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("native-offline-storage")
        .task { refresh() }
        .onReceive(offline.objectWillChange) { _ in
            // Published changes emit before mutation. Read the settled identity.
            Task { @MainActor in refresh() }
        }
        .onChange(of: notice) { _, message in
            if hasAccess, let message { UIAccessibility.post(notification: .announcement, argument: message) }
        }
        .onChange(of: errorMessage) { _, message in
            if hasAccess, let message { UIAccessibility.post(notification: .announcement, argument: message) }
        }
        .alert(item: $removal) { request in
            Alert(title: Text(request.title),
                  message: Text("Only disposable downloads will be removed from this iPhone. Pending Tracker changes, Prep drafts, and recovery data stay protected. Removed events need an online download before offline use."),
                  primaryButton: .destructive(Text("Remove download")) { remove(request) },
                  secondaryButton: .cancel())
        }
    }

    private func refresh() {
        guard hasAccess else {
            snapshot = nil
            removal = nil
            notice = nil
            errorMessage = nil
            return
        }
        do {
            snapshot = try offline.vault.storageSnapshot(subject: clerk.user?.id)
        } catch {
            snapshot = nil
            errorMessage = error.localizedDescription
        }
    }

    private func remove(_ request: Removal) {
        guard hasAccess, let namespace else { refresh(); return }
        do {
            try offline.removeDownloads(event: request.token, subject: clerk.user?.id, namespace: namespace)
            notice = "Disposable content removed. Pending changes and recovery data were kept."
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
        refresh()
    }

    private func download(_ token: String) {
        guard hasAccess, let namespace else { return }
        downloading = token
        Task { @MainActor in
            defer { downloading = nil; refresh() }
            do {
                try await offline.downloadEvent(token, clerk: clerk, namespace: namespace)
                guard hasAccess else { return }
                errorMessage = nil
                notice = "Event downloaded for offline use."
            } catch {
                guard hasAccess else { return }
                errorMessage = error.localizedDescription
            }
        }
    }
}
#endif
