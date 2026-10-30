import SwiftUI
import ClerkKit

struct NativeAccountLinkView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase
    @State private var model = NativeAccountLinkModel()
    @State private var confirmingDisconnect = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Your PIXL web account", systemImage: "link")
                        .font(.title3.bold())
                    Text("Connect your iPhone sign-in to the PIXL account you already use on the web. Both sign-ins are required; matching email addresses never connects accounts.")
                    Text("The home screen still uses your saved public athlete-page link. Connecting accounts does not change that link.")
                        .font(.footnote).foregroundStyle(.secondary)
                }
#if DEBUG
                Section("Development API — installed app") {
                    if let origin = try? NativeAccountLinkClient.apiOrigin() {
                        Text(origin.absoluteString)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                    } else {
                        Text("No valid development API address is bundled in this build.")
                            .font(.footnote)
                    }
                    Text("Read from this installed app’s ClerkConfig.plist. No sign-in keys are shown.")
                        .font(.caption).foregroundStyle(.secondary)
                }
#endif
                if let error = model.error {
                    Section {
                        Text(error).foregroundStyle(.red).accessibilityLabel("Error: \(error)")
                        Button("Check connection again") { Task { await model.refresh(clerk: clerk) } }
                    }
                }
                if model.linked {
                    Section("Connected") {
                        Label(model.state?.accountLabel ?? "Your PIXL account", systemImage: "checkmark.shield")
                        Text("You can disconnect here or from Account information on the PIXL website. Neither account will be deleted.")
                            .font(.footnote)
                        Button("Disconnect PIXL account", role: .destructive) { confirmingDisconnect = true }
                    }
                } else if model.hasAttempt && !model.finished {
                    Section("1. Approve on the PIXL website") {
                        Text(model.userCode ?? "").font(.system(.largeTitle, design: .monospaced).bold())
                            .textSelection(.enabled).accessibilityLabel("Linking code \(model.userCode ?? "")")
                        Text("Enter this code yourself while signed in to your existing PIXL web account. Never send it to someone else. It expires in ten minutes.")
                        if let url = model.verificationURL {
                            Button("Open PIXL website") { openURL(url) }
                        }
                    }
                    Section("2. Confirm on this iPhone") {
                        if model.approved {
                            Text("The web account below approved this request. Only confirm if it is your account.")
                            Text(model.state?.accountLabel ?? "Approved PIXL account").font(.headline)
                            Button("Confirm this account") { Task { await model.confirm(clerk: clerk) } }
                                .buttonStyle(.borderedProminent)
                        } else {
                            Label("Waiting for web approval", systemImage: "clock")
                            Text("Return here after approving the code on the website.")
                        }
                        Button("Cancel this attempt", role: .destructive) { Task { await model.cancel(clerk: clerk) } }
                    }
                } else {
                    Section {
                        if model.finished {
                            Text("This request was \(model.state?.status ?? "cancelled"). No new connection was created.")
                        }
                        Button(model.finished ? "Start a new attempt" : "Connect existing PIXL account") {
                            Task { await model.begin(clerk: clerk) }
                        }
                        .buttonStyle(.borderedProminent)
                        if model.state == nil && model.error == nil { ProgressView("Checking connection…") }
                    }
                }
                if model.busy { Section { ProgressView("Saving connection…") } }
            }
            .disabled(model.busy)
            .navigationTitle("PIXL connection")
#if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
#endif
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .confirmationDialog("Disconnect your PIXL account?", isPresented: $confirmingDisconnect, titleVisibility: .visible) {
                Button("Disconnect", role: .destructive) { Task { await model.disconnect(clerk: clerk) } }
                Button("Keep connected", role: .cancel) {}
            } message: { Text("This removes the account link only. Neither account or its saved data will be deleted.") }
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                await model.refresh(clerk: clerk)
                while !Task.isCancelled {
                    do { try await Task.sleep(for: .seconds(5)) } catch { return }
                    await model.refresh(clerk: clerk)
                }
            }
        }
    }
}
