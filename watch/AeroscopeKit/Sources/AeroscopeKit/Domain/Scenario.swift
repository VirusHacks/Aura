import Foundation

public enum ScenarioPresetID: String, Codable, CaseIterable, Sendable, Hashable {
    case clearMorning = "clear-morning"
    case trafficHaze = "traffic-haze"
    case winterStagnation = "winter-stagnation"
    case breezyDispersal = "breezy-dispersal"

    public var preset: ScenarioPreset { ScenarioEngine.preset(self) }
}

public struct ScenarioPreset: Sendable, Hashable {
    public let id: ScenarioPresetID
    public let label: String
    public let summary: String
    public let load: Double
    public let trafficBoost: Double
    public let windSpeed: Double
    public let windFrom: Double
    public let temperatureOffset: Double
}

public struct TimeStep: Sendable, Hashable {
    public let index: Int
    public let hour: Int
    public let label: String
    public let period: String
    public let traffic: Double
    public let mixing: Double
    public let temperatureOffset: Double
    public let windFactor: Double
}

/// The simulated atmosphere the readings are derived for: one of the web
/// app's presets at one of its eight 3-hourly time steps.
public struct Scenario: Codable, Hashable, Sendable {
    public var preset: ScenarioPresetID
    public var timeIndex: Int

    public init(preset: ScenarioPresetID, timeIndex: Int) {
        self.preset = preset
        self.timeIndex = min(max(timeIndex, 0), ScenarioEngine.timeSteps.count - 1)
    }

    /// The scenario the deterministic demo starts in (matches the web app's
    /// initial state: Urban Traffic Haze at 15:00).
    public static let demoDefault = Scenario(preset: .trafficHaze, timeIndex: 3)

    public var step: TimeStep { ScenarioEngine.step(timeIndex) }
    public var label: String { "\(preset.preset.label) · \(step.label)" }

    /// The time step closest to the given wall-clock time in Delhi (IST).
    public static func current(preset: ScenarioPresetID, at date: Date) -> Scenario {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Kolkata") ?? .gmt
        let hour = calendar.component(.hour, from: date)
        let best = ScenarioEngine.timeSteps.min { a, b in
            circularHourDistance(a.hour, hour) < circularHourDistance(b.hour, hour)
        }
        return Scenario(preset: preset, timeIndex: best?.index ?? 0)
    }

    private static func circularHourDistance(_ a: Int, _ b: Int) -> Int {
        let d = abs(a - b) % 24
        return min(d, 24 - d)
    }

    private enum CodingKeys: String, CodingKey { case preset, timeIndex }
}

/// A fully resolved reading for one zone under one scenario. `category` is
/// always derived locally from `aqi` so a payload can never disagree with the
/// app's own classification.
public struct ZoneReading: Codable, Hashable, Sendable, Identifiable {
    public var zoneId: String
    public var zoneName: String
    public var region: String
    public var aqi: Int
    public var pm25: Int?
    public var pm10: Int?
    public var dominant: Pollutant
    public var temperature: Int?
    public var windSpeed: Double?
    /// Simulated scenario time (ISO string) when derived by the scenario model.
    public var scenarioTime: String?
    public var provenance: Provenance
    public var simulated: Bool

    public var id: String { zoneId }
    public var category: AQICategory { AQIScale.category(for: aqi) }

    public init(
        zoneId: String, zoneName: String, region: String, aqi: Int, pm25: Int?, pm10: Int?,
        dominant: Pollutant, temperature: Int?, windSpeed: Double?, scenarioTime: String?,
        provenance: Provenance, simulated: Bool
    ) {
        self.zoneId = zoneId
        self.zoneName = zoneName
        self.region = region
        self.aqi = AQIScale.clamp(aqi)
        self.pm25 = pm25
        self.pm10 = pm10
        self.dominant = dominant
        self.temperature = temperature
        self.windSpeed = windSpeed
        self.scenarioTime = scenarioTime
        self.provenance = provenance
        self.simulated = simulated
    }

    private enum CodingKeys: String, CodingKey {
        case zoneId, zoneName, region, aqi, pm25, pm10, dominant, temperature, windSpeed, scenarioTime, provenance, simulated
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        zoneId = try c.decode(String.self, forKey: .zoneId)
        zoneName = try c.decode(String.self, forKey: .zoneName)
        region = try c.decodeIfPresent(String.self, forKey: .region) ?? ""
        aqi = AQIScale.clamp(try c.decode(Double.self, forKey: .aqi))
        pm25 = try c.decodeIfPresent(Int.self, forKey: .pm25)
        pm10 = try c.decodeIfPresent(Int.self, forKey: .pm10)
        dominant = (try? c.decodeIfPresent(Pollutant.self, forKey: .dominant)) ?? .pm25
        temperature = try c.decodeIfPresent(Int.self, forKey: .temperature)
        windSpeed = try c.decodeIfPresent(Double.self, forKey: .windSpeed)
        scenarioTime = try c.decodeIfPresent(String.self, forKey: .scenarioTime)
        provenance = (try? c.decodeIfPresent(Provenance.self, forKey: .provenance)) ?? .demo
        // Default to simulated: a reading is only "measured" when it says so.
        simulated = try c.decodeIfPresent(Bool.self, forKey: .simulated) ?? true
    }
}

/// Deterministic, illustrative scenario model — a direct port of the web
/// app's `lib/simulation-engine.ts`. It is a teaching model, not a forecast.
public enum ScenarioEngine {
    public static let timeSteps: [TimeStep] = [
        TimeStep(index: 0, hour: 6, label: "06:00", period: "Morning", traffic: 0.7, mixing: 1.2, temperatureOffset: -4, windFactor: 0.7),
        TimeStep(index: 1, hour: 9, label: "09:00", period: "Morning", traffic: 1.25, mixing: 1.08, temperatureOffset: -1, windFactor: 0.9),
        TimeStep(index: 2, hour: 12, label: "12:00", period: "Afternoon", traffic: 0.85, mixing: 0.82, temperatureOffset: 3, windFactor: 1.15),
        TimeStep(index: 3, hour: 15, label: "15:00", period: "Afternoon", traffic: 0.9, mixing: 0.8, temperatureOffset: 4, windFactor: 1.2),
        TimeStep(index: 4, hour: 18, label: "18:00", period: "Evening", traffic: 1.35, mixing: 1.0, temperatureOffset: 1, windFactor: 0.9),
        TimeStep(index: 5, hour: 21, label: "21:00", period: "Evening", traffic: 1.0, mixing: 1.18, temperatureOffset: -2, windFactor: 0.7),
        TimeStep(index: 6, hour: 0, label: "00:00", period: "Night", traffic: 0.45, mixing: 1.28, temperatureOffset: -5, windFactor: 0.6),
        TimeStep(index: 7, hour: 3, label: "03:00", period: "Night", traffic: 0.3, mixing: 1.32, temperatureOffset: -6, windFactor: 0.55),
    ]

    public static let presets: [ScenarioPreset] = [
        ScenarioPreset(id: .clearMorning, label: "Clear Morning",
                       summary: "Post-rain air with steady north-westerlies. Loads well below baseline.",
                       load: 0.42, trafficBoost: 0.9, windSpeed: 3.6, windFrom: 300, temperatureOffset: 2),
        ScenarioPreset(id: .trafficHaze, label: "Urban Traffic Haze",
                       summary: "Typical weekday: baseline loads with traffic share amplified by congestion.",
                       load: 1, trafficBoost: 1.35, windSpeed: 2.2, windFrom: 315, temperatureOffset: 0),
        ScenarioPreset(id: .winterStagnation, label: "Winter Stagnation",
                       summary: "Cold, calm air under a low inversion traps emissions near the ground.",
                       load: 1.38, trafficBoost: 1.1, windSpeed: 0.9, windFrom: 330, temperatureOffset: -6),
        ScenarioPreset(id: .breezyDispersal, label: "Breezy Dispersal",
                       summary: "Strong westerly winds ventilate the city and carry plumes eastward.",
                       load: 0.6, trafficBoost: 1, windSpeed: 6.5, windFrom: 285, temperatureOffset: 1),
    ]

    private static let referenceWind = 2.5
    private static let scenarioDate = "2026-11-14"

    public static func preset(_ id: ScenarioPresetID) -> ScenarioPreset {
        presets.first { $0.id == id } ?? presets[1]
    }

    public static func step(_ index: Int) -> TimeStep {
        timeSteps.indices.contains(index) ? timeSteps[index] : timeSteps[0]
    }

    public static func windSpeed(_ scenario: Scenario) -> Double {
        let raw = scenario.preset.preset.windSpeed * scenario.step.windFactor * 10
        return jsRound(raw) / 10
    }

    /// The multiplier applied to a zone's baseline AQI.
    public static func multiplier(trafficShare: Double, scenario: Scenario) -> Double {
        let step = scenario.step
        let preset = scenario.preset.preset
        let traffic = 1 - trafficShare + trafficShare * step.traffic * preset.trafficBoost
        let dilution = pow(referenceWind / max(0.3, windSpeed(scenario)), 0.35)
        return preset.load * step.mixing * traffic * dilution
    }

    public static func reading(for zone: ZoneBaseline, scenario: Scenario, provenance: Provenance) -> ZoneReading {
        let step = scenario.step
        let preset = scenario.preset.preset
        let aqi = max(12, AQIScale.clamp(zone.baseAqi * multiplier(trafficShare: zone.trafficShare, scenario: scenario)))
        // The dominant pollutant sets the AQI; the other sits at a lower
        // sub-index so AQI = max(sub-indices) stays exactly consistent.
        let secondary = Int(jsRound(Double(aqi) * 0.82))
        let pm25 = AQIScale.concentration(forIndex: zone.dominant == .pm25 ? aqi : secondary, pollutant: .pm25)
        let pm10 = AQIScale.concentration(forIndex: zone.dominant == .pm10 ? aqi : secondary, pollutant: .pm10)
        let temperature = Int(jsRound(zone.baseTemperature + step.temperatureOffset + preset.temperatureOffset))
        let hh = step.hour < 10 ? "0\(step.hour)" : "\(step.hour)"
        return ZoneReading(
            zoneId: zone.id, zoneName: zone.name, region: zone.region, aqi: aqi, pm25: pm25, pm10: pm10,
            dominant: zone.dominant, temperature: temperature, windSpeed: windSpeed(scenario),
            scenarioTime: "\(scenarioDate)T\(hh):00:00+05:30", provenance: provenance,
            // Every reading derived through the scenario model is simulated,
            // even when the baseline came from a verified provider.
            simulated: true
        )
    }

    public static func readings(for dataset: CityDataset, scenario: Scenario) -> [String: ZoneReading] {
        Dictionary(uniqueKeysWithValues: dataset.zones.map {
            ($0.id, reading(for: $0, scenario: scenario, provenance: dataset.provenance))
        })
    }
}
