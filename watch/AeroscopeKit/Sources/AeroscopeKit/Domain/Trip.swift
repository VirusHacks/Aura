import Foundation

public enum DataSourceMode: String, Codable, CaseIterable, Sendable, Hashable {
    case live
    case demo

    public var label: String { self == .live ? "Live" : "Demo" }
}

public enum TripPhase: String, Codable, Sendable, Hashable {
    case active
    case paused
    case ended
}

public enum TripError: Error, Equatable, Sendable {
    case invalidTransition(from: TripPhase, action: String)
}

public struct TripSample: Codable, Hashable, Sendable {
    public var at: Date
    public var zoneId: String
    public var zoneName: String
    public var aqi: Int
    public var geo: GeoPoint?
    public var world: WorldPoint?
    public var simulated: Bool

    public init(at: Date, zoneId: String, zoneName: String, aqi: Int, geo: GeoPoint?, world: WorldPoint?, simulated: Bool) {
        self.at = at
        self.zoneId = zoneId
        self.zoneName = zoneName
        self.aqi = aqi
        self.geo = geo
        self.world = world
        self.simulated = simulated
    }
}

/// Time-weighted exposure: each sample's AQI applies until the next sample,
/// counting only time while the trip is active.
public struct ExposureSummary: Codable, Hashable, Sendable {
    public var aqiSeconds: Double = 0
    public var exposedSeconds: Double = 0
    public var peakAqi: Int = 0
    public var peakZoneName: String?
    public var secondsAtOrAbovePoor: Double = 0

    public init() {}

    public var averageAqi: Int? {
        exposedSeconds > 0 ? Int(jsRound(aqiSeconds / exposedSeconds)) : nil
    }
}

public struct Trip: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var source: DataSourceMode
    public var mode: TravelMode
    public var startedAt: Date
    public var endedAt: Date?
    public var phase: TripPhase
    public var originZoneId: String?
    public var destinationZoneId: String?
    public var destinationName: String?
    /// Zone sequence the user is following; replaced when a reroute is accepted.
    public var plannedZoneIds: [String]
    public var zonesVisited: [String]
    public var lastSample: TripSample?
    public var sampleCount: Int
    public var alertIds: [String]
    public var exposure: ExposureSummary
    public var rerouteCount: Int
    /// True when the position is simulated (chosen start zone, or walked on the
    /// web dashboard): the watch follows the backend instead of its own GPS.
    public var simulatedPosition: Bool?

    private var accumulatedActiveSeconds: Double
    private var lastResumedAt: Date?
    private var lastAccrualAt: Date?

    public static func start(
        id: String = UUID().uuidString, at: Date, source: DataSourceMode, mode: TravelMode,
        originZoneId: String?, destinationZoneId: String?, destinationName: String?, plannedZoneIds: [String],
        simulatedPosition: Bool = false
    ) -> Trip {
        Trip(
            id: id, source: source, mode: mode, startedAt: at, endedAt: nil, phase: .active,
            originZoneId: originZoneId, destinationZoneId: destinationZoneId, destinationName: destinationName,
            plannedZoneIds: plannedZoneIds, zonesVisited: [], lastSample: nil, sampleCount: 0, alertIds: [],
            exposure: ExposureSummary(), rerouteCount: 0, simulatedPosition: simulatedPosition,
            accumulatedActiveSeconds: 0, lastResumedAt: at, lastAccrualAt: at
        )
    }

    /// A trip started on another device (e.g. the web dashboard), as the backend reports it.
    public static func adopting(_ status: TripStatusResponse, destinationName: String?, now: Date) -> Trip {
        var trip = Trip.start(
            id: status.tripId, at: status.startedAt ?? now, source: .live, mode: status.mode ?? .walk,
            originZoneId: status.originZoneId, destinationZoneId: status.destinationZoneId, destinationName: destinationName,
            plannedZoneIds: status.plannedZoneIds, simulatedPosition: status.isDemo ?? status.currentLocation?.simulated ?? true
        )
        if status.phase == .paused { try? trip.pause(at: now) }
        return trip
    }

    public var followsBackendPosition: Bool { simulatedPosition == true }

    public var isOngoing: Bool { phase != .ended }

    public func activeDuration(at now: Date) -> TimeInterval {
        guard phase == .active, let resumed = lastResumedAt else { return accumulatedActiveSeconds }
        return accumulatedActiveSeconds + max(0, now.timeIntervalSince(resumed))
    }

    /// The zone after the current one on the planned route.
    public var nextPlannedZoneId: String? {
        guard let current = lastSample?.zoneId, let i = plannedZoneIds.firstIndex(of: current),
              i + 1 < plannedZoneIds.count else { return nil }
        return plannedZoneIds[i + 1]
    }

    public var hasArrived: Bool {
        guard let destination = destinationZoneId else { return false }
        return lastSample?.zoneId == destination
    }

    public mutating func pause(at time: Date) throws {
        guard phase == .active else { throw TripError.invalidTransition(from: phase, action: "pause") }
        accrue(until: time)
        accumulatedActiveSeconds += max(0, time.timeIntervalSince(lastResumedAt ?? time))
        lastResumedAt = nil
        phase = .paused
    }

    public mutating func resume(at time: Date) throws {
        guard phase == .paused else { throw TripError.invalidTransition(from: phase, action: "resume") }
        lastResumedAt = time
        lastAccrualAt = time
        phase = .active
    }

    public mutating func end(at time: Date) throws {
        guard phase != .ended else { throw TripError.invalidTransition(from: phase, action: "end") }
        if phase == .active {
            accrue(until: time)
            accumulatedActiveSeconds += max(0, time.timeIntervalSince(lastResumedAt ?? time))
        }
        lastResumedAt = nil
        endedAt = time
        phase = .ended
    }

    /// Records a location sample. While paused the position updates but no
    /// exposure accrues; an ended trip rejects samples.
    public mutating func record(_ sample: TripSample) throws {
        guard phase != .ended else { throw TripError.invalidTransition(from: phase, action: "record") }
        if phase == .active { accrue(until: sample.at) }
        lastSample = sample
        lastAccrualAt = sample.at
        sampleCount += 1
        if zonesVisited.last != sample.zoneId { zonesVisited.append(sample.zoneId) }
        if sample.aqi > exposure.peakAqi {
            exposure.peakAqi = sample.aqi
            exposure.peakZoneName = sample.zoneName
        }
    }

    public mutating func replan(zoneIds: [String]) {
        guard !zoneIds.isEmpty else { return }
        plannedZoneIds = zoneIds
        rerouteCount += 1
    }

    public mutating func attach(alertId: String) {
        if !alertIds.contains(alertId) { alertIds.append(alertId) }
    }

    private mutating func accrue(until time: Date) {
        guard let last = lastSample, let from = lastAccrualAt else {
            lastAccrualAt = time
            return
        }
        let seconds = max(0, time.timeIntervalSince(from))
        exposure.aqiSeconds += Double(last.aqi) * seconds
        exposure.exposedSeconds += seconds
        if last.aqi >= AQICategory.poor.band.range.lowerBound { exposure.secondsAtOrAbovePoor += seconds }
        lastAccrualAt = time
    }
}

/// A compact record of a finished trip for history lists.
public struct TripSummary: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var source: DataSourceMode
    public var startedAt: Date
    public var endedAt: Date
    public var activeSeconds: Double
    public var averageAqi: Int?
    public var peakAqi: Int
    public var peakZoneName: String?
    public var zonesVisited: Int
    public var alertCount: Int
    public var rerouteCount: Int
    public var destinationName: String?

    public init(trip: Trip, endedAt: Date) {
        id = trip.id
        source = trip.source
        startedAt = trip.startedAt
        self.endedAt = endedAt
        activeSeconds = trip.activeDuration(at: endedAt)
        averageAqi = trip.exposure.averageAqi
        peakAqi = trip.exposure.peakAqi
        peakZoneName = trip.exposure.peakZoneName
        zonesVisited = trip.zonesVisited.count
        alertCount = trip.alertIds.count
        rerouteCount = trip.rerouteCount
        destinationName = trip.destinationName
    }
}
