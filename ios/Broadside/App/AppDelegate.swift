import FirebaseAuth
import FirebaseMessaging
import UIKit
import UserNotifications

/// Bridges APNs <-> Firebase Cloud Messaging and forwards notification taps to PushService.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate, MessagingDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        if FirebaseSetup.isConfigured {
            Messaging.messaging().delegate = self
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        guard FirebaseSetup.isConfigured else { return }
        Messaging.messaging().apnsToken = deviceToken
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Expected in the simulator; nothing to do.
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any]
    ) async -> UIBackgroundFetchResult {
        // Firebase Auth uses silent pushes for phone auth; harmless to forward.
        if Auth.auth().canHandleNotification(userInfo) { return .noData }
        return .newData
    }

    // MARK: MessagingDelegate

    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        Task { @MainActor in PushService.shared.didReceiveFCMToken(fcmToken) }
    }

    // MARK: UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        // Show banners even while the app is open – the board updates live anyway, but the banner confirms it.
        [.banner, .sound]
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let userInfo = response.notification.request.content.userInfo
        await MainActor.run { PushService.shared.handleNotificationTap(userInfo: userInfo) }
    }
}
