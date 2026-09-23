import FirebaseFirestore
import SwiftUI

@MainActor
final class GameHistoryStore: ObservableObject {
    @Published private(set) var games: [Game] = []
    @Published private(set) var loaded = false
    @Published var error: AppError?

    private var listener: ListenerRegistration?

    func start(uid: String) {
        guard listener == nil else { return }
        listener = Firestore.firestore().collection("games")
            .whereField("playerUids", arrayContains: uid)
            .whereField("status", isEqualTo: GameStatus.finished.rawValue)
            .order(by: "finishedAt", descending: true)
            .limit(to: 50)
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor in
                    guard let self else { return }
                    self.loaded = true
                    if let error {
                        self.error = AppError.from(error)
                        return
                    }
                    self.games = (snapshot?.documents ?? []).compactMap { try? Game.from($0) }
                }
            }
    }

    func stop() {
        listener?.remove()
        listener = nil
    }
}

struct ProfileView: View {
    @EnvironmentObject private var session: SessionStore
    @StateObject private var history = GameHistoryStore()
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if let profile = session.profile {
                        header(profile)
                        statsGrid(profile.stats)
                    }
                    historySection
                }
                .padding()
            }
            .background(Theme.background)
            .navigationTitle("Profile")
            .toolbar {
                Button("Sign out", role: .destructive) { confirmSignOut = true }
            }
            .confirmationDialog("Sign out of Broadside?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { session.signOut() }
            }
            .onAppear { if let uid = session.uid { history.start(uid: uid) } }
            .onDisappear { history.stop() }
            .appErrorAlert($history.error)
            .navigationDestination(for: String.self) { gameId in
                GameScreen(gameId: gameId)
            }
        }
    }

    private func header(_ p: UserProfile) -> some View {
        VStack(spacing: 6) {
            ZStack {
                Circle().fill(Theme.accent.opacity(0.15)).frame(width: 84, height: 84)
                Text(String(p.username.prefix(1)).uppercased()).font(.system(size: 36, weight: .bold, design: .rounded)).foregroundStyle(Theme.accent)
            }
            Text(p.username).font(.title2.bold())
            HStack(spacing: 4) {
                Image(systemName: "star.fill").foregroundStyle(.yellow)
                Text("\(p.rating) rating").font(.headline)
            }
            if let since = p.createdAt {
                Text("Sailing since \(since.formatted(date: .abbreviated, time: .omitted))").font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .card()
    }

    private func statsGrid(_ s: PlayerStats) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            StatTile(label: "Games", value: "\(s.gamesPlayed)")
            StatTile(label: "Wins", value: "\(s.wins)", color: Theme.win)
            StatTile(label: "Losses", value: "\(s.losses)", color: Theme.loss)
            StatTile(label: "Win rate", value: percent(s.winRate))
            StatTile(label: "Accuracy", value: percent(s.accuracy))
            StatTile(label: "Best streak", value: "\(s.longestStreak)")
        }
    }

    private func percent(_ v: Double) -> String { "\(Int((v * 100).rounded()))%" }

    @ViewBuilder
    private var historySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Game history").font(.headline)
            if !history.loaded {
                ProgressView().frame(maxWidth: .infinity)
            } else if history.games.isEmpty {
                EmptyStateView(systemImage: "clock", title: "No games yet", message: "Your finished games will appear here.")
            } else {
                ForEach(history.games) { game in
                    if let uid = session.uid {
                        NavigationLink(value: game.id) { HistoryRow(game: game, uid: uid) }
                            .buttonStyle(.plain)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .card()
    }
}

struct StatTile: View {
    let label: String
    let value: String
    var color: Color = .primary

    var body: some View {
        VStack(spacing: 4) {
            Text(value).font(.title3.bold().monospacedDigit()).foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct HistoryRow: View {
    let game: Game
    let uid: String

    private var won: Bool { game.winnerUid == uid }
    private var change: Int? { game.ratingChanges?[uid]?.delta }

    var body: some View {
        HStack {
            Image(systemName: won ? "trophy.fill" : "xmark.circle")
                .foregroundStyle(won ? Theme.win : Theme.loss)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(won ? "Won" : "Lost") vs \(game.player(game.opponentUid(of: uid))?.username ?? "unknown")")
                    .font(.body.weight(.medium))
                if let at = game.finishedAt {
                    Text(at.formatted(date: .abbreviated, time: .shortened)).font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let change {
                Text(change >= 0 ? "+\(change)" : "\(change)")
                    .font(.subheadline.monospacedDigit().weight(.semibold))
                    .foregroundStyle(change >= 0 ? Theme.win : Theme.loss)
            }
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
    }
}
