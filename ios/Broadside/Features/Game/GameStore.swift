import FirebaseFirestore
import Foundation

/// Realtime state for one game: the public game document plus *my* private board.
/// The opponent's private board is unreadable by security rules, so it is never requested.
@MainActor
final class GameStore: ObservableObject {
    let gameId: String
    let uid: String

    @Published private(set) var game: Game?
    @Published private(set) var myBoard: PrivateBoard?
    @Published private(set) var loaded = false
    @Published var error: AppError?

    private var gameListener: ListenerRegistration?
    private var boardListener: ListenerRegistration?

    init(gameId: String, uid: String) {
        self.gameId = gameId
        self.uid = uid
    }

    func start() {
        guard gameListener == nil else { return }
        let db = Firestore.firestore()
        gameListener = db.document("games/\(gameId)").addSnapshotListener { [weak self] snapshot, error in
            Task { @MainActor in
                guard let self else { return }
                self.loaded = true
                if let error {
                    self.error = AppError.from(error)
                    return
                }
                do {
                    self.game = try snapshot.flatMap { try Game.from($0) }
                    if self.game == nil { self.error = .message("This game no longer exists.") }
                } catch {
                    self.error = AppError.from(error)
                }
            }
        }
        boardListener = db.document("games/\(gameId)/private/\(uid)").addSnapshotListener { [weak self] snapshot, error in
            Task { @MainActor in
                guard let self else { return }
                if error != nil { return } // Doc doesn't exist until we place ships; rules allow the read.
                self.myBoard = try? snapshot?.data(as: PrivateBoard.self)
            }
        }
    }

    func stop() {
        gameListener?.remove()
        boardListener?.remove()
        gameListener = nil
        boardListener = nil
    }

    var opponentUid: String? { game?.opponentUid(of: uid) }
    var me: GamePlayer? { game?.players[uid] }
    var opponent: GamePlayer? { game?.player(opponentUid) }
    var isMyTurn: Bool { game?.isMyTurn(uid) ?? false }
}
