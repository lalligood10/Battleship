import FirebaseCore
import SwiftUI

@main
struct BroadsideApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var auth: AuthService
    @StateObject private var session: SessionStore
    @StateObject private var push = PushService.shared
    @StateObject private var deepLinks = DeepLinkRouter()

    init() {
        // Firebase reads Config/GoogleService-Info.plist. Without it the app shows a setup screen instead of crashing.
        if FirebaseSetup.isConfigured {
            FirebaseApp.configure()
        }
        let auth = AuthService()
        _auth = StateObject(wrappedValue: auth)
        _session = StateObject(wrappedValue: SessionStore(auth: auth))
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if FirebaseSetup.isConfigured {
                    RootView()
                } else {
                    MissingConfigView()
                }
            }
            .environmentObject(auth)
            .environmentObject(session)
            .environmentObject(push)
            .environmentObject(deepLinks)
            .tint(Theme.accent)
            .onOpenURL { url in deepLinks.handle(url) }
        }
    }
}

enum FirebaseSetup {
    /// True when the owner has dropped their GoogleService-Info.plist into the bundle (README step 3).
    static var isConfigured: Bool {
        Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil
    }
}

/// Parses `broadside://join/CODE` and `https://<project>.web.app/join/CODE`.
@MainActor
final class DeepLinkRouter: ObservableObject {
    @Published var pendingJoinCode: String?

    func handle(_ url: URL) {
        let parts = url.pathComponents.filter { $0 != "/" }
        if url.scheme == "broadside" {
            // broadside://join/CODE  -> host = "join", path = "/CODE"
            if url.host == "join", let code = parts.first { pendingJoinCode = code.uppercased() }
        } else if let idx = parts.firstIndex(of: "join"), idx + 1 < parts.count {
            pendingJoinCode = parts[idx + 1].uppercased()
        }
    }
}
