import FirebaseAuth
import FirebaseFunctions
import Foundation

/// User-presentable error. Every async call in the app funnels into one of these so no failure is silent.
enum AppError: LocalizedError, Identifiable {
    case message(String)

    var id: String { errorDescription ?? "error" }

    var errorDescription: String? {
        switch self {
        case .message(let text): return text
        }
    }

    /// Converts Firebase errors into plain-English text.
    static func from(_ error: Error) -> AppError {
        if let app = error as? AppError { return app }
        let ns = error as NSError

        if ns.domain == FunctionsErrorDomain {
            // Cloud Functions send a human-readable message with every HttpsError.
            let code = FunctionsErrorCode(rawValue: ns.code)
            switch code {
            case .unauthenticated: return .message("Please sign in again.")
            case .unavailable, .deadlineExceeded: return .message("Can't reach the server. Check your connection and try again.")
            case .internal: return .message("Something went wrong on the server. Please try again.")
            default: return .message(ns.localizedDescription)
            }
        }

        if ns.domain == AuthErrorDomain, let code = AuthErrorCode(rawValue: ns.code) {
            switch code {
            case .invalidEmail: return .message("That email address doesn't look right.")
            case .wrongPassword, .invalidCredential, .userNotFound: return .message("Email or password is incorrect.")
            case .emailAlreadyInUse: return .message("An account with that email already exists. Try signing in.")
            case .weakPassword: return .message("Password must be at least 6 characters.")
            case .networkError: return .message("No internet connection.")
            case .tooManyRequests: return .message("Too many attempts. Please wait a moment and try again.")
            default: return .message(ns.localizedDescription)
            }
        }

        if ns.domain == NSURLErrorDomain {
            return .message("No internet connection.")
        }
        return .message(ns.localizedDescription)
    }
}
