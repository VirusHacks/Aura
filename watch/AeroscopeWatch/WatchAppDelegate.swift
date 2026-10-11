import AeroscopeKit
import os
import WatchKit

/// Receives the APNs device token and background remote notifications.
final class WatchAppDelegate: NSObject, WKApplicationDelegate {
    var onDeviceToken: ((Data) -> Void)?
    var onRemoteAlert: ((PollutionAlert) -> Void)?

    private static let log = Logger(subsystem: "com.aeroscope", category: "Push")

    func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) {
        onDeviceToken?(deviceToken)
    }

    func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) {
        // Expected in the simulator and without the Push Notifications capability.
        Self.log.info("Remote notification registration failed: \(error.localizedDescription, privacy: .public)")
    }

    func didReceiveRemoteNotification(_ userInfo: [AnyHashable: Any]) async -> WKBackgroundFetchResult {
        guard let alert = UserNotificationsBridge.alert(from: userInfo) else { return .noData }
        onRemoteAlert?(alert)
        return .newData
    }
}

/// Taptic Engine feedback.
@MainActor
final class WatchHaptics: HapticsPlaying {
    func play(_ kind: HapticKind) {
        let type: WKHapticType = switch kind {
        case .alert: .notification
        case .success: .success
        case .failure: .failure
        case .start: .start
        case .stop: .stop
        }
        WKInterfaceDevice.current().play(type)
    }
}
