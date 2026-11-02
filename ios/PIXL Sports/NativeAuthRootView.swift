import SwiftUI
import ClerkKit
#if os(iOS) || os(macOS)
import ClerkKitUI
#endif

struct NativeAuthRootView: View {
    @AppStorage("pixl.native.account-removal-receipt") private var accountRemovalReceiptScope = ""
    @AppStorage("pixl.native.account-removal-reference") private var accountRemovalSupportReference = ""
    @AppStorage("pixl.native.signout-pending") private var localSignOutPending = false
    @Environment(Clerk.self) private var clerk
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var loadingTimedOut = false
    @State private var retrying = false
    @State private var startupError: String?
    @State private var showingAccountLink = false
    @State private var showingSettings = false
    @State private var authPresentationID = UUID()
    @ObservedObject private var offline = NativeOfflineRuntime.shared
    @Environment(\.scenePhase) private var offlineScenePhase

    private var allowsSavedDashboard: Bool {
        accountRemovalReceiptScope.isEmpty && offline.vault.canContinue(subject: clerk.user?.id)
            && (!offline.online || (!clerk.isLoaded && loadingTimedOut))
    }
    private var currentAccountNeedsVerification: Bool {
        clerk.isAuthFlowComplete && offline.vault.subject == clerk.user?.id && offline.needsRevalidation
    }
#if os(iOS)
    @StateObject private var notificationCoordinator = NativePushRegistrationCoordinator()
#endif

    var body: some View {
#if os(iOS) || os(macOS)
        Group {
            if localSignOutPending {
                NativeLaunchSplashView(
                    errorTitle: "Finish signing out",
                    errorMessage: startupError ?? "Your private dashboard is locked. Connect to finish signing out.",
                    isRetrying: retrying,
                    onRetry: { Task { await finishLocalSignOut() } }
                )
            } else if !accountRemovalReceiptScope.isEmpty {
                NativeAccountRemovalReceiptView(scope: accountRemovalReceiptScope,
                                               supportReference: accountRemovalSupportReference,
                                               isContinuing: retrying, errorMessage: startupError) {
                    Task { await finishRemovalReceipt() }
                }
                .preferredColorScheme(.light)
            } else if currentAccountNeedsVerification ||
                ((!clerk.isLoaded || !offline.online || (offline.usingSavedContent && !offline.canContinue)) && !allowsSavedDashboard) {
                startupView
            } else if clerk.isAuthFlowComplete || allowsSavedDashboard {
                NavigationStack {
                    ContentView(
                        clerk: clerk,
                        showingAccountLink: $showingAccountLink,
                        showingSettings: $showingSettings
                    )
                        // Tear down previous user's screen state on account switches.
                        .id((clerk.user?.id ?? offline.vault.subject ?? "signed-out") + ":\(offline.revocationGeneration)")
                        .sheet(isPresented: $showingAccountLink) {
                            NativeAccountLinkView().id(clerk.user?.id)
                        }
#if os(iOS)
                        .sheet(isPresented: $showingSettings) {
                            NativeNotificationSettingsView(
                                clerk: clerk
                            )
                            .environmentObject(notificationCoordinator)
                        }
                        .task(id: clerk.user?.id) {
                            if let subject = clerk.user?.id, let saved = offline.vault.subject, subject != saved {
                                NativeLocalEventReminderCoordinator.shared.cancel(resetSelection: true)
                            }
                            NativeLocalEventReminderCoordinator.shared.restore()
                            guard clerk.user != nil, offline.online else { return }
                            await notificationCoordinator.configure(clerk: clerk)
                        }
#endif
                }
            } else {
                ZStack {
                    signInBackdrop
                    GeometryReader { geometry in
                        ScrollView {
                            VStack(spacing: 0) {
                                signInHeader
                                // AuthView owns a NavigationStack. Give it a finite
                                // viewport rather than an unconstrained scroll height.
                                AuthView(isDismissible: false)
                                    .id(authPresentationID)
                                    .environment(\.clerkTheme, clerkTheme)
                                    .frame(height: geometry.size.height.isFinite
                                        ? max(560, geometry.size.height - 240)
                                        : 560)
                                    .padding(.bottom, 16)
                            }
                            .frame(maxWidth: 560)
                            // Apply the same outer gutter to the header and form.
                            .padding(.horizontal, 14)
                            .frame(maxWidth: .infinity)
                        }
                        .scrollIndicators(.hidden)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .preferredColorScheme(.light)
            }
        }
        .onChange(of: offline.online) { _, connected in
            if connected, clerk.isAuthFlowComplete {
                offline.resume(clerk: clerk, force: true)
#if os(iOS)
                Task { await notificationCoordinator.configure(clerk: clerk) }
#endif
            }
        }
        .onChange(of: offlineScenePhase) { _, phase in
            if phase == .active, clerk.isAuthFlowComplete {
                offline.resume(clerk: clerk)
#if os(iOS)
                Task { await notificationCoordinator.configure(clerk: clerk) }
#endif
            }
            else if phase != .active { offline.pause() }
        }
        .prefetchClerkImages()
        .onChange(of: clerk.user?.id) { previousUserID, currentUserID in
#if os(iOS)
            if (previousUserID != nil && previousUserID != currentUserID)
                || (currentUserID != nil && offline.vault.subject != nil && currentUserID != offline.vault.subject) {
                NativeLocalEventReminderCoordinator.shared.cancel(resetSelection: true)
            }
#endif
            guard previousUserID != nil, currentUserID == nil else { return }
            showingSettings = false
            showingAccountLink = false
            if offline.online {
                // A session expiring is not permission to discard pending work.
                offline.deny(status: 401)
            }
            // A completed auth flow must not be reused for the next sign-in.
            // Do not reset during sign-in or pending verification/MFA steps.
            authPresentationID = UUID()
        }
        .task(id: clerk.isLoaded) {
            guard !clerk.isLoaded else {
                loadingTimedOut = false
                startupError = nil
                if offline.online, !clerk.isAuthFlowComplete, offline.vault.subject != nil {
                    // A confirmed empty SDK session is different from the SDK
                    // still loading offline; keep unsent work locked for reauth.
                    offline.deny(status: 401)
                }
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
            let brandLayout = dynamicTypeSize.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                : AnyLayout(HStackLayout(spacing: 12))
            brandLayout {
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
                        .font(.title3.weight(.black))
                        .fontDesign(.rounded)
                        .tracking(2.2)
                        .foregroundStyle(.white)
                    Text("SPORTS")
                        .font(.caption.weight(.bold))
                        .fontDesign(.rounded)
                        .tracking(3.2)
                        .foregroundStyle(SupporterHomeColors.muted)
                }

                if !dynamicTypeSize.isAccessibilitySize {
                    Spacer(minLength: 0)
                }

                Text("FAMILY ACCESS")
                    .font(.caption2.weight(.heavy))
                    .fontDesign(.rounded)
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
                        .font(.caption.weight(.heavy))
                        .fontDesign(.rounded)
                        .tracking(2.1)
                        .foregroundStyle(SupporterHomeColors.accent)
                }

                Text("Game day,\nall in one place.")
                    .font(.largeTitle.weight(.black))
                    .fontDesign(.rounded)
                    .tracking(-0.7)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Sign in or create an account with email or Google. Set up your athlete and manage your Event Cards right here on your iPhone.")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(SupporterHomeColors.muted)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 26)
        .padding(.top, 18)
        .padding(.bottom, 14)
        .background(SupporterHomeColors.panel, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .supporterSurfaceShadow()
    }

    private var signInBackdrop: some View {
        NativePageBackground()
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
        NativeLaunchSplashView(
            errorTitle: currentAccountNeedsVerification ? "Verify your account again" :
                !offline.online ? "Connect to get ready" :
                loadingTimedOut || startupError != nil ? "We couldn’t get PIXL ready" : nil,
            errorMessage: startupError
                ?? (currentAccountNeedsVerification ? "Reconnect and tap Try again. Your pending changes are locked, not deleted." :
                    !offline.online
                    ? "Open the app online first. Saved offline access must be verified again at least every 7 days."
                    : loadingTimedOut
                    ? "Check your connection, then try again. Your pending iPhone changes have not been deleted."
                    : nil),
            isRetrying: retrying,
            onRetry: { Task { await retryStartup() } }
        )
    }

    @MainActor
    private func finishLocalSignOut() async {
        guard !retrying else { return }
        retrying = true
        defer { retrying = false }
        do {
            try offline.clear()
            if !clerk.isLoaded {
                try await clerk.refreshEnvironment()
                try await clerk.refreshClient()
            }
            if clerk.isAuthFlowComplete { try await clerk.auth.signOut() }
            localSignOutPending = false
            startupError = nil
        } catch { startupError = "Connect and tap Try again to finish signing out." }
    }

    @MainActor
    private func finishRemovalReceipt() async {
        guard !retrying else { return }
        retrying = true
        startupError = nil
        defer { retrying = false }
        do {
            try offline.clear()
            if !clerk.isLoaded {
                try await clerk.refreshEnvironment()
            }
            // Deletion may already have revoked the cached session. Refresh it
            // even when the SDK is loaded before attempting remote sign-out.
            try await clerk.refreshClient()
            if clerk.isAuthFlowComplete { try await clerk.auth.signOut() }
            guard !clerk.isAuthFlowComplete else {
                startupError = "Sign-out is still finishing. Please tap Back to sign in again."
                return
            }
            authPresentationID = UUID()
            accountRemovalReceiptScope = ""
            accountRemovalSupportReference = ""
            startupError = nil
        } catch {
            startupError = "Your deletion request is still accepted and access stays blocked. Check your connection, then tap Back to sign in again."
        }
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
            if clerk.isAuthFlowComplete { _ = try await SupporterHomeAPI.fetchPrivateSchedule(clerk: clerk) }
            if !clerk.isLoaded {
                startupError = "Sign-in could not finish loading. Check the iOS Clerk application settings and try again."
            }
        } catch {
            // Do not expose SDK responses or configuration values in error copy.
            startupError = "We couldn’t connect to sign-in. Check your connection and iOS Clerk settings, then try again."
        }
    }
}

struct NativeLaunchSplashView: View {
    var errorTitle: String? = nil
    var errorMessage: String? = nil
    var isRetrying = false
    var onRetry: (() -> Void)? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var logoIsGrowing = false

    var body: some View {
        GeometryReader { geometry in
            // SwiftUI can propose a zero or non-finite size during startup
            // and navigation transitions. Never pass it into a frame/position.
            let width = geometry.size.width.isFinite ? max(0, geometry.size.width) : 0
            let height = geometry.size.height.isFinite ? max(0, geometry.size.height) : 0
            ZStack {
                NativePageBackground()

                brand
                    .frame(maxWidth: max(0, min(width - 48, 340)))
                    .scaleEffect(reduceMotion ? 1 : (logoIsGrowing ? 1.035 : 0.985))
                    .animation(
                        .easeInOut(duration: 1.6).repeatForever(autoreverses: true),
                        value: logoIsGrowing
                    )
                    .position(x: width / 2, y: height / 2)

                VStack {
                    Spacer()
                    startupStatus
                        .frame(maxWidth: 460)
                        .padding(.horizontal, 28)
                        .padding(.bottom, max(geometry.safeAreaInsets.bottom, 28) + 16)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .onAppear {
                guard errorTitle == nil, !reduceMotion else { return }
                logoIsGrowing = true
            }
        }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityIdentifier("native-launch-splash")
    }

    private var brand: some View {
        HStack(spacing: 18) {
            Image(systemName: "sportscourt.fill")
                .font(.system(size: 44, weight: .black))
                .foregroundStyle(SupporterHomeColors.background)
                .frame(width: 100, height: 100)
                .background(
                    SupporterHomeColors.accent,
                    in: RoundedRectangle(cornerRadius: 29, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 29, style: .continuous)
                        .strokeBorder(.white.opacity(0.58), lineWidth: 1)
                }
                .shadow(color: SupporterHomeColors.background.opacity(0.14), radius: 16, y: 6)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 1) {
                Text("PIXL")
                    .font(.system(size: 48, weight: .black, design: .rounded))
                    .tracking(3.5)
                    .foregroundStyle(SupporterHomeColors.blue)
                Text("SPORTS")
                    .font(.system(size: 17, weight: .heavy, design: .rounded))
                    .tracking(5)
                    .foregroundStyle(SupporterHomeColors.background.opacity(0.88))
            }
        }
        .fixedSize(horizontal: true, vertical: false)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("PIXL Sports")
        .accessibilityIdentifier("native-launch-wordmark")
    }

    @ViewBuilder
    private var startupStatus: some View {
        if let errorTitle {
            VStack(spacing: 16) {
                Image(systemName: "wifi.exclamationmark")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(SupporterHomeColors.accent)
                    .accessibilityHidden(true)
                Text(errorTitle)
                    .font(.title2.weight(.bold))
                    .fontDesign(.rounded)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if let errorMessage {
                    Text(errorMessage)
                        .font(.body)
                        .foregroundStyle(SupporterHomeColors.muted)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let onRetry {
                    Button(action: onRetry) {
                        Label(isRetrying ? "Trying again…" : "Try again", systemImage: "arrow.clockwise")
                            .font(.body.weight(.bold))
                            .frame(maxWidth: .infinity, minHeight: 50)
                            .contentShape(Rectangle())
                    }
                    .foregroundStyle(SupporterHomeColors.background)
                    .background(SupporterHomeColors.accent, in: Capsule())
                    .disabled(isRetrying)
                    .accessibilityIdentifier("native-launch-retry")
                }
            }
            .frame(maxWidth: .infinity)
            .padding(22)
            .background(SupporterCardBackground(cornerRadius: 24))
            .overlay {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(.white.opacity(0.12), lineWidth: 1)
            }
        } else {
            VStack(spacing: 17) {
                ProgressView()
                    .controlSize(.large)
                    .tint(SupporterHomeColors.accentText)
                    .accessibilityHidden(true)
                Text("Getting your season ready")
                    .font(.headline.weight(.semibold))
                    .fontDesign(.rounded)
                    .foregroundStyle(SupporterHomeColors.background)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(24)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("native-launch-status")
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
