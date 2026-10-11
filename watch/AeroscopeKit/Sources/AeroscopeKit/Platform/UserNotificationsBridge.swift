#if canImport(UserNotifications)
import Foundation
import UserNotifications

/// Local notifications for alerts, the actionable "AQI_ALERT" category shared
/// with remote pushes, and routing of notification responses to the app.
@MainActor
public final class UserNotificationsBridge: NSObject, AlertNotifying {
    nonisolated public static let categoryIdentifier = "AQI_ALERT"
    /// Key holding the alert JSON in local and remote notification payloads.
    nonisolated public static let alertPayloadKey = "aeroscopeAlert"

    /// A notification action (or tap) for an alert.
    public var onAction: ((NotificationAction, PollutionAlert?) -> Void)?
    /// An alert notification arrived while the app is frontmost. The app shows
    /// its own alert screen, so the system banner is suppressed.
    public var onForegroundAlert: ((PollutionAlert) -> Void)?

    private let center = UNUserNotificationCenter.current()

    public override init() {
        super.init()
    }

    /// Call early in launch so responses that launched the app are delivered.
    public func install() {
        center.delegate = self
        let acknowledge = UNNotificationAction(identifier: NotificationAction.acknowledge.rawValue, title: "Got it", options: [])
        let reroute = UNNotificationAction(identifier: NotificationAction.reroute.rawValue, title: "Cleaner route", options: [.foreground])
        let category = UNNotificationCategory(
            identifier: Self.categoryIdentifier, actions: [reroute, acknowledge], intentIdentifiers: [], options: []
        )
        center.setNotificationCategories([category])
    }

    public func authorizationStatus() async -> NotificationAuthorization {
        Self.map(await center.notificationSettings().authorizationStatus)
    }

    public func requestAuthorization() async -> NotificationAuthorization {
        _ = try? await center.requestAuthorization(options: [.alert, .sound])
        return await authorizationStatus()
    }

    public func deliver(_ alert: PollutionAlert) async {
        guard await authorizationStatus() == .authorized else { return }
        let content = UNMutableNotificationContent()
        content.title = alert.title
        content.body = "\(alert.message). \(alert.advice)"
        content.categoryIdentifier = Self.categoryIdentifier
        content.threadIdentifier = "aqi"
        content.sound = .default
        if let data = try? AeroscopeJSON.encoder().encode(alert), let json = String(data: data, encoding: .utf8) {
            content.userInfo = [Self.alertPayloadKey: json]
        }
        try? await center.add(UNNotificationRequest(identifier: alert.id, content: content, trigger: nil))
    }

    public func removeDelivered(alertId: String) {
        center.removeDeliveredNotifications(withIdentifiers: [alertId])
        center.removePendingNotificationRequests(withIdentifiers: [alertId])
    }

    /// Decodes the alert from a local (JSON string) or remote (dictionary) payload.
    nonisolated public static func alert(from userInfo: [AnyHashable: Any]) -> PollutionAlert? {
        let raw = userInfo[alertPayloadKey]
        let data: Data?
        if let string = raw as? String {
            data = Data(string.utf8)
        } else if let dictionary = raw as? [String: Any], JSONSerialization.isValidJSONObject(dictionary) {
            data = try? JSONSerialization.data(withJSONObject: dictionary)
        } else {
            data = nil
        }
        return data.flatMap { try? AeroscopeJSON.decoder().decode(PollutionAlert.self, from: $0) }
    }

    nonisolated static func map(_ status: UNAuthorizationStatus) -> NotificationAuthorization {
        switch status {
        case .notDetermined: .notDetermined
        case .denied: .denied
        default: .authorized
        }
    }
}

extension UserNotificationsBridge: UNUserNotificationCenterDelegate {
    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        guard let alert = Self.alert(from: notification.request.content.userInfo) else { return [.banner, .sound] }
        await MainActor.run { self.onForegroundAlert?(alert) }
        return []
    }

    nonisolated public func userNotificationCenter(
        _ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
    ) async {
        let action = NotificationAction(rawValue: response.actionIdentifier) ?? .open
        let alert = Self.alert(from: response.notification.request.content.userInfo)
        await MainActor.run { self.onAction?(action, alert) }
    }
}
#endif
