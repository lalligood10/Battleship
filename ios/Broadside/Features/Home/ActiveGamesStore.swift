import FirebaseFirestore
import Foundation

/// Live list of the current user's unfinished games (realtime listener).
@MainActor
final class ActiveGamesStore: ObservableObject {
    @Published private(set) var games: [Game] = []
    @Published private(set) var loaded = false
    @Published var error: AppError?

    private var listener: ListenerRegistration?
    private var uid: String?

    func start(uid: String) {
        guard self.uid != uid else { return }
        stop()
        self.uid = uid
        loaded = false
        listener = Firestore.firestore().collection("games")
            .whereField("playerUids", arrayContains: uid)
            .whereField("status", in: [GameStatus.waiting.rawValue, GameStatus.placing.rawValue, GameStatus.active.rawValue])
            .order(by: "updatedAt", descending: true)
            .limit(to: 50)
            .addSnapshotListener { [weak self] snapshot, error in
                Task { @MainActor in
                    guard let self else { return }
                    self.loaded = true
                    if let error {
                        self.error = AppError.from(error)
                        return
                    }
                    self.games = (snapshot?.documents ?? []).compactMap { doc in
                        try? Game.from(doc)
                    }
                }
            }
    }

    func stop() {
        listener?.remove()
        listener = nil
        uid = nil
    }
}
