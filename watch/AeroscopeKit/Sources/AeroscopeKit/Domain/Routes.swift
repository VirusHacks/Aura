import Foundation

public enum TravelMode: String, Codable, CaseIterable, Sendable, Hashable {
    case walk
    case cycle
    case motor

    public var speedKmh: Double {
        switch self {
        case .walk: 4.8
        case .cycle: 14
        case .motor: 20
        }
    }

    public var label: String {
        switch self {
        case .walk: "Walk"
        case .cycle: "Cycle"
        case .motor: "Auto / car"
        }
    }

    public var symbolName: String {
        switch self {
        case .walk: "figure.walk"
        case .cycle: "bicycle"
        case .motor: "car.fill"
        }
    }
}

public enum RouteKind: String, Codable, Sendable, Hashable {
    case fastest
    case cleaner
    case planned
}

public struct RouteOption: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var kind: RouteKind
    public var zoneIds: [String]
    public var zoneNames: [String]
    public var distanceKm: Double
    public var durationMinutes: Int
    /// Distance-weighted mean AQI along the route.
    public var averageAqi: Int
    public var peakAqi: Int
    public var peakZoneName: String
    /// Σ segment km × mean segment AQI — the quantity the cleaner route minimises.
    public var exposureIndex: Double

    public var averageCategory: AQICategory { AQIScale.category(for: averageAqi) }
    public var peakCategory: AQICategory { AQIScale.category(for: peakAqi) }

    /// Names of the zones between origin and destination.
    public var viaNames: [String] { zoneNames.count > 2 ? Array(zoneNames.dropFirst().dropLast()) : [] }
}

public enum RouteChoice: String, Codable, Sendable, Hashable {
    case alternative
    case current
}

public struct RouteComparison: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var fromZoneId: String
    public var toZoneId: String
    public var mode: TravelMode
    public var current: RouteOption
    /// Nil when no route is meaningfully cleaner than `current`.
    public var alternative: RouteOption?
    public var exposureReductionPercent: Int?
    public var extraMinutes: Int?
    public var note: String
    public var generatedAt: Date
    public var scenarioLabel: String?
}

/// Points the user at a cleaner neighbouring zone when no destination is set.
public struct NeighborSuggestion: Codable, Hashable, Sendable {
    public var zoneId: String
    public var zoneName: String
    public var aqi: Int
    public var distanceKm: Double
    public var minutes: Int
}

/// Route comparison over the zone road graph. Distances use the zones' real
/// anchors with a road factor; AQI comes from the readings passed in.
public struct RoutePlanner: Sendable {
    /// Typical ratio of road distance to straight-line distance in Delhi.
    public static let roadFactor = 1.3
    /// An alternative must cut exposure by at least this much to be offered.
    public static let minimumReductionPercent = 10

    private let zonesById: [String: ZoneBaseline]
    private let adjacency: [String: [String]]
    private let aqiByZone: [String: Int]

    public init(dataset: CityDataset, aqiByZone: [String: Int]) {
        zonesById = Dictionary(uniqueKeysWithValues: dataset.zones.map { ($0.id, $0) })
        adjacency = dataset.adjacency
        self.aqiByZone = aqiByZone
    }

    public init(dataset: CityDataset, readings: [String: ZoneReading]) {
        self.init(dataset: dataset, aqiByZone: readings.mapValues(\.aqi))
    }

    public func segmentKm(_ a: String, _ b: String) -> Double? {
        guard let ga = zonesById[a]?.geo, let gb = zonesById[b]?.geo else { return nil }
        return Geo.distanceKm(ga, gb) * Self.roadFactor
    }

    private func segmentExposure(_ a: String, _ b: String) -> Double? {
        guard let km = segmentKm(a, b), let qa = aqiByZone[a], let qb = aqiByZone[b] else { return nil }
        return km * Double(qa + qb) / 2
    }

    /// Dijkstra over the zone graph; ties break on zone id for determinism.
    public func path(from start: String, to goal: String, kind: RouteKind) -> [String]? {
        guard zonesById[start] != nil, zonesById[goal] != nil else { return nil }
        if start == goal { return [start] }
        var dist: [String: Double] = [start: 0]
        var previous: [String: String] = [:]
        var visited = Set<String>()
        while true {
            let candidates = dist.filter { !visited.contains($0.key) }
            guard let current = candidates.min(by: { $0.value != $1.value ? $0.value < $1.value : $0.key < $1.key }) else {
                return nil
            }
            if current.key == goal { break }
            visited.insert(current.key)
            for next in adjacency[current.key, default: []].sorted() where !visited.contains(next) {
                let weight = kind == .cleaner ? segmentExposure(current.key, next) : segmentKm(current.key, next)
                guard let weight else { continue }
                let candidate = current.value + weight
                if candidate < dist[next, default: .infinity] {
                    dist[next] = candidate
                    previous[next] = current.key
                }
            }
        }
        var result = [goal]
        while let p = previous[result[0]] { result.insert(p, at: 0) }
        return result.first == start ? result : nil
    }

    /// Describes an explicit zone sequence. Nil if any hop is not a road link.
    public func option(for zoneIds: [String], kind: RouteKind, mode: TravelMode) -> RouteOption? {
        guard let first = zoneIds.first, let firstZone = zonesById[first], let firstAqi = aqiByZone[first] else { return nil }
        var km = 0.0
        var exposure = 0.0
        var peak = (aqi: firstAqi, name: firstZone.name)
        for (a, b) in zip(zoneIds, zoneIds.dropFirst()) {
            guard adjacency[a, default: []].contains(b), let segment = segmentKm(a, b),
                  let e = segmentExposure(a, b), let zone = zonesById[b], let q = aqiByZone[b] else { return nil }
            km += segment
            exposure += e
            if q > peak.aqi { peak = (q, zone.name) }
        }
        let average = km > 0 ? Int(jsRound(exposure / km)) : firstAqi
        return RouteOption(
            id: "\(kind.rawValue):\(zoneIds.joined(separator: ">"))",
            kind: kind,
            zoneIds: zoneIds,
            zoneNames: zoneIds.compactMap { zonesById[$0]?.name },
            distanceKm: (km * 10).rounded() / 10,
            durationMinutes: max(1, Int((km / mode.speedKmh * 60).rounded())),
            averageAqi: average,
            peakAqi: peak.aqi,
            peakZoneName: peak.name,
            exposureIndex: exposure.rounded()
        )
    }

    public func route(from start: String, to goal: String, kind: RouteKind, mode: TravelMode) -> RouteOption? {
        path(from: start, to: goal, kind: kind).flatMap { option(for: $0, kind: kind, mode: mode) }
    }

    /// Compares the route the user is on (the remainder of `plannedZoneIds`
    /// from `start`, or the fastest route) with the lowest-exposure route.
    public func compare(
        from start: String, to goal: String, mode: TravelMode,
        plannedZoneIds: [String] = [], scenarioLabel: String? = nil, now: Date
    ) -> RouteComparison? {
        let remainder: [String]? = plannedZoneIds.firstIndex(of: start).map { Array(plannedZoneIds[$0...]) }
        let current = remainder.flatMap { $0.last == goal ? option(for: $0, kind: .planned, mode: mode) : nil }
            ?? route(from: start, to: goal, kind: .fastest, mode: mode)
        guard let current else { return nil }
        let cleaner = route(from: start, to: goal, kind: .cleaner, mode: mode)

        var alternative: RouteOption?
        var reduction: Int?
        var note: String
        if let cleaner, cleaner.zoneIds != current.zoneIds, current.exposureIndex > 0 {
            let percent = Int(((current.exposureIndex - cleaner.exposureIndex) / current.exposureIndex * 100).rounded())
            if percent >= Self.minimumReductionPercent {
                alternative = cleaner
                reduction = percent
                let via = cleaner.viaNames.isEmpty ? "" : " via \(cleaner.viaNames.joined(separator: ", "))"
                note = "Cleaner route\(via) cuts exposure by \(percent)%."
            } else {
                note = "Alternatives are less than \(Self.minimumReductionPercent)% cleaner. Stay on your route."
            }
        } else {
            note = start == goal ? "You have arrived." : "Your route is already the cleanest available."
        }
        return RouteComparison(
            id: "cmp:\(start)>\(goal):\(Int(now.timeIntervalSince1970))",
            fromZoneId: start,
            toZoneId: goal,
            mode: mode,
            current: current,
            alternative: alternative,
            exposureReductionPercent: reduction,
            extraMinutes: alternative.map { $0.durationMinutes - current.durationMinutes },
            note: note,
            generatedAt: now,
            scenarioLabel: scenarioLabel
        )
    }

    /// The adjacent zone with the lowest AQI, if it is cleaner than `zoneId`.
    public func cleanerNeighbor(of zoneId: String, mode: TravelMode) -> NeighborSuggestion? {
        guard let here = aqiByZone[zoneId] else { return nil }
        let best = adjacency[zoneId, default: []]
            .compactMap { id -> (String, Int, Double)? in
                guard let q = aqiByZone[id], let km = segmentKm(zoneId, id) else { return nil }
                return (id, q, km)
            }
            .min { $0.1 != $1.1 ? $0.1 < $1.1 : $0.0 < $1.0 }
        guard let best, best.1 < here, let zone = zonesById[best.0] else { return nil }
        return NeighborSuggestion(
            zoneId: best.0, zoneName: zone.name, aqi: best.1,
            distanceKm: (best.2 * 10).rounded() / 10,
            minutes: max(1, Int((best.2 / mode.speedKmh * 60).rounded()))
        )
    }
}
