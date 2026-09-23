import AuthenticationServices
import CryptoKit
import FirebaseAuth
import Foundation

/// Thin wrapper over FirebaseAuth. Publishes the signed-in Firebase user.
@MainActor
final class AuthService: ObservableObject {
    @Published private(set) var user: User?
    @Published private(set) var isResolved = false

    /// Nonce for the in-flight Sign in with Apple request (Apple returns its SHA-256 in the identity token).
    private var currentNonce: String?
    private var handle: AuthStateDidChangeListenerHandle?

    init() {
        handle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            Task { @MainActor in
                self?.user = user
                self?.isResolved = true
            }
        }
    }

    deinit {
        if let handle { Auth.auth().removeStateDidChangeListener(handle) }
    }

    var uid: String? { user?.uid }

    // MARK: Email / password

    func signIn(email: String, password: String) async throws {
        _ = try await Auth.auth().signIn(withEmail: email.trimmingCharacters(in: .whitespaces), password: password)
    }

    func createAccount(email: String, password: String) async throws {
        _ = try await Auth.auth().createUser(withEmail: email.trimmingCharacters(in: .whitespaces), password: password)
    }

    func sendPasswordReset(email: String) async throws {
        try await Auth.auth().sendPasswordReset(withEmail: email.trimmingCharacters(in: .whitespaces))
    }

    func signOut() throws {
        try Auth.auth().signOut()
    }

    // MARK: Sign in with Apple

    /// Call from `SignInWithAppleButton(onRequest:)`.
    func prepareAppleRequest(_ request: ASAuthorizationAppleIDRequest) {
        let nonce = Self.randomNonce()
        currentNonce = nonce
        request.requestedScopes = [.fullName]
        request.nonce = Self.sha256(nonce)
    }

    /// Call from `SignInWithAppleButton(onCompletion:)` with a successful authorization.
    func completeAppleSignIn(_ authorization: ASAuthorization) async throws {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let idToken = String(data: tokenData, encoding: .utf8),
              let nonce = currentNonce else {
            throw AppError.message("Apple did not return a valid sign-in token. Please try again.")
        }
        currentNonce = nil
        let firebaseCredential = OAuthProvider.appleCredential(
            withIDToken: idToken,
            rawNonce: nonce,
            fullName: credential.fullName
        )
        _ = try await Auth.auth().signIn(with: firebaseCredential)
    }

    private static func randomNonce(length: Int = 32) -> String {
        let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
        var result = ""
        var remaining = length
        while remaining > 0 {
            var random: UInt8 = 0
            let status = SecRandomCopyBytes(kSecRandomDefault, 1, &random)
            precondition(status == errSecSuccess, "Unable to generate nonce")
            if random < charset.count {
                result.append(charset[Int(random)])
                remaining -= 1
            }
        }
        return result
    }

    private static func sha256(_ input: String) -> String {
        SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
