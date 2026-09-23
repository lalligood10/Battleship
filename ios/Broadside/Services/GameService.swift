import FirebaseFirestore
import FirebaseFunctions
import Foundation

/// All writes go through Cloud Functions (see functions/src/index.ts). The client never mutates game state directly,
/// which is what makes the anti-cheat guarantees hold.
struct GameService {
    static let shared = GameService()

    private let functions = Functions.functions()
    private let db = Firestore.firestore()

    // MARK: Callables

    struct CreateGameResult: Decodable { let gameId: String; let code: String }
    struct JoinGameResult: Decodable { let gameId: String }
    struct PlaceShipsResult: Decodable { let status: GameStatus }
    struct FireShotResult: Decodable {
        let result: ShotResult
        let sunkShip: ShipType?
        let gameOver: Bool
        let winnerUid: String?
    }
    struct EndGameResult: Decodable { let winnerUid: String }
    struct CheckUsernameResult: Decodable { let available: Bool; let reason: String? }
    struct SetUsernameResult: Decodable { let username: String }
    struct QuickMatchResult: Decodable { let gameId: String? }

    func checkUsername(_ username: String) async throws -> CheckUsernameResult {
        try await call("checkUsername", ["username": username])
    }

    func setUsername(_ username: String) async throws -> SetUsernameResult {
        try await call("setUsername", ["username": username])
    }

    func createGame() async throws -> CreateGameResult {
        try await call("createGame", [:])
    }

    func joinGame(code: String) async throws -> JoinGameResult {
        try await call("joinGame", ["code": code])
    }

    func cancelGame(gameId: String) async throws {
        _ = try await callRaw("cancelGame", ["gameId": gameId])
    }

    func placeShips(gameId: String, fleet: [ShipPlacement]) async throws -> PlaceShipsResult {
        let ships: [[String: Any]] = fleet.map {
            ["type": $0.type.rawValue, "row": $0.row, "col": $0.col, "horizontal": $0.horizontal]
        }
        return try await call("placeShips", ["gameId": gameId, "ships": ships])
    }

    func fireShot(gameId: String, at c: Coordinate) async throws -> FireShotResult {
        try await call("fireShot", ["gameId": gameId, "row": c.row, "col": c.col])
    }

    func resign(gameId: String) async throws -> EndGameResult {
        try await call("resign", ["gameId": gameId])
    }

    func claimTimeoutWin(gameId: String) async throws -> EndGameResult {
        try await call("claimTimeoutWin", ["gameId": gameId])
    }

    func joinQuickMatch() async throws -> QuickMatchResult {
        try await call("joinQuickMatch", [:])
    }

    func cancelQuickMatch() async throws {
        _ = try await callRaw("cancelQuickMatch", [:])
    }

    // MARK: Plumbing

    private func callRaw(_ name: String, _ data: [String: Any]) async throws -> Any {
        do {
            return try await functions.httpsCallable(name).call(data).data
        } catch {
            throw AppError.from(error)
        }
    }

    /// Callable results arrive as `Any` (JSON-ish dictionaries). Round-trip through JSONSerialization to decode.
    private func call<T: Decodable>(_ name: String, _ data: [String: Any]) async throws -> T {
        let raw = try await callRaw(name, data)
        let json = try JSONSerialization.data(withJSONObject: raw, options: [.fragmentsAllowed])
        do {
            return try JSONDecoder().decode(T.self, from: json)
        } catch {
            throw AppError.message("Unexpected response from server (\(name)).")
        }
    }
}

// MARK: - Firestore document helpers

extension DocumentSnapshot {
    /// Decodes the document, stamping the Firestore ID into `id` via the closure.
    func decode<T: Decodable>(_ type: T.Type, assignId: (inout T, String) -> Void) throws -> T? {
        guard exists else { return nil }
        var value = try data(as: T.self)
        assignId(&value, documentID)
        return value
    }
}

extension Game {
    static func from(_ snapshot: DocumentSnapshot) throws -> Game? {
        try snapshot.decode(Game.self) { $0.id = $1 }
    }
}

extension UserProfile {
    static func from(_ snapshot: DocumentSnapshot) throws -> UserProfile? {
        try snapshot.decode(UserProfile.self) { $0.id = $1 }
    }
}

extension WeeklyWins {
    static func from(_ snapshot: DocumentSnapshot) throws -> WeeklyWins? {
        try snapshot.decode(WeeklyWins.self) { $0.id = $1 }
    }
}

extension Opponent {
    static func from(_ snapshot: DocumentSnapshot) throws -> Opponent? {
        try snapshot.decode(Opponent.self) { $0.id = $1 }
    }
}
