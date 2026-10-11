import Foundation

public enum Geo {
    public static let earthRadiusKm = 6371.0088

    /// Great-circle distance (haversine).
    public static func distanceKm(_ a: GeoPoint, _ b: GeoPoint) -> Double {
        let toRad = Double.pi / 180
        let dLat = (b.lat - a.lat) * toRad
        let dLon = (b.lon - a.lon) * toRad
        let h = sin(dLat / 2) * sin(dLat / 2)
            + cos(a.lat * toRad) * cos(b.lat * toRad) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * earthRadiusKm * asin(min(1, sqrt(h)))
    }

    public static func interpolate(_ a: GeoPoint, _ b: GeoPoint, fraction t: Double) -> GeoPoint {
        GeoPoint(lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t)
    }
}

/// Least-squares affine map from real coordinates to the schematic 3D city.
/// The city layout is arranged for legibility rather than survey accuracy,
/// so this gives the avatar a plausible position, not a precise one.
public struct CityProjection: Sendable, Hashable {
    private let latMean: Double
    private let lonMean: Double
    private let xCoefficients: [Double]
    private let zCoefficients: [Double]

    public init?(dataset: CityDataset) {
        let anchors = dataset.zones.compactMap { zone in zone.geo.map { ($0, zone.position) } }
        self.init(anchors: anchors)
    }

    public init?(anchors: [(GeoPoint, WorldPoint)]) {
        guard anchors.count >= 3 else { return nil }
        let n = Double(anchors.count)
        let latMean = anchors.map(\.0.lat).reduce(0, +) / n
        let lonMean = anchors.map(\.0.lon).reduce(0, +) / n
        self.latMean = latMean
        self.lonMean = lonMean
        // Centred design matrix rows [1, dLat, dLon] keep the normal equations well conditioned.
        let rows = anchors.map { [1, $0.0.lat - latMean, $0.0.lon - lonMean] }
        guard let x = Self.solveLeastSquares(rows: rows, targets: anchors.map(\.1.x)),
              let z = Self.solveLeastSquares(rows: rows, targets: anchors.map(\.1.z)) else { return nil }
        xCoefficients = x
        zCoefficients = z
    }

    public func world(for point: GeoPoint) -> WorldPoint {
        let row = [1, point.lat - latMean, point.lon - lonMean]
        let x = zip(row, xCoefficients).map(*).reduce(0, +)
        let z = zip(row, zCoefficients).map(*).reduce(0, +)
        return WorldPoint(x: (x * 10).rounded() / 10, z: (z * 10).rounded() / 10)
    }

    private static func solveLeastSquares(rows: [[Double]], targets: [Double]) -> [Double]? {
        var ata = Array(repeating: Array(repeating: 0.0, count: 3), count: 3)
        var atb = Array(repeating: 0.0, count: 3)
        for (row, target) in zip(rows, targets) {
            for i in 0..<3 {
                atb[i] += row[i] * target
                for j in 0..<3 { ata[i][j] += row[i] * row[j] }
            }
        }
        return solve3x3(ata, atb)
    }

    /// Gaussian elimination with partial pivoting.
    private static func solve3x3(_ a: [[Double]], _ b: [Double]) -> [Double]? {
        var m = a
        var v = b
        for col in 0..<3 {
            guard let pivot = (col..<3).max(by: { abs(m[$0][col]) < abs(m[$1][col]) }), abs(m[pivot][col]) > 1e-12 else {
                return nil
            }
            m.swapAt(col, pivot)
            v.swapAt(col, pivot)
            for r in (col + 1)..<3 {
                let f = m[r][col] / m[col][col]
                for c in col..<3 { m[r][c] -= f * m[col][c] }
                v[r] -= f * v[col]
            }
        }
        var x = Array(repeating: 0.0, count: 3)
        for r in stride(from: 2, through: 0, by: -1) {
            var s = v[r]
            for c in (r + 1)..<3 { s -= m[r][c] * x[c] }
            x[r] = s / m[r][r]
        }
        return x
    }
}

public struct ZoneMatch: Codable, Hashable, Sendable {
    public var zoneId: String
    public var zoneName: String
    public var distanceKm: Double
    public var world: WorldPoint?

    public init(zoneId: String, zoneName: String, distanceKm: Double, world: WorldPoint?) {
        self.zoneId = zoneId
        self.zoneName = zoneName
        self.distanceKm = distanceKm
        self.world = world
    }
}

public enum LocateResult: Hashable, Sendable {
    case inside(ZoneMatch)
    /// The point is further than the coverage radius from every zone anchor.
    case outsideCoverage(nearestZoneName: String?, distanceKm: Double?)
}

/// Associates a coordinate with the nearest digital-twin zone.
public struct ZoneLocator: Sendable {
    /// Beyond this distance from every zone anchor a point is outside AEROSCOPE's Delhi coverage.
    public static let coverageRadiusKm = 5.0

    private let anchored: [(zone: ZoneBaseline, geo: GeoPoint)]
    private let projection: CityProjection?

    public init(dataset: CityDataset) {
        anchored = dataset.zones.compactMap { zone in zone.geo.map { (zone, $0) } }
        projection = CityProjection(dataset: dataset)
    }

    public var hasAnchors: Bool { !anchored.isEmpty }

    public func locate(_ point: GeoPoint) -> LocateResult {
        let nearest = anchored
            .map { (zone: $0.zone, km: Geo.distanceKm(point, $0.geo)) }
            .min { $0.km < $1.km }
        guard let nearest else { return .outsideCoverage(nearestZoneName: nil, distanceKm: nil) }
        guard nearest.km <= Self.coverageRadiusKm else {
            return .outsideCoverage(nearestZoneName: nearest.zone.name, distanceKm: nearest.km)
        }
        return .inside(ZoneMatch(
            zoneId: nearest.zone.id, zoneName: nearest.zone.name, distanceKm: nearest.km,
            world: projection?.world(for: point)
        ))
    }

    public func world(for point: GeoPoint) -> WorldPoint? { projection?.world(for: point) }
}
