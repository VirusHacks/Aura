import Foundation

/// A deterministic simulated position track along a zone route, used by demo
/// mode. The same route and step index always give the same point, so a demo
/// replays identically on every run.
public struct DemoJourney: Codable, Hashable, Sendable {
    /// Default demo: Lodhi Garden → Red Fort Precinct. Under the default
    /// scenario the fastest route passes Poor-air zones and a cleaner route
    /// via Yamuna Riverfront exists, which exercises the full alert flow.
    public static let defaultOriginZoneId = "z-lg"
    public static let defaultDestinationZoneId = "z-rf"
    public static let substepsPerSegment = 3

    public private(set) var zoneIds: [String]
    public private(set) var waypoints: [GeoPoint]
    public private(set) var index: Int

    public init(zoneIds: [String], dataset: CityDataset, substeps: Int = DemoJourney.substepsPerSegment) {
        let anchors = zoneIds.compactMap { dataset.zone(id: $0)?.geo }
        var points: [GeoPoint] = []
        for (a, b) in zip(anchors, anchors.dropFirst()) {
            for s in 0..<max(1, substeps) {
                points.append(Geo.interpolate(a, b, fraction: Double(s) / Double(max(1, substeps))))
            }
        }
        if let last = anchors.last { points.append(last) }
        self.zoneIds = zoneIds
        self.waypoints = points
        self.index = 0
    }

    public var current: GeoPoint? { waypoints.indices.contains(index) ? waypoints[index] : nil }
    public var isFinished: Bool { index >= waypoints.count - 1 }
    public var progress: Double { waypoints.count > 1 ? Double(index) / Double(waypoints.count - 1) : 1 }

    @discardableResult
    public mutating func advance() -> GeoPoint? {
        guard !isFinished else { return current }
        index += 1
        return current
    }

    /// Restarts along a new zone sequence from the current position, so an
    /// accepted reroute continues smoothly instead of jumping.
    public mutating func reroute(zoneIds newZoneIds: [String], dataset: CityDataset) {
        guard let here = current else { return }
        var next = DemoJourney(zoneIds: newZoneIds, dataset: dataset)
        if let first = next.waypoints.first, Geo.distanceKm(first, here) > 0.05 {
            next.waypoints.insert(here, at: 0)
        }
        self = next
    }
}
