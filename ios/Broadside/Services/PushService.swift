import FirebaseAuth
import FirebaseFirestore
import FirebaseMessaging
import Foundation
import UIKit
import UserNotifications

/// Handles notification permission and stores the FCM token under users/{uid}/private/push
/// (the only Firestore document a client is allowed to write – see firestore.rules).
@MainActor
final class PushService: NSObject, ObservableObject {
    static let shared = PushService()

    @Published private(set) var fcmToken: String?
    private var savedFor: (uid: String, token: String)?

    /// Set by the app when a notification is tapped so the UI can open that game.
    @Published var pendingGameId: String?

    func requestPermission() {
        Task {
            let center = UNUserNotificationCenter.current()
            let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
            if granted {
                await MainActor.run { UIApplication.shared.registerForRemoteNotifications() }
            }
        }
    }

    func didReceiveFCMToken(_ token: String?) {
        fcmToken = token
        if let uid = Auth.auth().currentUser?.uid {
            registerTokenIfNeeded(uid: uid)
        }
    }

    func registerTokenIfNeeded(uid: String) {
        guard let token = fcmToken else { return }
        if let savedFor, savedFor.uid == uid, savedFor.token == token { return }
        savedFor = (uid, token)
        Firestore.firestore().document("users/\(uid)/private/push").setData(
            ["tokens": FieldValue.arrayUnion([token]), "updatedAt": FieldValue.serverTimestamp()],
            merge: true
        ) { [weak self] error in
            if error != nil { Task { @MainActor in self?.savedFor = nil } }
        }
    }

    func handleNotificationTap(userInfo: [AnyHashable: Any]) {
        if let gameId = userInfo["gameId"] as? String {
            pendingGameId = gameId
        }
    }
}
