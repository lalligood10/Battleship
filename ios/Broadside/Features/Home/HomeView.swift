import SwiftUI

struct HomeView: View {
    @EnvironmentObject private var session: SessionStore
    @EnvironmentObject private var push: PushService
    @EnvironmentObject private var deepLinks: DeepLinkRouter
    @StateObject private var store = ActiveGamesStore()

    @State private var path: [String] = [] // game IDs
    @State private var showJoin = false
    @State private var showQuickMatch = false
    @State private var creating = false
    @State private var error: AppError?

    var body: some View {
        NavigationStack(path: $path) {
            ScrollView {
                VStack(spacing: 16) {
                    header
                    actions
                    activeGames
                }
                .padding()
            }
            .background(Theme.background)
            .navigationTitle("Broadside")
            .navigationDestination(for: String.self) { gameId in
                GameScreen(gameId: gameId)
            }
            .sheet(isPresented: $showJoin) {
                JoinGameView(initialCode: deepLinks.pendingJoinCode) { gameId in
                    deepLinks.pendingJoinCode = nil
                    path = [gameId]
                }
            }
            .sheet(isPresented: $showQuickMatch) {
                QuickMatchView { gameId in path = [gameId] }
            }
            .appErrorAlert($error)
        }
        .onAppear { if let uid = session.uid { store.start(uid: uid) } }
        .onChange(of: session.uid) { uid in if let uid { store.start(uid: uid) } else { store.stop() } }
        .onChange(of: deepLinks.pendingJoinCode) { code in if code != nil { showJoin = true } }
        .onChange(of: push.pendingGameId) { gameId in
            if let gameId {
                path = [gameId]
                push.pendingGameId = nil
            }
        }
        .onAppear { if deepLinks.pendingJoinCode != nil { showJoin = true } }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading) {
                Text("Welcome back,").foregroundStyle(.secondary)
                Text(session.profile?.username ?? "").font(.title2.bold())
            }
            Spacer()
            if let profile = session.profile {
                VStack(alignment: .trailing) {
                    Text("\(profile.rating)").font(.title2.bold().monospacedDigit())
                    Text("rating").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .card()
    }

    private var actions: some View {
        VStack(spacing: 12) {
            Button {
                createGame()
            } label: {
                if creating { ProgressView().tint(.white) } else { Label("New Game with a Friend", systemImage: "plus.circle.fill") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(creating)

            HStack(spacing: 12) {
                Button { showJoin = true } label: { Label("Join with Code", systemImage: "number") }
                    .buttonStyle(SecondaryButtonStyle())
                Button { showQuickMatch = true } label: { Label("Quick Match", systemImage: "bolt.fill") }
                    .buttonStyle(SecondaryButtonStyle())
            }
        }
    }

    @ViewBuilder
    private var activeGames: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Your games").font(.headline).padding(.horizontal, 4)
            if !store.loaded {
                ProgressView().frame(maxWidth: .infinity).padding()
            } else if let err = store.error {
                ErrorStateView(message: err.errorDescription ?? "") { if let uid = session.uid { store.stop(); store.start(uid: uid) } }
            } else if store.games.isEmpty {
                EmptyStateView(systemImage: "water.waves", title: "No games yet", message: "Start a new game and send the code to a friend.")
                    .card()
            } else {
                ForEach(store.games) { game in
                    NavigationLink(value: game.id) {
                        GameRow(game: game, uid: session.uid ?? "")
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func createGame() {
        creating = true
        Task {
            defer { creating = false }
            do {
                let result = try await GameService.shared.createGame()
                path = [result.gameId]
            } catch {
                Feedback.error()
                self.error = AppError.from(error)
            }
        }
    }
}

struct GameRow: View {
    let game: Game
    let uid: String

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon).font(.title2).foregroundStyle(iconColor).frame(width: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(subtitle).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
        }
        .card()
    }

    private var opponentName: String? { game.player(game.opponentUid(of: uid))?.username }

    private var title: String {
        if let opponentName { return "vs \(opponentName)" }
        return "Waiting for a friend"
    }

    private var subtitle: String {
        switch game.status {
        case .waiting: return "Code \(game.code) · share it to start"
        case .placing: return game.player(uid)?.ready == true ? "Waiting for opponent to place ships" : "Place your ships"
        case .active: return game.isMyTurn(uid) ? "Your turn · move \(game.turnNumber)" : "Their turn · move \(game.turnNumber)"
        case .finished: return game.winnerUid == uid ? "You won" : "You lost"
        case .cancelled: return "Cancelled"
        }
    }

    private var icon: String {
        switch game.status {
        case .waiting: return "hourglass"
        case .placing: return "square.grid.3x3.square"
        case .active: return game.isMyTurn(uid) ? "scope" : "clock"
        case .finished: return game.winnerUid == uid ? "trophy.fill" : "flag.fill"
        case .cancelled: return "xmark.circle"
        }
    }

    private var iconColor: Color {
        if game.status == .active && game.isMyTurn(uid) { return Theme.accent }
        if game.status == .placing && game.player(uid)?.ready != true { return Theme.accent }
        return .secondary
    }
}
