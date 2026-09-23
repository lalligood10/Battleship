import SwiftUI

struct ResultsView: View {
    @ObservedObject var store: GameStore
    let game: Game
    @Environment(\.dismiss) private var dismiss
    @State private var appeared = false

    private var won: Bool { game.winnerUid == store.uid }
    private var myChange: RatingChange? { game.ratingChanges?[store.uid] }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                VStack(spacing: 8) {
                    Image(systemName: won ? "trophy.fill" : "water.waves")
                        .font(.system(size: 64))
                        .foregroundStyle(won ? Color.yellow : Theme.accent)
                        .scaleEffect(appeared ? 1 : 0.4)
                        .animation(.spring(response: 0.5, dampingFraction: 0.6), value: appeared)
                    Text(won ? "Victory!" : "Defeat").font(.system(size: 36, weight: .heavy, design: .rounded))
                    Text(reasonText).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                .padding(.top)

                if let change = myChange {
                    HStack(spacing: 24) {
                        stat("Rating", "\(change.after)")
                        stat("Change", change.delta >= 0 ? "+\(change.delta)" : "\(change.delta)", color: change.delta >= 0 ? Theme.win : Theme.loss)
                        stat("Accuracy", accuracy(store.me))
                    }
                    .card()
                }

                if let fleets = game.revealedFleets, let oppUid = store.opponentUid {
                    revealedBoard(title: "\(store.opponent?.username ?? "Opponent")'s fleet", fleet: fleets[oppUid] ?? [], shots: game.shots(by: store.uid))
                    revealedBoard(title: "Your fleet", fleet: fleets[store.uid] ?? store.myBoard?.fleet ?? [], shots: game.shots(by: oppUid))
                }

                Button("Back to Home") { dismiss() }.buttonStyle(PrimaryButtonStyle())
            }
            .padding()
        }
        .navigationTitle("Game Over")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { appeared = true }
    }

    private var reasonText: String {
        let opp = store.opponent?.username ?? "Your opponent"
        switch game.endReason {
        case .allSunk: return won ? "You sank every ship in \(opp)'s fleet." : "\(opp) sank your entire fleet."
        case .resign: return won ? "\(opp) resigned." : "You resigned."
        case .timeout: return won ? "\(opp) was inactive too long, so you claimed the win." : "You were inactive too long and \(opp) claimed the win."
        case nil: return ""
        }
    }

    private func accuracy(_ p: GamePlayer?) -> String {
        guard let p, p.shotsFired > 0 else { return "–" }
        return "\(Int((Double(p.hits) / Double(p.shotsFired) * 100).rounded()))%"
    }

    private func stat(_ label: String, _ value: String, color: Color = .primary) -> some View {
        VStack {
            Text(value).font(.title2.bold().monospacedDigit()).foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func revealedBoard(title: String, fleet: [ShipPlacement], shots: [Shot]) -> some View {
        let shipCells = Set(fleet.flatMap { Board.cells(of: $0) })
        let shotMap = Dictionary(shots.map { ($0.coordinate, $0) }, uniquingKeysWith: { a, _ in a })
        return VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            GeometryReader { geo in
                BoardGridView(cellSize: BoardGridView.cellSize(fitting: geo.size.width), mark: { c in
                    if let shot = shotMap[c] {
                        return shot.result == .miss ? .miss : (shipCells.contains(c) ? .hit : .miss)
                    }
                    return shipCells.contains(c) ? .revealedShip : .water
                })
            }
            .aspectRatio(CGFloat(Board.size + 1) / CGFloat(Board.size + 0.7), contentMode: .fit)
        }
    }
}
