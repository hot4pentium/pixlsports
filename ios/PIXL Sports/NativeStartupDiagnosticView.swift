#if DEBUG && (os(iOS) || os(macOS))
import SwiftUI
import ClerkKit
import ClerkKitUI

/// An explicitly selected developer screen, never a production startup route.
/// It does not clear credentials, cache, pending work, or deletion receipts.
struct NativeStartupDiagnosticView: View {
    private enum Stage: String {
        case configured = "SDK configured"
        case state = "Reading sign-in state"
        case signIn = "Clerk sign-in screen"
        case themedSignIn = "App sign-in form"
        case app = "Normal app"
    }

    @State private var stage: Stage = .configured

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                Text("PIXL startup check")
                    .font(.headline)
                Text(stage.rawValue)
                    .accessibilityIdentifier("startup-check-stage")
                HStack {
                    Button("Read state") { select(.state) }
                        .accessibilityIdentifier("startup-check-read-state")
                    Button("Sign-in UI") { select(.signIn) }
                }
                .buttonStyle(.bordered)
                .font(.caption)
                HStack {
                    Button("App sign-in") { select(.themedSignIn) }
                        .accessibilityIdentifier("startup-check-app-sign-in")
                    Button("Normal app") { select(.app) }
                }
                .buttonStyle(.bordered)
                .font(.caption)
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(.black)
            .background(.white)

            // Each child starts only after an explicit tap. In particular,
            // the initial screen does not read observable Clerk properties
            // or initialize the offline runtime.
            Group {
                switch stage {
                case .configured:
                    VStack(spacing: 16) {
                        Text("Clerk setup returned and this screen rendered.")
                            .font(.title3.bold())
                        Text("Tap Read state first. This check stays here until you choose a step.")
                        Text("No saved account or event data has been cleared.")
                    }
                    .padding(24)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .foregroundStyle(.black)
                    .background(.white)
                    .accessibilityIdentifier("startup-check-configured")
                case .state:
                    NativeStartupStateProbe()
                case .signIn:
                    // Isolate SDK UI from app wrappers, theme, and offline state.
                    AuthView(isDismissible: false)
                case .themedSignIn:
                    NativeClerkSignInForm()
                case .app:
                    // Same authorization/lifecycle gates as ordinary startup.
                    NativeAuthRootView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .preferredColorScheme(.light)
    }

    private func select(_ next: Stage) {
        // Only fixed stage names: never session values, keys, or identity data.
        print("[PIXL startup check] requested: \(next.rawValue)")
        stage = next
    }
}

private struct NativeStartupStateProbe: View {
    @Environment(Clerk.self) private var clerk

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Sign-in state check")
                .font(.title3.bold())
            Text(clerk.isLoaded ? "SDK loaded" : "SDK still loading")
            Text(clerk.isAuthFlowComplete ? "Authentication complete" : "Authentication incomplete")
            Text("If this stays visible, try Normal app next. Use Sign-in UI only to check whether Clerk’s form renders; you do not need to submit anything.")
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .foregroundStyle(.black)
        .background(.white)
        .accessibilityIdentifier("startup-check-state")
    }
}
#endif
