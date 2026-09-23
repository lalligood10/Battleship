import SwiftUI

struct RootView: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        Group {
            switch session.state {
            case .loading:
                LoadingView(text: "Signing in…")
            case .signedOut:
                SignInView()
            case .needsUsername:
                UsernameView()
            case .ready:
                MainTabView()
            }
        }
        .animation(.default, value: session.state)
        .appErrorAlert($session.error)
    }
}

struct MainTabView: View {
    @EnvironmentObject private var push: PushService

    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Play", systemImage: "scope") }
            LeaderboardsView()
                .tabItem { Label("Leaderboards", systemImage: "trophy") }
            ProfileView()
                .tabItem { Label("Profile", systemImage: "person.crop.circle") }
        }
        .onAppear { push.requestPermission() }
    }
}
