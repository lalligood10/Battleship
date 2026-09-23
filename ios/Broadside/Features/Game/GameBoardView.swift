import SwiftUI

/// The live battle: opponent's waters on top (tap to fire), my fleet below.
struct GameBoardView: View {
    @ObservedObject var store: GameStore
    let game: Game

    @State private var firing = false
    @State private var pendingTarget: Coordinate?
    @State private var banner: Banner?
    @State private var lastSeenOpponentShots = -1

    struct Banner: Equatable {
        let text: String
        let color: Color
    }

    private var myShots: [Shot] { game.shots(by: store.uid) }
    private var theirShots: [Shot] { game.shots(by: store.opponentUid) }
    private var myShotMap: [Coordinate: Shot] { Dictionary(myShots.map { ($0.coordinate, $0) }, uniquingKeysWith: { a, _ in a }) }
    private var theirShotMap: [Coordinate: Shot] { Dictionary(theirShots.map { ($0.coordinate, $0) }, uniquingKeysWith: { a, _ in a }) }
    private var myShipCells: Set<Coordinate> { Set((store.myBoard?.fleet ?? []).flatMap { Board.cells(of: $0) }) }
    /// Cells of enemy ships I have sunk (server reveals a ship's placement once every cell is hit).
    private var enemySunkCells: Set<Coordinate> {
        Set(myShots.compactMap(\.sunkPlacement).flatMap { Board.cells(of: $0) })
    }
    private var sunkCellsOfMine: Set<Coordinate> {
        // My ships the opponent has sunk: `players[me].sunkShips` lists types; find their cells from my private fleet.
        let sunkTypes = Set(store.me?.sunkShips ?? [])
        return Set((store.myBoard?.fleet ?? []).filter { sunkTypes.contains($0.type) }.flatMap { Board.cells(of: $0) })
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 14) {
                turnHeader

                boardSection(title: "Enemy waters — \(store.opponent?.username ?? "opponent")") { size in
                    BoardGridView(
                        cellSize: size,
                        mark: { c in
                            guard let shot = myShotMap[c] else { return .water }
                            if enemySunkCells.contains(c) { return .sunk }
                            return Self.mark(for: shot.result)
                        },
                        highlighted: pendingTarget.map { [$0] } ?? [],
                        onTap: { c in tapped(c) }
                    )
                }

                sunkLegend

                boardSection(title: "Your fleet") { size in
                    BoardGridView(cellSize: size, mark: { c in
                        if let shot = theirShotMap[c] {
                            if sunkCellsOfMine.contains(c) { return .sunk }
                            return shot.result == .miss ? .miss : .hit
                        }
                        return myShipCells.contains(c) ? .ship : .water
                    })
                }

                AbandonControls(store: store, game: game)
                    .padding(.top, 8)
            }
            .padding()
        }
        .navigationTitle("Move \(game.turnNumber)")
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .top) {
            if let banner {
                Text(banner.text)
                    .font(.headline)
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .background(banner.color, in: Capsule())
                    .foregroundStyle(.white)
                    .shadow(radius: 6)
                    .padding(.top, 8)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.35), value: banner)
        .onChange(of: theirShots.count) { count in announceIncoming(count) }
        .onAppear { lastSeenOpponentShots = theirShots.count }
        .confirmationDialog(
            pendingTarget.map { "Fire at \(Board.label($0))?" } ?? "",
            isPresented: Binding(get: { pendingTarget != nil }, set: { if !$0 { pendingTarget = nil } }),
            titleVisibility: .visible
        ) {
            Button("Fire!") { fire() }
        }
    }

    // MARK: Sections

    private var turnHeader: some View {
        HStack(spacing: 12) {
            Circle().fill(store.isMyTurn ? Theme.accent : Color.secondary).frame(width: 10, height: 10)
            VStack(alignment: .leading, spacing: 2) {
                Text(store.isMyTurn ? "Your turn — tap a cell to fire" : "Waiting for \(store.opponent?.username ?? "opponent")…")
                    .font(.headline)
                Text(scoreline).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if firing || !store.isMyTurn { ProgressView() }
        }
        .card()
    }

    private var scoreline: String {
        let mine = store.me
        let theirs = store.opponent
        let myAcc = accuracy(mine)
        let theirAcc = accuracy(theirs)
        return "You: \(theirs?.sunkShips.count ?? 0)/5 sunk · \(myAcc) accuracy   |   Them: \(mine?.sunkShips.count ?? 0)/5 sunk · \(theirAcc) accuracy"
    }

    private func accuracy(_ p: GamePlayer?) -> String {
        guard let p, p.shotsFired > 0 else { return "–" }
        return "\(Int((Double(p.hits) / Double(p.shotsFired) * 100).rounded()))%"
    }

    private func boardSection<Content: View>(title: String, @ViewBuilder content: @escaping (CGFloat) -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            GeometryReader { geo in
                content(BoardGridView.cellSize(fitting: geo.size.width))
            }
            .aspectRatio(CGFloat(Board.size + 1) / CGFloat(Board.size + 0.7), contentMode: .fit)
        }
    }

    private var sunkLegend: some View {
        HStack(spacing: 10) {
            ForEach(ShipType.allCases) { type in
                let sunk = store.opponent?.sunkShips.contains(type) ?? false
                VStack(spacing: 2) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(sunk ? Theme.sunk : Theme.ship.opacity(0.5))
                        .frame(width: CGFloat(type.length) * 8, height: 6)
                    Text(type.displayName).font(.system(size: 9)).foregroundStyle(sunk ? Theme.sunk : .secondary)
                        .strikethrough(sunk)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Actions

    private func tapped(_ c: Coordinate) {
        guard store.isMyTurn, !firing else {
            if !store.isMyTurn { show(Banner(text: "Not your turn", color: .gray)) }
            return
        }
        guard myShotMap[c] == nil else {
            Feedback.error()
            show(Banner(text: "Already fired at \(Board.label(c))", color: .gray))
            return
        }
        Feedback.tap()
        pendingTarget = c
    }

    private func fire() {
        guard let target = pendingTarget else { return }
        pendingTarget = nil
        firing = true
        Task {
            defer { firing = false }
            do {
                let result = try await GameService.shared.fireShot(gameId: game.id, at: target)
                Feedback.shot(result.result)
                switch result.result {
                case .miss: show(Banner(text: "Miss at \(Board.label(target))", color: .gray))
                case .hit: show(Banner(text: "Hit at \(Board.label(target))!", color: Theme.hit))
                case .sunk: show(Banner(text: "You sank their \(result.sunkShip?.displayName ?? "ship")!", color: Theme.sunk))
                }
            } catch {
                Feedback.error()
                store.error = AppError.from(error)
            }
        }
    }

    private func announceIncoming(_ count: Int) {
        defer { lastSeenOpponentShots = count }
        guard lastSeenOpponentShots >= 0, count > lastSeenOpponentShots, let shot = theirShots.last else { return }
        let who = store.opponent?.username ?? "Opponent"
        switch shot.result {
        case .miss: show(Banner(text: "\(who) missed at \(Board.label(shot.coordinate))", color: .gray))
        case .hit: show(Banner(text: "\(who) hit your ship at \(Board.label(shot.coordinate))", color: Theme.hit))
        case .sunk: show(Banner(text: "\(who) sank your \(shot.sunkShip?.displayName ?? "ship")", color: Theme.sunk))
        }
        Feedback.shot(shot.result)
    }

    private func show(_ b: Banner) {
        banner = b
        Task {
            try? await Task.sleep(nanoseconds: 2_200_000_000)
            if banner == b { banner = nil }
        }
    }

    static func mark(for result: ShotResult) -> CellMark {
        switch result {
        case .miss: return .miss
        case .hit: return .hit
        case .sunk: return .sunk
        }
    }
}
