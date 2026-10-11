import Foundation

public enum DemoCommand: Codable, Hashable, Sendable {
    case setMode(DataSourceMode)
    case setScenario(Scenario)
    /// Move the simulated position one step along the demo route.
    case advance
    /// Return the simulated position to the start of the demo route.
    case restartJourney
}

/// What the watch reports to the iPhone for its status and activity screens.
public struct WatchSummary: Codable, Hashable, Sendable {
    public var generatedAt: Date
    public var mode: DataSourceMode
    public var snapshot: ReadingSnapshot?
    public var trip: Trip?
    public var recentTrips: [TripSummary]
    public var recentAlerts: [PollutionAlert]
    public var pendingActionCount: Int
    public var locationAuthorization: LocationAuthorization
    public var notificationAuthorization: NotificationAuthorization
    public var pushRegistered: Bool
    public var lastSyncAt: Date?
    public var lastSyncError: String?
    public var demoScenario: Scenario

    public init(generatedAt: Date, mode: DataSourceMode, snapshot: ReadingSnapshot?, trip: Trip?, recentTrips: [TripSummary],
                recentAlerts: [PollutionAlert], pendingActionCount: Int, locationAuthorization: LocationAuthorization,
                notificationAuthorization: NotificationAuthorization, pushRegistered: Bool, lastSyncAt: Date?,
                lastSyncError: String?, demoScenario: Scenario) {
        self.generatedAt = generatedAt
        self.mode = mode
        self.snapshot = snapshot
        self.trip = trip
        self.recentTrips = recentTrips
        self.recentAlerts = recentAlerts
        self.pendingActionCount = pendingActionCount
        self.locationAuthorization = locationAuthorization
        self.notificationAuthorization = notificationAuthorization
        self.pushRegistered = pushRegistered
        self.lastSyncAt = lastSyncAt
        self.lastSyncError = lastSyncError
        self.demoScenario = demoScenario
    }
}

/// The iPhone's identity and secrets, sent together so the watch never pairs
/// one installation's user id with another's key.
public struct CredentialTransfer: Codable, Hashable, Sendable {
    public var apiKey: String?
    public var userId: String
    public var userKey: String

    public init(apiKey: String?, userId: String, userKey: String) {
        self.apiKey = apiKey
        self.userId = userId
        self.userKey = userKey
    }
}

/// Every message exchanged between the iPhone companion and the watch.
public enum ConnectivityMessage: Codable, Hashable, Sendable {
    case preferences(AlertPreferences)
    case backendSettings(BackendSettings)
    /// Sent only over the encrypted WatchConnectivity channel (never as
    /// application context); stored in the Keychain on arrival.
    case credentials(CredentialTransfer)
    case demoCommand(DemoCommand)
    /// Watch → iPhone: actions the watch could not deliver itself.
    case pendingActions([PendingAction])
    /// iPhone → watch: actions the iPhone delivered (or the backend rejected).
    case actionResults(delivered: [UUID], dropped: [UUID])
    case watchSummary(WatchSummary)
    case requestSummary

    static let payloadKey = "aeroscope.v1"

    /// Application-context slot. Context keeps only the latest value per
    /// slot, so only "latest state" messages have one.
    public var contextSlot: String? {
        switch self {
        case .preferences: "preferences"
        case .backendSettings: "backendSettings"
        case .watchSummary: "watchSummary"
        default: nil
        }
    }

    public func encoded() throws -> [String: Any] {
        [Self.payloadKey: try AeroscopeJSON.encoder().encode(self)]
    }

    public static func decode(_ dictionary: [String: Any]) throws -> ConnectivityMessage {
        guard let data = dictionary[payloadKey] as? Data else { throw CocoaError(.coderValueNotFound) }
        return try AeroscopeJSON.decoder().decode(ConnectivityMessage.self, from: data)
    }

    /// Decodes every slot of a received application context.
    public static func decodeContext(_ context: [String: Any]) -> [ConnectivityMessage] {
        context.values.compactMap { value in
            guard let data = value as? Data else { return nil }
            return try? AeroscopeJSON.decoder().decode(ConnectivityMessage.self, from: data)
        }
    }
}

public enum ConnectivityDelivery: Sendable {
    /// Live message if the counterpart is reachable, otherwise queued transfer.
    case immediate
    /// Queued, guaranteed, in-order transfer (`transferUserInfo`).
    case guaranteed
    /// Latest-value-wins application context.
    case latestState
}
