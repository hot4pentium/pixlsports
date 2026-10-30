import SwiftUI
import ClerkKit
#if os(iOS) || os(macOS)
import ClerkKitUI
#endif

struct NativeAuthRootView: View {
    @Environment(Clerk.self) private var clerk
    @State private var loadingTimedOut = false
    @State private var retrying = false
    @State private var startupError: String?
    @State private var showingAccountLink = false

    var body: some View {
#if os(iOS) || os(macOS)
        Group {
            if !clerk.isLoaded {
                startupView
            } else if clerk.isAuthFlowComplete {
                NavigationStack {
                    ContentView(clerk: clerk, showingAccountLink: $showingAccountLink)
                        // Tear down previous user's screen state on account switches.
                        .id(clerk.user?.id)
                        .toolbar {
                            ToolbarItem(placement: .automatic) {
                                Button {
                                    showingAccountLink = true
                                } label: {
                                    Label("PIXL connection", systemImage: "link")
                                }
                            }
                            ToolbarItem(placement: .automatic) {
                                UserButton()
                                    .accessibilityLabel("Manage iPhone account")
                            }
                        }
                        .sheet(isPresented: $showingAccountLink) {
                            NativeAccountLinkView().id(clerk.user?.id)
                        }
                }
            } else {
                VStack(spacing: 0) {
                    VStack(spacing: 8) {
                        Text("PIXL SPORTS")
                            .font(.headline)
                            .tracking(2)
                        Text("Sign in to the iPhone app")
                            .font(.title2.bold())
                        Text("Sign in here, then securely connect your existing PIXL web account from the link button on home.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                    // Only one root AuthView: let Clerk finish verification,
                    // MFA, and any required session tasks before showing home.
                    AuthView(isDismissible: false)
                }
            }
        }
        .prefetchClerkImages()
        .task(id: clerk.isLoaded) {
            guard !clerk.isLoaded else {
                loadingTimedOut = false
                startupError = nil
                return
            }
            do {
                try await Task.sleep(for: .seconds(12))
                guard !Task.isCancelled, !clerk.isLoaded else { return }
                loadingTimedOut = true
            } catch {
                // The task is cancelled when Clerk loads or this view disappears.
            }
        }
#else
        NativeAuthSetupView(message: "Run the PIXL Sports iPhone target to use native sign-in.")
#endif
    }

    private var startupView: some View {
        VStack(spacing: 18) {
            if loadingTimedOut || startupError != nil {
                Image(systemName: "wifi.exclamationmark")
                    .font(.largeTitle)
                Text("Sign-in isn’t ready")
                    .font(.title2.bold())
                Text(startupError ?? "Check your connection. If this continues, check the iOS Clerk key and Native API settings.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                Button(retrying ? "Trying again…" : "Try again") {
                    Task { await retryStartup() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(retrying)
            } else {
                ProgressView()
                Text("Preparing secure sign-in…")
            }
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @MainActor
    private func retryStartup() async {
        guard !retrying else { return }
        retrying = true
        defer { retrying = false }
        startupError = nil
        do {
            // Refresh both pieces needed by isLoaded, without reconfiguring
            // the SDK or discarding a previously persisted device session.
            _ = try await clerk.refreshEnvironment()
            _ = try await clerk.refreshClient()
            if !clerk.isLoaded {
                startupError = "Sign-in could not finish loading. Check the iOS Clerk application settings and try again."
            }
        } catch {
            // Do not expose SDK responses or configuration values in error copy.
            startupError = "We couldn’t connect to sign-in. Check your connection and iOS Clerk settings, then try again."
        }
    }
}

struct NativeAuthSetupView: View {
    let message: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "key.fill")
                .font(.largeTitle)
            Text("Finish iPhone sign-in setup")
                .font(.title2.bold())
            Text(message)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
