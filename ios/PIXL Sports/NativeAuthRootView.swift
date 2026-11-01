import SwiftUI
import ClerkKit
#if os(iOS) || os(macOS)
import ClerkKitUI
#endif

struct NativeAuthRootView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @State private var loadingTimedOut = false
    @State private var retrying = false
    @State private var startupError: String?
    @State private var showingAccountLink = false
    @State private var showingSettings = false
#if os(iOS)
    @StateObject private var notificationCoordinator = NativePushRegistrationCoordinator()
#endif

    var body: some View {
#if os(iOS) || os(macOS)
        Group {
            if !clerk.isLoaded {
                startupView
            } else if clerk.isAuthFlowComplete {
                NavigationStack {
                    ContentView(
                        clerk: clerk,
                        showingAccountLink: $showingAccountLink,
                        showingSettings: $showingSettings
                    )
                        // Tear down previous user's screen state on account switches.
                        .id(clerk.user?.id)
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
                            guard clerk.user != nil else { return }
                            await notificationCoordinator.configure(clerk: clerk)
                        }
#endif
                }
            } else {
                ZStack {
                    signInBackdrop
                    ScrollView {
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
                        .frame(maxWidth: .infinity)
                    }
                    .scrollIndicators(.hidden)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .preferredColorScheme(.light)
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

                Text("Use email or Google to sign in. If you already use PIXL on the web, connect that account after sign-in.")
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
            errorTitle: loadingTimedOut || startupError != nil ? "We couldn’t get PIXL ready" : nil,
            errorMessage: startupError
                ?? (loadingTimedOut
                    ? "Check your connection. If this continues, check the iOS Clerk key and Native API settings."
                    : nil),
            isRetrying: retrying,
            onRetry: { Task { await retryStartup() } }
        )
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

struct NativeLaunchSplashView: View {
    var errorTitle: String? = nil
    var errorMessage: String? = nil
    var isRetrying = false
    var onRetry: (() -> Void)? = nil

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                backdrop

                ScrollView {
                    VStack(spacing: 0) {
                        Spacer(minLength: 36)
                        brand
                        Spacer(minLength: 52)
                        startupStatus
                        Spacer(minLength: 44)
                        Text("YOUR SEASON  ·  ONE EVENT AT A TIME")
                            .font(.caption2.weight(.heavy))
                            .tracking(2)
                            .foregroundStyle(SupporterHomeColors.lightMuted)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 28)
                    }
                    .frame(maxWidth: 460)
                    .frame(minHeight: geometry.size.height)
                    .padding(.horizontal, 28)
                    .frame(maxWidth: .infinity)
                }
                .scrollIndicators(.hidden)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background { NativePageBackground() }
        .ignoresSafeArea()
        .preferredColorScheme(.light)
        .accessibilityIdentifier("native-launch-splash")
    }

    private var backdrop: some View {
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
                colors: [SupporterHomeColors.blue.opacity(0.27), .clear],
                center: .topTrailing,
                startRadius: 0,
                endRadius: 460
            )
            RadialGradient(
                colors: [SupporterHomeColors.accent.opacity(0.09), .clear],
                center: .bottomLeading,
                startRadius: 0,
                endRadius: 380
            )
            Image(systemName: "sportscourt.fill")
                .font(.system(size: 260, weight: .regular))
                .foregroundStyle(.white.opacity(0.025))
                .rotationEffect(.degrees(-12))
                .offset(x: 165, y: -240)
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

    private var brand: some View {
        VStack(spacing: 20) {
            Image(systemName: "sportscourt.fill")
                .font(.system(size: 30, weight: .black))
                .foregroundStyle(SupporterHomeColors.background)
                .frame(width: 76, height: 76)
                .background(
                    SupporterHomeColors.accent,
                    in: RoundedRectangle(cornerRadius: 24, style: .continuous)
                )
                .overlay {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .strokeBorder(.white.opacity(0.32), lineWidth: 1)
                }
                .shadow(color: SupporterHomeColors.accent.opacity(0.2), radius: 26, y: 8)
                .accessibilityHidden(true)

            VStack(spacing: 2) {
                Text("PIXL")
                    .font(.system(size: 31, weight: .black, design: .rounded))
                    .tracking(4)
                    .foregroundStyle(SupporterHomeColors.blue)
                Text("SPORTS")
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .tracking(6)
                    .foregroundStyle(SupporterHomeColors.background.opacity(0.9))
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel("PIXL Sports")
            .accessibilityIdentifier("native-launch-wordmark")

            Text("YOUR SEASON STARTS HERE")
                .font(.caption.weight(.heavy))
                .tracking(2.4)
                .foregroundStyle(SupporterHomeColors.accent)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 30)
        .padding(.horizontal, 34)
        .background(.white.opacity(0.035), in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
        }
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
            .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(.white.opacity(0.09), lineWidth: 1)
            }
        } else {
            VStack(spacing: 17) {
                ProgressView()
                    .controlSize(.large)
                    .tint(SupporterHomeColors.accent)
                    .accessibilityHidden(true)
                Text("Getting your season ready")
                    .font(.headline.weight(.semibold))
                    .fontDesign(.rounded)
                    .foregroundStyle(.white)
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
