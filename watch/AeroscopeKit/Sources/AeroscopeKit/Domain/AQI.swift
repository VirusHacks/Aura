import Foundation

/// Indian National AQI categories (CPCB). Raw values match the web app's
/// `AqiCategory` strings so payloads round-trip unchanged.
public enum AQICategory: String, Codable, CaseIterable, Sendable, Comparable {
    case good = "Good"
    case satisfactory = "Satisfactory"
    case moderate = "Moderate"
    case poor = "Poor"
    case veryPoor = "Very Poor"
    case severe = "Severe"

    /// 0 for Good … 5 for Severe.
    public var rank: Int {
        switch self {
        case .good: 0
        case .satisfactory: 1
        case .moderate: 2
        case .poor: 3
        case .veryPoor: 4
        case .severe: 5
        }
    }

    public var band: AQIBand { AQIScale.bands[rank] }
    public var label: String { rawValue }

    public static func < (lhs: AQICategory, rhs: AQICategory) -> Bool { lhs.rank < rhs.rank }
}

public struct AQIBand: Sendable, Hashable {
    public let category: AQICategory
    public let range: ClosedRange<Int>
    /// Fill colour, identical to the web app's band colour.
    public let colorHex: UInt32
    /// Text colour that stays legible on top of `colorHex`.
    public let inkHex: UInt32
    /// Brighter variant for strokes and text on a black watch face.
    public let onDarkHex: UInt32
    public let shortLabel: String
    public let advice: String
}

public enum Pollutant: String, Codable, Sendable, Hashable {
    case pm25 = "PM2.5"
    case pm10 = "PM10"
}

/// Single source of truth for AQI classification on every Apple platform
/// target. Ported from the web app's `lib/aqi.ts`; the parity tests keep the
/// two implementations numerically identical.
public enum AQIScale {
    public static let maximum = 500

    public static let bands: [AQIBand] = [
        AQIBand(category: .good, range: 0...50, colorHex: 0x2F9E44, inkHex: 0xFFFFFF, onDarkHex: 0x51CF66,
                shortLabel: "GOOD", advice: "Minimal impact."),
        AQIBand(category: .satisfactory, range: 51...100, colorHex: 0x94C947, inkHex: 0x1F2A10, onDarkHex: 0xA9E34B,
                shortLabel: "SATIS", advice: "Minor discomfort for sensitive people."),
        AQIBand(category: .moderate, range: 101...200, colorHex: 0xF5C518, inkHex: 0x3A2C00, onDarkHex: 0xFCC419,
                shortLabel: "MOD", advice: "Breathing discomfort for people with lung or heart disease."),
        AQIBand(category: .poor, range: 201...300, colorHex: 0xF08C00, inkHex: 0xFFFFFF, onDarkHex: 0xFF922B,
                shortLabel: "POOR", advice: "Breathing discomfort for most people on prolonged exposure."),
        AQIBand(category: .veryPoor, range: 301...400, colorHex: 0xE03131, inkHex: 0xFFFFFF, onDarkHex: 0xFF6B6B,
                shortLabel: "V.POOR", advice: "Respiratory illness on prolonged exposure."),
        AQIBand(category: .severe, range: 401...500, colorHex: 0x7D1D2F, inkHex: 0xFFFFFF, onDarkHex: 0xF06595,
                shortLabel: "SEVERE", advice: "Affects healthy people; serious impact on those with existing disease."),
    ]

    /// Rounds like JavaScript's `Math.round` and clamps to 0…500.
    /// Non-finite input maps to 0, matching `clampAqi` on the web.
    public static func clamp(_ value: Double) -> Int {
        guard value.isFinite else { return 0 }
        return min(maximum, max(0, Int(jsRound(value))))
    }

    public static func clamp(_ value: Int) -> Int { min(maximum, max(0, value)) }

    public static func band(for aqi: Int) -> AQIBand {
        let v = clamp(aqi)
        return bands.first { v <= $0.range.upperBound } ?? bands[bands.count - 1]
    }

    public static func band(for aqi: Double) -> AQIBand { band(for: clamp(aqi)) }

    public static func category(for aqi: Int) -> AQICategory { band(for: aqi).category }
    public static func category(for aqi: Double) -> AQICategory { band(for: aqi).category }

    /// Matches the web dashboard's "high pollution" KPI (AQI above 200).
    public static func isHighPollution(_ aqi: Int) -> Bool { clamp(aqi) > 200 }

    // MARK: Sub-indices

    private typealias Breakpoint = (cLo: Double, cHi: Double, iLo: Double, iHi: Double)

    private static let pm25Breakpoints: [Breakpoint] = [
        (0, 30, 0, 50), (31, 60, 51, 100), (61, 90, 101, 200),
        (91, 120, 201, 300), (121, 250, 301, 400), (251, 380, 401, 500),
    ]

    private static let pm10Breakpoints: [Breakpoint] = [
        (0, 50, 0, 50), (51, 100, 51, 100), (101, 250, 101, 200),
        (251, 350, 201, 300), (351, 430, 301, 400), (431, 510, 401, 500),
    ]

    private static func breakpoints(_ pollutant: Pollutant) -> [Breakpoint] {
        pollutant == .pm25 ? pm25Breakpoints : pm10Breakpoints
    }

    /// Sub-index for a 24-h concentration in µg/m³ (linear within a band).
    public static func subIndex(_ pollutant: Pollutant, concentration: Double) -> Int {
        let c = max(0, jsRound(concentration))
        for bp in breakpoints(pollutant) where c <= bp.cHi {
            return Int(jsRound(bp.iLo + (bp.iHi - bp.iLo) * (c - bp.cLo) / (bp.cHi - bp.cLo)))
        }
        return maximum
    }

    /// Inverse of `subIndex`: the rounded concentration producing `index`.
    public static func concentration(forIndex index: Int, pollutant: Pollutant) -> Int {
        let bps = breakpoints(pollutant)
        let i = Double(clamp(index))
        for bp in bps where i <= bp.iHi {
            var c = jsRound(bp.cLo + (bp.cHi - bp.cLo) * (i - bp.iLo) / (bp.iHi - bp.iLo))
            // Rounding can land one step low; nudge until the forward mapping agrees.
            while Double(subIndex(pollutant, concentration: c)) < i && c < bp.cHi { c += 1 }
            return Int(c)
        }
        return Int(bps[bps.count - 1].cHi)
    }

    /// Overall AQI is the maximum of the pollutant sub-indices.
    public static func aqi(pm25: Double, pm10: Double) -> Int {
        max(subIndex(.pm25, concentration: pm25), subIndex(.pm10, concentration: pm10))
    }
}

/// JavaScript `Math.round`: nearest integer, ties toward +∞.
@inline(__always)
func jsRound(_ x: Double) -> Double {
    let floor = x.rounded(.down)
    return x - floor >= 0.5 ? floor + 1 : floor
}
