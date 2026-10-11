import Foundation

// Request and response bodies of the AEROSCOPE watch API (see docs/API.md).

public struct HealthResponse: Codable, Hashable, Sendable {
    public var status: String
    public var version: String
    public var provenance: Provenance
    public var scenario: Scenario
    /// True when APNs delivery through SNS is configured on the backend.
    public var push: Bool
    /// True when real-time publishing to the web dashboard is configured.
    public var realtime: Bool
}

public struct CityDataResponse: Codable, Hashable, Sendable {
    public var dataset: CityDataset
    public var scenario: Scenario
    public var generatedAt: Date
}

public struct ReadingQuery: Hashable, Sendable {
    public var location: GeoPoint?
    public var zoneId: String?

    public init(location: GeoPoint? = nil, zoneId: String? = nil) {
        self.location = location
        self.zoneId = zoneId
    }
}

public struct CurrentReadingResponse: Codable, Hashable, Sendable {
    public var reading: ZoneReading
    public var match: ZoneMatch
    public var scenario: Scenario?
    public var generatedAt: Date
}

public struct StartTripRequest: Codable, Hashable, Sendable {
    public var tripId: String
    public var startedAt: Date
    public var mode: TravelMode
    public var source: DataSourceMode
    public var origin: LocationPayload?
    public var destinationZoneId: String?
    public var plannedZoneIds: [String]

    public init(tripId: String, startedAt: Date, mode: TravelMode, source: DataSourceMode, origin: LocationPayload?,
                destinationZoneId: String?, plannedZoneIds: [String]) {
        self.tripId = tripId
        self.startedAt = startedAt
        self.mode = mode
        self.source = source
        self.origin = origin
        self.destinationZoneId = destinationZoneId
        self.plannedZoneIds = plannedZoneIds
    }
}

public enum TripEventType: String, Codable, Sendable, Hashable {
    case location
    case pause
    case resume
    case end
}

public struct TripEventRequest: Codable, Hashable, Sendable {
    public var type: TripEventType
    public var at: Date
    public var location: LocationPayload?
    /// An alert the watch raised from cached data while offline, synced so the
    /// backend and dashboard record the same alert id.
    public var deviceAlert: PollutionAlert?

    public init(type: TripEventType, at: Date, location: LocationPayload? = nil, deviceAlert: PollutionAlert? = nil) {
        self.type = type
        self.at = at
        self.location = location
        self.deviceAlert = deviceAlert
    }
}

public enum AlertAction: String, Codable, Sendable, Hashable {
    case acknowledge
    case dismiss
    case requestRoute = "request-route"
}

public struct AlertActionRequest: Codable, Hashable, Sendable {
    public var action: AlertAction
    public var at: Date
    public var mode: TravelMode?
    public var currentZoneId: String?
    public var destinationZoneId: String?
    public var plannedZoneIds: [String]?

    public init(action: AlertAction, at: Date, mode: TravelMode? = nil, currentZoneId: String? = nil,
                destinationZoneId: String? = nil, plannedZoneIds: [String]? = nil) {
        self.action = action
        self.at = at
        self.mode = mode
        self.currentZoneId = currentZoneId
        self.destinationZoneId = destinationZoneId
        self.plannedZoneIds = plannedZoneIds
    }
}

public struct AcceptRouteRequest: Codable, Hashable, Sendable {
    public var routeId: String
    public var choice: RouteChoice
    public var zoneIds: [String]
    public var alertId: String?
    public var at: Date

    public init(routeId: String, choice: RouteChoice, zoneIds: [String], alertId: String?, at: Date) {
        self.routeId = routeId
        self.choice = choice
        self.zoneIds = zoneIds
        self.alertId = alertId
        self.at = at
    }
}

public struct RouteCompareRequest: Codable, Hashable, Sendable {
    public var fromZoneId: String
    public var toZoneId: String
    public var mode: TravelMode
    public var plannedZoneIds: [String]?

    public init(fromZoneId: String, toZoneId: String, mode: TravelMode, plannedZoneIds: [String]? = nil) {
        self.fromZoneId = fromZoneId
        self.toZoneId = toZoneId
        self.mode = mode
        self.plannedZoneIds = plannedZoneIds
    }
}

public struct DeviceRegistration: Codable, Hashable, Sendable {
    public var deviceId: String
    /// APNs device token, hex encoded.
    public var token: String
    public var platform: String
    public var environment: String
    public var bundleId: String

    public init(deviceId: String, token: String, platform: String, environment: String, bundleId: String) {
        self.deviceId = deviceId
        self.token = token
        self.platform = platform
        self.environment = environment
        self.bundleId = bundleId
    }
}

/// A state-changing call that can be queued while offline and replayed later
/// (by the watch itself or relayed through the iPhone).
public enum BackendOperation: Codable, Hashable, Sendable {
    case startTrip(StartTripRequest)
    case tripEvent(tripId: String, event: TripEventRequest)
    case alertAction(alertId: String, request: AlertActionRequest)
    case acceptRoute(tripId: String, request: AcceptRouteRequest)
    case updatePreferences(AlertPreferences)

    public var summary: String {
        switch self {
        case .startTrip: "Trip started"
        case .tripEvent(_, let e):
            switch e.type {
            case .location: "Location update"
            case .pause: "Trip paused"
            case .resume: "Trip resumed"
            case .end: "Trip ended"
            }
        case .alertAction(_, let r):
            switch r.action {
            case .acknowledge: "Alert acknowledged"
            case .dismiss: "Alert dismissed"
            case .requestRoute: "Route requested"
            }
        case .acceptRoute(_, let r): r.choice == .alternative ? "Reroute accepted" : "Route kept"
        case .updatePreferences: "Preferences updated"
        }
    }

    /// Location updates may be dropped under queue pressure; everything else is kept.
    public var isDroppable: Bool {
        if case .tripEvent(_, let e) = self, e.type == .location, e.deviceAlert == nil { return true }
        return false
    }
}

/// Union response for `BackendOperation`s; fields are set as relevant.
public struct OperationResult: Codable, Hashable, Sendable {
    public var tripPhase: TripPhase?
    public var plannedZoneIds: [String]?
    public var evaluation: Evaluation?
    public var alert: PollutionAlert?
    public var routeComparison: RouteComparison?
    /// True when the backend returned the stored result for a repeated idempotency key.
    public var replayed: Bool?

    public init(tripPhase: TripPhase? = nil, plannedZoneIds: [String]? = nil, evaluation: Evaluation? = nil,
                alert: PollutionAlert? = nil, routeComparison: RouteComparison? = nil, replayed: Bool? = nil) {
        self.tripPhase = tripPhase
        self.plannedZoneIds = plannedZoneIds
        self.evaluation = evaluation
        self.alert = alert
        self.routeComparison = routeComparison
        self.replayed = replayed
    }
}

public enum EvaluationSource: String, Codable, Sendable, Hashable {
    /// From a location the watch (or iPhone) reported.
    case device
    /// From the web dashboard walking the character (simulated position).
    case dashboard
    /// From a simulated move injected by a demo operator.
    case `operator`

    /// Moves made somewhere else that this device should follow.
    public var isRemote: Bool { self != .device }
}

/// Where the trip's character currently is (zone level; no raw GPS).
public struct TripLocation: Codable, Hashable, Sendable {
    public var world: WorldPoint?
    public var zoneId: String?
    public var simulated: Bool
    public var at: Date
}

public struct TripStatusResponse: Codable, Hashable, Sendable {
    public var tripId: String
    public var phase: TripPhase
    public var plannedZoneIds: [String]
    public var lastEvaluation: Evaluation?
    public var lastEvaluationSource: EvaluationSource?
    public var lastEvaluationAt: Date?
    public var alerts: [PollutionAlert]
    // Set by the cloud backend; lets a device adopt a trip started elsewhere.
    public var source: DataSourceMode?
    public var mode: TravelMode?
    public var startedAt: Date?
    public var endedAt: Date?
    public var originZoneId: String?
    public var destinationZoneId: String?
    public var currentLocation: TripLocation?
    public var isDemo: Bool?

    public init(tripId: String, phase: TripPhase, plannedZoneIds: [String], lastEvaluation: Evaluation?,
                lastEvaluationSource: EvaluationSource?, lastEvaluationAt: Date?, alerts: [PollutionAlert],
                source: DataSourceMode? = nil, mode: TravelMode? = nil, startedAt: Date? = nil, endedAt: Date? = nil,
                originZoneId: String? = nil, destinationZoneId: String? = nil, currentLocation: TripLocation? = nil,
                isDemo: Bool? = nil) {
        self.tripId = tripId
        self.phase = phase
        self.plannedZoneIds = plannedZoneIds
        self.lastEvaluation = lastEvaluation
        self.lastEvaluationSource = lastEvaluationSource
        self.lastEvaluationAt = lastEvaluationAt
        self.alerts = alerts
        self.source = source
        self.mode = mode
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.originZoneId = originZoneId
        self.destinationZoneId = destinationZoneId
        self.currentLocation = currentLocation
        self.isDemo = isDemo
    }
}

public struct AlertsResponse: Codable, Hashable, Sendable {
    public var alerts: [PollutionAlert]
}
