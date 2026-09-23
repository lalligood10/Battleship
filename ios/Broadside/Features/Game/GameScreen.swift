import SwiftUI

/// Entry point for any game: subscribes to the game and shows the right phase screen.
struct GameScreen: View {
    let gameId: String
    @EnvironmentObject private var session: SessionStore
    @StateObject private var holder = StoreHolder()

    /// `@StateObject` needs a parameterless init, so the store is created lazily with the uid.
    @MainActor final class StoreHolder: ObservableObject {
        @Published var store: GameStore?
    }

    var body: some View {
        Group {
            if let store = holder.store {
                GamePhaseRouter(store: store)
            } else {
                LoadingView()
            }
        }
        .onAppear {
            if holder.store == nil, let uid = session.uid {
                let store = GameStore(gameId: gameId, uid: uid)
                store.start()
                holder.store = store
            }
        }
        .onDisappear { holder.store?.stop(); holder.store = nil }
    }
}

private struct GamePhaseRouter: View {
    @ObservedObject var store: GameStore

    var body: some View {
        Group {
            if let game = store.game {
                switch game.status {
                case .waiting:
                    WaitingForOpponentView(store: store, game: game)
                case .placing:
                    if store.me?.ready == true {
                        WaitingForPlacementView(store: store, game: game)
                    } else {
                        PlacementView(store: store)
                    }
                case .active:
                    GameBoardView(store: store, game: game)
                case .finished:
                    ResultsView(store: store, game: game)
                case .cancelled:
                    ErrorStateView(message: "This game was cancelled.")
                        .navigationTitle("Cancelled")
                }
            } else if let err = store.error {
                ErrorStateView(message: err.errorDescription ?? "")
            } else {
                LoadingView(text: "Loading game…")
            }
        }
        .background(Theme.background)
        .appErrorAlert($store.error)
    }
}

// MARK: - Waiting (host, before the friend joins)

struct WaitingForOpponentView: View {
    @ObservedObject var store: GameStore
    let game: Game
    @Environment(\.dismiss) private var dismiss
    @State private var cancelling = false
    @State private var confirmCancel = false

    private var shareURL: URL {
        // Universal link served by Firebase Hosting (hosting/join.html); falls back to the broadside:// scheme there.
        URL(string: "https://\(AppConfig.hostingDomain)/join/\(game.code)")!
    }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Text("Send this code to a friend").font(.title3).foregroundStyle(.secondary)
            Text(game.code)
                .font(.system(size: 48, weight: .heavy, design: .monospaced))
                .kerning(6)
                .padding()
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .contextMenu { Button("Copy") { UIPasteboard.general.string = game.code } }

            ShareLink(item: shareURL, message: Text("Play me at Broadside! Join code \(game.code)")) {
                Label("Share invite link", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(PrimaryButtonStyle())

            HStack(spacing: 8) {
                ProgressView()
                Text("Waiting for them to join… this screen updates automatically.").font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()

            Button(role: .destructive) { confirmCancel = true } label: {
                if cancelling { ProgressView() } else { Text("Cancel game") }
            }
            .disabled(cancelling)
        }
        .padding(24)
        .navigationTitle("New Game")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Cancel this game?", isPresented: $confirmCancel, titleVisibility: .visible) {
            Button("Cancel game", role: .destructive) { cancel() }
        }
    }

    private func cancel() {
        cancelling = true
        Task {
            defer { cancelling = false }
            do {
                try await GameService.shared.cancelGame(gameId: game.id)
                dismiss()
            } catch {
                store.error = AppError.from(error)
            }
        }
    }
}

// MARK: - Waiting for the opponent to finish placing

struct WaitingForPlacementView: View {
    @ObservedObject var store: GameStore
    let game: Game

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "checkmark.seal.fill").font(.system(size: 56)).foregroundStyle(.green)
            Text("Your fleet is in position").font(.title2.bold())
            Text("Waiting for \(store.opponent?.username ?? "your opponent") to place their ships. You'll get a notification when the battle starts.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary)
            ProgressView()
            Spacer()
            if let board = store.myBoard {
                MiniFleetPreview(fleet: board.fleet)
            }
            AbandonControls(store: store, game: game)
        }
        .padding(24)
        .navigationTitle("vs \(store.opponent?.username ?? "…")")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct MiniFleetPreview: View {
    let fleet: [ShipPlacement]
    var body: some View {
        let cells = Set(fleet.flatMap { Board.cells(of: $0) })
        GeometryReader { geo in
            let size = BoardGridView.cellSize(fitting: min(geo.size.width, 240))
            BoardGridView(cellSize: size, mark: { cells.contains($0) ? .ship : .water })
                .frame(maxWidth: .infinity)
        }
        .frame(height: 240)
    }
}

enum AppConfig {
    /// Firebase Hosting domain that serves the join links. Set after creating your Firebase project (README step 3).
    static let hostingDomain = "YOUR-FIREBASE-PROJECT-ID.web.app"
}
