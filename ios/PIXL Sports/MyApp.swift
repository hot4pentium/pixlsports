import SwiftUI
import ClerkKit

@main
struct MyApp: App {
    private let configuration: Result<NativeClerkConfiguration, NativeClerkConfiguration.ConfigurationError>

    init() {
        configuration = NativeClerkConfiguration.load()
        if case let .success(config) = configuration {
            Clerk.configure(publishableKey: config.publishableKey)
        }
    }

    var body: some Scene {
        WindowGroup {
            switch configuration {
            case .success:
                NativeAuthRootView()
                    .environment(Clerk.shared)
            case let .failure(error):
                NativeAuthSetupView(message: error.localizedDescription)
            }
        }
    }
}
