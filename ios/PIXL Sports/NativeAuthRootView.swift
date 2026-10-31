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
                ZStack {
                    signInBackdrop
                    VStack(spacing: 0) {
                        signInHeader
                        // Keep Clerk's complete native flow (email, Google,
                        // verification, and recovery) while applying PIXL's theme.
                        AuthView(isDismissible: false)
                            .environment(\.clerkTheme, clerkTheme)
                            .padding(.horizontal, 14)
                            .padding(.bottom, 16)
                    }
                    .frame(maxWidth: 560)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .preferredColorScheme(.dark)
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

    private var signInHeader: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(spacing: 12) {
                Image(systemName: "sportscourt.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(SupporterHomeColors.background)
                    .frame(width: 46, height: 46)
                    .background(
                        SupporterHomeColors.accent,
                        in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                    )
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text("PIXL")
                        .font(.system(size: 19, weight: .black, design: .rounded))
                        .tracking(2.2)
                        .foregroundStyle(.white)
                    Text("SPORTS")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .tracking(3.2)
                        .foregroundStyle(SupporterHomeColors.muted)
                }

                Spacer()

                Text("FAMILY ACCESS")
                    .font(.system(size: 9, weight: .heavy, design: .rounded))
                    .tracking(1.5)
                    .foregroundStyle(SupporterHomeColors.muted)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 8)
                    .background(.white.opacity(0.07), in: Capsule())
            }

            VStack(alignment: .leading, spacing: 9) {
                HStack(spacing: 8) {
                    Capsule()
                        .fill(SupporterHomeColors.accent)
                        .frame(width: 23, height: 3)
                    Text("YOUR SEASON STARTS HERE")
                        .font(.system(size: 10, weight: .heavy, design: .rounded))
                        .tracking(2.1)
                        .foregroundStyle(SupporterHomeColors.accent)
                }

                Text("Game day,\nall in one place.")
                    .font(.system(size: 32, weight: .black, design: .rounded))
                    .tracking(-0.7)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Use email or Google to sign in. If you already use PIXL on the web, connect that account after sign-in.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 26)
        .padding(.top, 18)
        .padding(.bottom, 14)
    }

    private var signInBackdrop: some View {
        ZStack {
            LinearGradient(
                colors: [
                    SupporterHomeColors.background,
                    Color(red: 0.025, green: 0.11, blue: 0.22),
                    Color(red: 0.025, green: 0.075, blue: 0.15)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            RadialGradient(
                colors: [SupporterHomeColors.blue.opacity(0.28), .clear],
                center: .topTrailing,
                startRadius: 0,
                endRadius: 420
            )
            RadialGradient(
                colors: [SupporterHomeColors.accent.opacity(0.08), .clear],
                center: .bottomLeading,
                startRadius: 0,
                endRadius: 360
            )
            Image(systemName: "sportscourt.fill")
                .font(.system(size: 250, weight: .regular))
                .foregroundStyle(.white.opacity(0.025))
                .rotationEffect(.degrees(-12))
                .offset(x: 150, y: -240)
            Canvas { context, size in
                var grid = Path()
                for x in stride(from: CGFloat.zero, through: size.width, by: CGFloat(38)) {
                    grid.move(to: CGPoint(x: x, y: 0))
                    grid.addLine(to: CGPoint(x: x, y: size.height))
                }
                for y in stride(from: CGFloat.zero, through: size.height, by: CGFloat(38)) {
                    grid.move(to: CGPoint(x: 0, y: y))
                    grid.addLine(to: CGPoint(x: size.width, y: y))
                }
                context.stroke(grid, with: .color(.white.opacity(0.028)), lineWidth: 0.5)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }

    private var clerkTheme: ClerkTheme {
        var theme = ClerkTheme()
        theme.colors.background = SupporterHomeColors.panel
        theme.colors.border = .white.opacity(0.14)
        theme.colors.foreground = .white
        theme.colors.input = .white.opacity(0.07)
        theme.colors.inputForeground = .white
        theme.colors.muted = .white.opacity(0.06)
        theme.colors.mutedForeground = SupporterHomeColors.muted
        theme.colors.primary = SupporterHomeColors.accent
        theme.colors.primaryForeground = SupporterHomeColors.background
        theme.colors.ring = SupporterHomeColors.blue
        theme.fonts = .init(fontFamily: "Avenir Next")
        theme.design = .init(borderRadius: 16)
        return theme
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
