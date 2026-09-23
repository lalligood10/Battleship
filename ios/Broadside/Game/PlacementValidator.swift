import Foundation

enum PlacementProblem: Equatable {
    case offBoard
    case overlaps(ShipType)
    case touches(ShipType)

    var message: String {
        switch self {
        case .offBoard: return "Ship must stay on the board"
        case .overlaps(let t): return "Overlaps your \(t.displayName)"
        case .touches(let t): return "Touching your \(t.displayName)"
        }
    }
}

/// Client-side copy of the server's placement rules so the UI can give instant feedback.
/// The server re-validates everything in `placeShips`; this only exists for UX.
enum PlacementValidator {
    static func problem(for candidate: ShipPlacement, among others: [ShipPlacement]) -> PlacementProblem? {
        let cells = Board.cells(of: candidate)
        if cells.contains(where: { !Board.isOnBoard($0) }) { return .offBoard }
        let mine = Set(cells)
        for other in others where other.type != candidate.type {
            let theirs = Set(Board.cells(of: other))
            if !mine.isDisjoint(with: theirs) { return .overlaps(other.type) }
            if !Board.allowTouchingShips {
                for c in theirs {
                    for dr in -1...1 {
                        for dc in -1...1 where mine.contains(Coordinate(row: c.row + dr, col: c.col + dc)) {
                            return .touches(other.type)
                        }
                    }
                }
            }
        }
        return nil
    }

    /// True when all five ships are present exactly once and none conflict.
    static func isComplete(_ fleet: [ShipPlacement]) -> Bool {
        guard fleet.count == ShipType.allCases.count,
              Set(fleet.map(\.type)).count == ShipType.allCases.count else { return false }
        return fleet.allSatisfy { problem(for: $0, among: fleet) == nil }
    }

    /// Random legal fleet for the "Shuffle" button. Retries per ship until it fits.
    static func randomFleet<G: RandomNumberGenerator>(using rng: inout G) -> [ShipPlacement] {
        var fleet: [ShipPlacement] = []
        for type in ShipType.allCases {
            var attempts = 0
            while attempts < 1_000 {
                attempts += 1
                let horizontal = Bool.random(using: &rng)
                let maxRow = horizontal ? Board.size : Board.size - type.length + 1
                let maxCol = horizontal ? Board.size - type.length + 1 : Board.size
                let candidate = ShipPlacement(
                    type: type,
                    row: Int.random(in: 0..<maxRow, using: &rng),
                    col: Int.random(in: 0..<maxCol, using: &rng),
                    horizontal: horizontal
                )
                if problem(for: candidate, among: fleet) == nil {
                    fleet.append(candidate)
                    break
                }
            }
        }
        return fleet
    }

    static func randomFleet() -> [ShipPlacement] {
        var rng = SystemRandomNumberGenerator()
        return randomFleet(using: &rng)
    }

    /// Starting layout for the placement screen: ships parked in rows 0,2,4,6,8 so nothing overlaps.
    static func defaultFleet() -> [ShipPlacement] {
        ShipType.allCases.enumerated().map { i, type in
            ShipPlacement(type: type, row: i * 2, col: 0, horizontal: true)
        }
    }
}
