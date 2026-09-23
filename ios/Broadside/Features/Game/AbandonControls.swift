import SwiftUI

/// Resign button plus the "claim win" button that appears once the opponent has been silent past the timeout.
struct AbandonControls: View {
    @ObservedObject var store: GameStore
    let game: Game

    @State private var confirmResign = false
    @State private var busy = false
    @State private var now = Date()

    private let ticker = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    /// I'm waiting on the opponent if it's their turn (active) or they haven't placed yet (placing).
    private var waitingOnOpponent: Bool {
        switch game.status {
        case .active: return game.currentTurnUid != store.uid
        case .placing: return store.me?.ready == true && store.opponent?.ready != true
        default: return false
        }
    }

    var body: some View {
        VStack(spacing: 10) {
            if waitingOnOpponent, let deadline = game.abandonDeadline {
                if now >= deadline {
                    Button {
                        claim()
                    } label: {
                        if busy { ProgressView() } else { Label("Claim win — opponent inactive", systemImage: "flag.checkered") }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(busy)
                } else {
                    Text("If \(store.opponent?.username ?? "your opponent") doesn't move by \(deadline.formatted(date: .abbreviated, time: .shortened)), you can claim the win.")
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
            }
            Button("Resign", role: .destructive) { confirmResign = true }
                .font(.subheadline)
                .disabled(busy)
        }
        .onReceive(ticker) { now = $0 }
        .confirmationDialog("Resign this game?", isPresented: $confirmResign, titleVisibility: .visible) {
            Button("Resign — opponent wins", role: .destructive) { resign() }
        } message: {
            Text("This counts as a loss and affects your rating.")
        }
    }

    private func resign() {
        run { _ = try await GameService.shared.resign(gameId: game.id) }
    }

    private func claim() {
        run { _ = try await GameService.shared.claimTimeoutWin(gameId: game.id) }
    }

    private func run(_ op: @escaping () async throws -> Void) {
        busy = true
        Task {
            defer { busy = false }
            do { try await op() } catch {
                Feedback.error()
                store.error = AppError.from(error)
            }
        }
    }
}
