import Foundation

/// A position reported for a trip: a real fix, or a simulated point during a demo.
public struct LocationPayload: Codable, Hashable, Sendable {
    public var geo: GeoPoint?
    /// Zone resolved on the device, when it could resolve one.
    public var zoneId: String?
    /// Avatar position in the 3D city for the web dashboard.
    public var world: WorldPoint?
    public var accuracyMeters: Double?
    public var simulated: Bool

    public init(geo: GeoPoint?, zoneId: String?, world: WorldPoint?, accuracyMeters: Double?, simulated: Bool) {
        self.geo = geo
        self.zoneId = zoneId
        self.world = world
        self.accuracyMeters = accuracyMeters
        self.simulated = simulated
    }
}

/// The outcome of evaluating one position: the zone reading, the next zone on
/// the route and, when the rules fire, a new alert.
public struct Evaluation: Codable, Hashable, Sendable {
    public var reading: ZoneReading
    public var match: ZoneMatch
    public var upcoming: ZoneReading?
    public var alert: PollutionAlert?
    public var suppression: SuppressionReason?
    public var scenario: Scenario?
    /// When the data behind `reading` was produced.
    public var dataAsOf: Date

    public init(reading: ZoneReading, match: ZoneMatch, upcoming: ZoneReading?, alert: PollutionAlert?,
                suppression: SuppressionReason?, scenario: Scenario?, dataAsOf: Date) {
        self.reading = reading
        self.match = match
        self.upcoming = upcoming
        self.alert = alert
        self.suppression = suppression
        self.scenario = scenario
        self.dataAsOf = dataAsOf
    }
}

public enum EvaluationError: Error, Hashable, Sendable {
    case outsideCoverage(nearestZoneName: String?, distanceKm: Double?)
    case unknownZone(String)
    case noPosition
}

/// Shared evaluation pipeline for the demo provider and the watch's offline
/// fallback. The backend runs the same steps in `engine.mjs`.
public enum TripEvaluator {
    public static func resolve(_ location: LocationPayload, in dataset: CityDataset) -> Result<ZoneMatch, EvaluationError> {
        let locator = ZoneLocator(dataset: dataset)
        if let geo = location.geo {
            switch locator.locate(geo) {
            case .inside(let match): return .success(match)
            case .outsideCoverage(let name, let km):
                // A device-resolved zone wins over an out-of-coverage geo only for simulated points.
                if !location.simulated || location.zoneId == nil { return .failure(.outsideCoverage(nearestZoneName: name, distanceKm: km)) }
            }
        }
        guard let zoneId = location.zoneId else { return .failure(.noPosition) }
        guard let zone = dataset.zone(id: zoneId) else { return .failure(.unknownZone(zoneId)) }
        return .success(ZoneMatch(zoneId: zone.id, zoneName: zone.name, distanceKm: 0, world: location.world ?? zone.position))
    }

    public static func evaluate(
        location: LocationPayload, dataset: CityDataset, scenario: Scenario, dataAsOf: Date,
        preferences: AlertPreferences, tripId: String?, tripPhase: TripPhase?, plannedZoneIds: [String],
        history: [AlertHistoryEntry], origin: AlertOrigin, now: Date, newAlertId: () -> String = { UUID().uuidString }
    ) -> Result<Evaluation, EvaluationError> {
        let match: ZoneMatch
        switch resolve(location, in: dataset) {
        case .success(let m): match = m
        case .failure(let e): return .failure(e)
        }
        guard let zone = dataset.zone(id: match.zoneId) else { return .failure(.unknownZone(match.zoneId)) }
        let reading = ScenarioEngine.reading(for: zone, scenario: scenario, provenance: dataset.provenance)
        let upcoming = nextZone(after: zone.id, in: plannedZoneIds)
            .flatMap { dataset.zone(id: $0) }
            .map { ScenarioEngine.reading(for: $0, scenario: scenario, provenance: dataset.provenance) }

        let decision = AlertEvaluator.evaluate(
            AlertContext(reading: reading, dataAsOf: dataAsOf, upcoming: upcoming, tripPhase: tripPhase,
                         history: history, now: now),
            preferences: preferences
        )
        var alert: PollutionAlert?
        var suppression: SuppressionReason?
        switch decision {
        case .raise(let kind, let target):
            alert = PollutionAlert(
                id: newAlertId(), tripId: tripId, zoneId: target.zoneId, zoneName: target.zoneName, aqi: target.aqi,
                pm25: target.pm25, kind: kind, origin: origin, createdAt: now, scenarioLabel: scenario.label,
                simulated: target.simulated
            )
        case .suppress(let reason):
            suppression = reason
        }
        return .success(Evaluation(reading: reading, match: match, upcoming: upcoming, alert: alert,
                                   suppression: suppression, scenario: scenario, dataAsOf: dataAsOf))
    }

    public static func nextZone(after zoneId: String, in planned: [String]) -> String? {
        guard let i = planned.firstIndex(of: zoneId), i + 1 < planned.count else { return nil }
        return planned[i + 1]
    }
}
