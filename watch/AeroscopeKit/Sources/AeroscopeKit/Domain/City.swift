import Foundation

public struct GeoPoint: Codable, Hashable, Sendable {
    public var lat: Double
    public var lon: Double

    public init(lat: Double, lon: Double) {
        self.lat = lat
        self.lon = lon
    }
}

/// Position on the 3D city's ground plane (x east, z south), the same space
/// the web dashboard uses for `ZoneBaseline.position`.
public struct WorldPoint: Codable, Hashable, Sendable {
    public var x: Double
    public var z: Double

    public init(x: Double, z: Double) {
        self.x = x
        self.z = z
    }
}

public enum Provenance: String, Codable, Sendable, Hashable {
    case demo
    case verified
}

/// A zone baseline as served by `/api/air-quality/zones` and the AWS
/// `GET /zones` Lambda, plus an optional real-world anchor (`geo`) used to
/// map device locations onto the digital twin.
public struct ZoneBaseline: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var region: String
    public var position: WorldPoint
    public var radius: Double
    public var baseAqi: Double
    public var dominant: Pollutant
    public var trafficShare: Double
    public var baseTemperature: Double
    public var sources: [String]
    public var description: String
    public var geo: GeoPoint?

    public init(
        id: String, name: String, region: String, position: WorldPoint, radius: Double = 14,
        baseAqi: Double, dominant: Pollutant = .pm25, trafficShare: Double = 0.4,
        baseTemperature: Double = 22, sources: [String] = [], description: String = "", geo: GeoPoint? = nil
    ) {
        self.id = id
        self.name = name
        self.region = region
        self.position = position
        self.radius = radius
        self.baseAqi = baseAqi
        self.dominant = dominant
        self.trafficShare = trafficShare
        self.baseTemperature = baseTemperature
        self.sources = sources
        self.description = description
        self.geo = geo
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, region, position, radius, baseAqi, dominant, trafficShare, baseTemperature, sources, description, geo
    }

    /// Mirrors the defaults and validation in the web app's `lib/zone-schema.ts`.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        region = try c.decode(String.self, forKey: .region)
        let pos = try c.decode([Double].self, forKey: .position)
        guard pos.count == 2, pos.allSatisfy(\.isFinite) else {
            throw DecodingError.dataCorruptedError(forKey: .position, in: c, debugDescription: "Zone \(id) has no position")
        }
        position = WorldPoint(x: pos[0], z: pos[1])
        let aqi = try c.decode(Double.self, forKey: .baseAqi)
        guard aqi.isFinite, (0...500).contains(aqi) else {
            throw DecodingError.dataCorruptedError(forKey: .baseAqi, in: c, debugDescription: "Zone \(id) has an invalid AQI")
        }
        baseAqi = aqi
        radius = try c.decodeIfPresent(Double.self, forKey: .radius) ?? 14
        dominant = (try? c.decodeIfPresent(Pollutant.self, forKey: .dominant)) ?? .pm25
        trafficShare = min(1, max(0, try c.decodeIfPresent(Double.self, forKey: .trafficShare) ?? 0.4))
        baseTemperature = try c.decodeIfPresent(Double.self, forKey: .baseTemperature) ?? 22
        sources = try c.decodeIfPresent([String].self, forKey: .sources) ?? []
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        geo = try c.decodeIfPresent(GeoPoint.self, forKey: .geo)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(region, forKey: .region)
        try c.encode([position.x, position.z], forKey: .position)
        try c.encode(radius, forKey: .radius)
        try c.encode(baseAqi, forKey: .baseAqi)
        try c.encode(dominant, forKey: .dominant)
        try c.encode(trafficShare, forKey: .trafficShare)
        try c.encode(baseTemperature, forKey: .baseTemperature)
        try c.encode(sources, forKey: .sources)
        try c.encode(description, forKey: .description)
        try c.encodeIfPresent(geo, forKey: .geo)
    }
}

/// Zone baselines plus the road links used for route comparison.
public struct CityDataset: Codable, Hashable, Sendable {
    public var provenance: Provenance
    public var sourceLabel: String
    /// ISO timestamp of the baseline the dataset represents (kept verbatim).
    public var baselineTime: String
    public var zones: [ZoneBaseline]
    /// Undirected road links between zone ids.
    public var links: [[String]]

    public init(provenance: Provenance, sourceLabel: String, baselineTime: String, zones: [ZoneBaseline], links: [[String]]) {
        self.provenance = provenance
        self.sourceLabel = sourceLabel
        self.baselineTime = baselineTime
        self.zones = zones
        self.links = links
    }

    private enum CodingKeys: String, CodingKey { case provenance, sourceLabel, baselineTime, zones, links }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        // Anything other than an explicit "verified" is treated as demo data.
        provenance = (try? c.decode(Provenance.self, forKey: .provenance)) ?? .demo
        sourceLabel = try c.decodeIfPresent(String.self, forKey: .sourceLabel)
            ?? (provenance == .verified ? "Verified provider" : "Demo dataset")
        baselineTime = try c.decodeIfPresent(String.self, forKey: .baselineTime) ?? "1970-01-01T00:00:00Z"
        zones = try c.decode([ZoneBaseline].self, forKey: .zones)
        guard !zones.isEmpty else {
            throw DecodingError.dataCorruptedError(forKey: .zones, in: c, debugDescription: "Dataset has no zones")
        }
        links = try c.decodeIfPresent([[String]].self, forKey: .links) ?? []
    }

    public func zone(id: String) -> ZoneBaseline? { zones.first { $0.id == id } }

    /// Neighbour ids per zone, ignoring links that reference unknown zones.
    public var adjacency: [String: [String]] {
        let ids = Set(zones.map(\.id))
        var result: [String: [String]] = [:]
        for link in links where link.count == 2 && ids.contains(link[0]) && ids.contains(link[1]) && link[0] != link[1] {
            result[link[0], default: []].append(link[1])
            result[link[1], default: []].append(link[0])
        }
        return result
    }

    /// Fills in geo anchors and links from `reference` for zones that lack
    /// them, e.g. when the backend serves the plain web `ZoneDataset` shape.
    public func enriched(from reference: CityDataset) -> CityDataset {
        var copy = self
        copy.zones = zones.map { zone in
            guard zone.geo == nil, let ref = reference.zone(id: zone.id) else { return zone }
            var z = zone
            z.geo = ref.geo
            return z
        }
        if copy.links.isEmpty { copy.links = reference.links }
        return copy
    }

    /// The Delhi dataset bundled with the app. It is byte-identical to the
    /// backend's copy and its baselines equal the web app's `DEMO_DATASET`.
    public static func bundled() throws -> CityDataset {
        guard let url = Bundle.module.url(forResource: "delhi-zones", withExtension: "json") else {
            throw CocoaError(.fileNoSuchFile)
        }
        return try AeroscopeJSON.decoder().decode(CityDataset.self, from: Data(contentsOf: url))
    }
}
