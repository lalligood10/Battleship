import Combine
import FirebaseFirestore
import Foundation

/// Combines the Firebase auth state with the user's profile document to decide which screen to show.
@MainActor
final class SessionStore: ObservableObject {
    enum State: Equatable {
        case loading
        case signedOut
        /// Signed in but no `users/{uid}` document yet – must pick a username.
        case needsUsername
        case ready(UserProfile)
    }

    @Published private(set) var state: State = .loading
    @Published private(set) var profile: UserProfile?
    @Published var error: AppError?

    let auth: AuthService
    private var cancellables = Set<AnyCancellable>()
    private var profileListener: ListenerRegistration?

    init(auth: AuthService) {
        self.auth = auth
        auth.$user
            .combineLatest(auth.$isResolved)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] user, resolved in
                guard let self, resolved else { return }
                self.observeProfile(uid: user?.uid)
            }
            .store(in: &cancellables)
    }

    var uid: String? { auth.uid }

    private func observeProfile(uid: String?) {
        profileListener?.remove()
        profileListener = nil
        profile = nil

        guard let uid else {
            state = .signedOut
            return
        }
        state = .loading
        profileListener = Firestore.firestore().document("users/\(uid)").addSnapshotListener { [weak self] snapshot, error in
            Task { @MainActor in
                guard let self else { return }
                if let error {
                    self.error = AppError.from(error)
                    return
                }
                do {
                    if let snapshot, let profile = try UserProfile.from(snapshot) {
                        self.profile = profile
                        self.state = .ready(profile)
                        PushService.shared.registerTokenIfNeeded(uid: uid)
                    } else {
                        self.profile = nil
                        self.state = .needsUsername
                    }
                } catch {
                    self.error = AppError.from(error)
                }
            }
        }
    }

    func signOut() {
        do {
            try auth.signOut()
        } catch {
            self.error = AppError.from(error)
        }
    }
}
