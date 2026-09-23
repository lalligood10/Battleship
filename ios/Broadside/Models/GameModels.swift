import Foundation

// These mirror functions/src/types.ts. Field names must stay identical to what the Cloud Functions write.

enum ShipType: String, Codable, CaseIterable, Identifiable {
    case carrier, battleship, cruiser, submarine, destroyer

    var id: String { rawValue }

    var length: Int {
        switch self {
        case .carrier: return 5
        case .battleship: return 4
        case .cruiser: return 3
        case .submarine: return 3
        case .destroyer: return 2
        }
    }

    var displayName: String {
        switch self {
        case .carrier: return "Carrier"
        case .battleship: return "Battleship"
        case .cruiser: return "Cruiser"
        case .submarine: return "Submarine"
        case .destroyer: return "Destroyer"
        }
    }
}

struct Coordinate: Hashable, Codable {
    var row: Int
    var col: Int
}

struct ShipPlacement: Codable, Hashable, Identifiable {
    var type: ShipType
    var row: Int
    var col: Int
    var horizontal: Bool

    var id: ShipType { type }
}

enum ShotResult: String, Codable {
    case miss, hit, sunk
}

struct Shot: Codable, Hashable {
    var row: Int
    var col: Int
    var result: ShotResult
    var sunkShip: ShipType?
    /// Where the sunk ship was (only when `result == .sunk`); lets the UI paint the whole ship.
    var sunkPlacement: ShipPlacement?
    /// Milliseconds since 1970, set by the server.
    var at: Double

    var coordinate: Coordinate { Coordinate(row: row, col: col) }
}

enum GameStatus: String, Codable {
    case waiting, placing, active, finished, cancelled
}

enum EndReason: String, Codable {
    case allSunk = "all_sunk"
    case resign
    case timeout
}

struct GamePlayer: Codable, Hashable {
    var username: String
    var rating: Int
    var ready: Bool
    var sunkShips: [ShipType]
    var shotsFired: Int
    var hits: Int
}

struct RatingChange: Codable, Hashable {
    var before: Int
    var after: Int
    var delta: Int
}

struct Game: Codable, Identifiable, Hashable {
    var id: String = ""
    var code: String
    var status: GameStatus
    var hostUid: String
    var playerUids: [String]
    var players: [String: GamePlayer]
    var shots: [String: [Shot]]
    var currentTurnUid: String?
    var turnNumber: Int
    var winnerUid: String?
    var endReason: EndReason?
    var ratingChanges: [String: RatingChange]?
    var revealedFleets: [String: [ShipPlacement]]?
    var isQuickMatch: Bool
    var abandonTimeoutMs: Double
    var createdAt: Date?
    var updatedAt: Date?
    var startedAt: Date?
    var finishedAt: Date?
    var lastMoveAt: Date?

    // `id` is the Firestore document ID, filled in after decoding – never part of the document body.
    enum CodingKeys: String, CodingKey {
        case code, status, hostUid, playerUids, players, shots, currentTurnUid, turnNumber, winnerUid, endReason
        case ratingChanges, revealedFleets, isQuickMatch, abandonTimeoutMs, createdAt, updatedAt, startedAt, finishedAt, lastMoveAt
    }

    // MARK: Convenience

    func opponentUid(of uid: String) -> String? {
        playerUids.first { $0 != uid }
    }

    func player(_ uid: String?) -> GamePlayer? {
        guard let uid else { return nil }
        return players[uid]
    }

    func isMyTurn(_ uid: String) -> Bool {
        status == .active && currentTurnUid == uid
    }

    func shots(by uid: String?) -> [Shot] {
        guard let uid else { return [] }
        return shots[uid] ?? []
    }

    var isOver: Bool { status == .finished || status == .cancelled }

    /// When the waiting player may claim a win by inactivity (nil if not applicable).
    var abandonDeadline: Date? {
        guard status == .active || status == .placing, let lastMoveAt else { return nil }
        return lastMoveAt.addingTimeInterval(abandonTimeoutMs / 1000)
    }
}

struct PrivateBoard: Codable {
    var fleet: [ShipPlacement]
    /// "row,col" keys of my ship cells that have been hit.
    var hitCells: [String]
    var updatedAt: Date?

    var hitCoordinates: Set<Coordinate> {
        Set(hitCells.compactMap { key -> Coordinate? in
            let parts = key.split(separator: ",")
            guard parts.count == 2, let r = Int(parts[0]), let c = Int(parts[1]) else { return nil }
            return Coordinate(row: r, col: c)
        })
    }
}

struct QuickMatchTicket: Codable {
    var username: String
    var rating: Int
    var gameId: String?
    var createdAt: Date?
}
