import Foundation

/// Board geometry shared by placement, rendering and tests. Mirrors functions/src/game/config.ts & engine.ts.
enum Board {
    static let size = 10
    /// Ships may touch (standard rules). Flip to false to require a gap. Must match GAME_CONFIG on the server.
    static let allowTouchingShips = true

    static let columnLabels: [String] = (0..<size).map { String(UnicodeScalar(UInt8(65 + $0))) }
    static let rowLabels: [String] = (1...size).map(String.init)

    static func isOnBoard(_ c: Coordinate) -> Bool {
        c.row >= 0 && c.row < size && c.col >= 0 && c.col < size
    }

    static func cells(of ship: ShipPlacement) -> [Coordinate] {
        (0..<ship.type.length).map { i in
            ship.horizontal ? Coordinate(row: ship.row, col: ship.col + i) : Coordinate(row: ship.row + i, col: ship.col)
        }
    }

    /// "B3"-style label used in notifications and the shot log.
    static func label(_ c: Coordinate) -> String {
        guard isOnBoard(c) else { return "?" }
        return columnLabels[c.col] + rowLabels[c.row]
    }

    static func allCoordinates() -> [Coordinate] {
        (0..<size).flatMap { r in (0..<size).map { c in Coordinate(row: r, col: c) } }
    }
}
