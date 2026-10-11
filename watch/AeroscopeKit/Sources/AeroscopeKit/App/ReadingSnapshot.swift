import Foundation

/// Where the reading on screen came from, shown as the LIVE / CACHED / DEMO badge.
public enum DataStatus: String, Codable, Sendable, Hashable {
    /// Fetched from the AEROSCOPE backend within the freshness window.
    case live
    /// From an earlier fetch, or computed on-device from cached city data.
    case cached
    /// From the deterministic demo provider.
    case demo

    public var label: String { rawValue.uppercased() }
}

/// The reading on the home screen and everything needed to label it honestly.
public struct ReadingSnapshot: Codable, Hashable, Sendable {
    public static let freshFor: TimeInterval = 10 * 60
    public static let staleAfter: TimeInterval = 30 * 60

    public var reading: ZoneReading
    public var source: DataSourceMode
    /// The status when obtained; `status(at:)` downgrades LIVE to CACHED with age.
    public var obtainedAs: DataStatus
    /// When the underlying data was produced (server time, or cache time for offline estimates).
    public var dataAsOf: Date
    public var fetchedAt: Date
    public var location: LocationFix?
    public var world: WorldPoint?
    public var scenarioLabel: String?

    public init(reading: ZoneReading, source: DataSourceMode, obtainedAs: DataStatus, dataAsOf: Date, fetchedAt: Date,
                location: LocationFix?, world: WorldPoint?, scenarioLabel: String?) {
        self.reading = reading
        self.source = source
        self.obtainedAs = obtainedAs
        self.dataAsOf = dataAsOf
        self.fetchedAt = fetchedAt
        self.location = location
        self.world = world
        self.scenarioLabel = scenarioLabel
    }

    public func status(at now: Date) -> DataStatus {
        switch obtainedAs {
        case .demo: .demo
        case .cached: .cached
        case .live: now.timeIntervalSince(fetchedAt) > Self.freshFor ? .cached : .live
        }
    }

    public func isStale(at now: Date) -> Bool {
        source == .live && now.timeIntervalSince(dataAsOf) > Self.staleAfter
    }

    /// A snapshot restored from disk can never claim to be live.
    public var restored: ReadingSnapshot {
        var copy = self
        if copy.obtainedAs == .live { copy.obtainedAs = .cached }
        return copy
    }
}

/// Why the home screen cannot show a current reading.
public enum ReadingIssue: Hashable, Sendable {
    case backendNotConfigured
    case locationNotDetermined
    case locationDenied
    case locationUnavailable
    case outsideCoverage(String)
    case offline
    case backendError(String)

    public var title: String {
        switch self {
        case .backendNotConfigured: "Backend not connected"
        case .locationNotDetermined: "Location needed"
        case .locationDenied: "Location is off"
        case .locationUnavailable: "Finding your position"
        case .outsideCoverage: "Outside Delhi coverage"
        case .offline: "Offline"
        case .backendError: "Backend unavailable"
        }
    }

    public var detail: String {
        switch self {
        case .backendNotConfigured: "Connect AEROSCOPE in the iPhone app, or switch to Demo."
        case .locationNotDetermined: "Allow location so AEROSCOPE can match you to a city zone."
        case .locationDenied: "Enable location for AEROSCOPE in Settings on your watch."
        case .locationUnavailable: "No position fix yet. Showing the last known zone."
        case .outsideCoverage(let detail): detail
        case .offline: "Showing saved data. Changes will sync when you reconnect."
        case .backendError(let message): message
        }
    }
}

public enum RouteState: Hashable, Sendable {
    case idle
    case loading(alertId: String)
    case loaded(RouteComparison, alertId: String?, offlineEstimate: Bool)
    case noDestination(NeighborSuggestion?, alertId: String)
    case failed(String, alertId: String?)

    public var alertId: String? {
        switch self {
        case .idle: nil
        case .loading(let id): id
        case .loaded(_, let id, _): id
        case .noDestination(_, let id): id
        case .failed(_, let id): id
        }
    }
}
