import Foundation

public enum LocationAuthorization: String, Codable, Sendable, Hashable {
    case notDetermined
    case denied
    case restricted
    case authorized
    /// Location services are switched off system-wide.
    case servicesDisabled

    public var isAuthorized: Bool { self == .authorized }

    public var label: String {
        switch self {
        case .notDetermined: "Not requested"
        case .denied: "Denied"
        case .restricted: "Restricted"
        case .authorized: "Allowed"
        case .servicesDisabled: "Location Services off"
        }
    }
}

public enum NotificationAuthorization: String, Codable, Sendable, Hashable {
    case notDetermined
    case denied
    case authorized

    public var label: String {
        switch self {
        case .notDetermined: "Not requested"
        case .denied: "Off"
        case .authorized: "On"
        }
    }
}

public struct LocationFix: Codable, Hashable, Sendable {
    public var point: GeoPoint
    public var at: Date
    public var accuracyMeters: Double?
    public var simulated: Bool

    public init(point: GeoPoint, at: Date, accuracyMeters: Double?, simulated: Bool) {
        self.point = point
        self.at = at
        self.accuracyMeters = accuracyMeters
        self.simulated = simulated
    }
}

@MainActor
public protocol LocationProviding: AnyObject {
    var authorization: LocationAuthorization { get }
    var onUpdate: ((LocationFix) -> Void)? { get set }
    var onAuthorizationChange: ((LocationAuthorization) -> Void)? { get set }
    var onFailure: ((String) -> Void)? { get set }
    func requestAuthorization()
    /// One-shot fix for a reading refresh.
    func requestFix()
    /// Continuous updates for an active trip.
    func startTripUpdates()
    func stopTripUpdates()
}

public enum NotificationAction: String, Sendable {
    case acknowledge = "AQI_ACK"
    case reroute = "AQI_ROUTE"
    case open = "com.apple.UNNotificationDefaultActionIdentifier"
    case dismiss = "com.apple.UNNotificationDismissActionIdentifier"
}

@MainActor
public protocol AlertNotifying: AnyObject {
    func authorizationStatus() async -> NotificationAuthorization
    func requestAuthorization() async -> NotificationAuthorization
    /// Posts a local notification for an alert raised while the app is not frontmost.
    func deliver(_ alert: PollutionAlert) async
    func removeDelivered(alertId: String)
}

public enum HapticKind: Sendable {
    case alert
    case success
    case failure
    case start
    case stop
}

@MainActor
public protocol HapticsPlaying: AnyObject {
    func play(_ kind: HapticKind)
}

@MainActor
public protocol ConnectivitySending: AnyObject {
    var isCounterpartAvailable: Bool { get }
    func send(_ message: ConnectivityMessage, delivery: ConnectivityDelivery)
}
