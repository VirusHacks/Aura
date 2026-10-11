import Foundation

public struct AlertPreferences: Codable, Hashable, Sendable {
    public var alertsEnabled: Bool
    /// Alert when a zone reaches this category or worse.
    public var threshold: AQICategory
    /// Minimum gap between alerts unless the air gets worse.
    public var cooldownMinutes: Int
    public var onlyDuringTrips: Bool
    /// Lowers the threshold by one category (children, elderly, asthma, heart disease).
    public var sensitiveGroup: Bool
    /// Warn about the next zone on the planned route, not just the current one.
    public var lookAhead: Bool
    public var travelMode: TravelMode
    /// Readings older than this never trigger an alert.
    public var staleAfterMinutes: Int
    public var updatedAt: Date

    public init(
        alertsEnabled: Bool = true, threshold: AQICategory = .poor, cooldownMinutes: Int = 15,
        onlyDuringTrips: Bool = true, sensitiveGroup: Bool = false, lookAhead: Bool = true,
        travelMode: TravelMode = .walk, staleAfterMinutes: Int = 30, updatedAt: Date = Date(timeIntervalSince1970: 0)
    ) {
        self.alertsEnabled = alertsEnabled
        self.threshold = threshold
        self.cooldownMinutes = cooldownMinutes
        self.onlyDuringTrips = onlyDuringTrips
        self.sensitiveGroup = sensitiveGroup
        self.lookAhead = lookAhead
        self.travelMode = travelMode
        self.staleAfterMinutes = staleAfterMinutes
        self.updatedAt = updatedAt
    }

    public static let `default` = AlertPreferences()

    /// Categories a user can pick as their alert threshold.
    public static let thresholdChoices: [AQICategory] = [.satisfactory, .moderate, .poor, .veryPoor, .severe]

    public var effectiveThreshold: AQICategory {
        guard sensitiveGroup, threshold.rank > 1 else { return threshold }
        return AQICategory.allCases[threshold.rank - 1]
    }

    public var effectiveThresholdAQI: Int { effectiveThreshold.band.range.lowerBound }
}

public enum AlertKind: String, Codable, Sendable, Hashable {
    case enteredZone = "entered-zone"
    case escalation
    case upcoming = "upcoming-zone"
}

public enum AlertOrigin: String, Codable, Sendable, Hashable {
    /// Evaluated by the AEROSCOPE backend (authoritative when online).
    case backend
    /// Evaluated on the watch from cached data while offline.
    case device
    /// Evaluated by the deterministic demo provider.
    case demo
}

public enum AlertStatus: String, Codable, Sendable, Hashable {
    case active
    case acknowledged
    case dismissed
    case rerouteRequested = "reroute-requested"
    case rerouted
}

public struct PollutionAlert: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var tripId: String?
    public var zoneId: String
    public var zoneName: String
    public var aqi: Int
    public var pm25: Int?
    public var kind: AlertKind
    public var origin: AlertOrigin
    public var status: AlertStatus
    public var createdAt: Date
    public var updatedAt: Date?
    public var scenarioLabel: String?
    public var simulated: Bool

    public init(
        id: String, tripId: String?, zoneId: String, zoneName: String, aqi: Int, pm25: Int?,
        kind: AlertKind, origin: AlertOrigin, status: AlertStatus = .active, createdAt: Date,
        updatedAt: Date? = nil, scenarioLabel: String?, simulated: Bool
    ) {
        self.id = id
        self.tripId = tripId
        self.zoneId = zoneId
        self.zoneName = zoneName
        self.aqi = AQIScale.clamp(aqi)
        self.pm25 = pm25
        self.kind = kind
        self.origin = origin
        self.status = status
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.scenarioLabel = scenarioLabel
        self.simulated = simulated
    }

    public var category: AQICategory { AQIScale.category(for: aqi) }

    public var title: String {
        switch kind {
        case .enteredZone: "\(category.label) air here"
        case .escalation: "Air got worse"
        case .upcoming: "\(category.label) air ahead"
        }
    }

    public var message: String {
        switch kind {
        case .upcoming: "\(zoneName) is next on your route · AQI \(aqi)"
        case .enteredZone, .escalation: "\(zoneName) · AQI \(aqi) · \(category.label)"
        }
    }

    public var advice: String { category.band.advice }

    public var isOpen: Bool { status == .active || status == .rerouteRequested }

    public var historyEntry: AlertHistoryEntry {
        AlertHistoryEntry(zoneId: zoneId, category: category, kind: kind, createdAt: createdAt)
    }
}

public struct AlertHistoryEntry: Codable, Hashable, Sendable {
    public var zoneId: String
    public var category: AQICategory
    public var kind: AlertKind
    public var createdAt: Date

    public init(zoneId: String, category: AQICategory, kind: AlertKind, createdAt: Date) {
        self.zoneId = zoneId
        self.category = category
        self.kind = kind
        self.createdAt = createdAt
    }
}

public enum SuppressionReason: String, Codable, Sendable, Hashable {
    case disabled
    case noActiveTrip = "no-active-trip"
    case staleData = "stale-data"
    case belowThreshold = "below-threshold"
    case alreadyWarned = "already-warned"
    case coolingDown = "cooling-down"
}

public enum AlertDecision: Hashable, Sendable {
    case raise(kind: AlertKind, reading: ZoneReading)
    case suppress(SuppressionReason)
}

public struct AlertContext: Sendable {
    public var reading: ZoneReading
    /// When the reading's underlying data was produced.
    public var dataAsOf: Date
    /// The next zone on the planned route, if any.
    public var upcoming: ZoneReading?
    public var tripPhase: TripPhase?
    /// Earlier alerts in scope: the current trip's, or recent ones outside a trip.
    public var history: [AlertHistoryEntry]
    public var now: Date

    public init(reading: ZoneReading, dataAsOf: Date, upcoming: ZoneReading?, tripPhase: TripPhase?,
                history: [AlertHistoryEntry], now: Date) {
        self.reading = reading
        self.dataAsOf = dataAsOf
        self.upcoming = upcoming
        self.tripPhase = tripPhase
        self.history = history
        self.now = now
    }
}

/// The alert rules. The backend's `engine.mjs` implements the same rules;
/// both are tested against the same cases.
///
/// 1. Disabled → nothing. `onlyDuringTrips` requires an active (not paused) trip.
/// 2. Stale data never alerts.
/// 3. A zone at or above the (sensitivity-adjusted) threshold alerts once per
///    trip per category; a worse category for the same zone alerts again.
/// 4. A cooldown separates alerts unless the category is worse than the most
///    recent alert (escalation).
/// 5. With look-ahead, the next planned zone is checked the same way.
public enum AlertEvaluator {
    public static func evaluate(_ context: AlertContext, preferences: AlertPreferences) -> AlertDecision {
        guard preferences.alertsEnabled else { return .suppress(.disabled) }
        if preferences.onlyDuringTrips && context.tripPhase != .active { return .suppress(.noActiveTrip) }
        let age = context.now.timeIntervalSince(context.dataAsOf)
        if age > TimeInterval(preferences.staleAfterMinutes * 60) { return .suppress(.staleData) }

        let threshold = preferences.effectiveThresholdAQI
        var reason = SuppressionReason.belowThreshold

        if context.reading.aqi >= threshold {
            switch check(context.reading, kind: .enteredZone, context: context, preferences: preferences) {
            case .raise(let kind, let reading): return .raise(kind: kind, reading: reading)
            case .suppress(let r): reason = r
            }
        }
        if preferences.lookAhead, let next = context.upcoming, next.zoneId != context.reading.zoneId, next.aqi >= threshold {
            switch check(next, kind: .upcoming, context: context, preferences: preferences) {
            case .raise(let kind, let reading): return .raise(kind: kind, reading: reading)
            case .suppress(let r): if reason == .belowThreshold { reason = r }
            }
        }
        return .suppress(reason)
    }

    private static func check(_ reading: ZoneReading, kind: AlertKind, context: AlertContext,
                              preferences: AlertPreferences) -> AlertDecision {
        let category = reading.category
        if context.history.contains(where: { $0.zoneId == reading.zoneId && $0.category >= category }) {
            return .suppress(.alreadyWarned)
        }
        let latest = context.history.max { $0.createdAt < $1.createdAt }
        let escalation = latest.map { category > $0.category } ?? false
        if !escalation, let latest,
           context.now.timeIntervalSince(latest.createdAt) < TimeInterval(preferences.cooldownMinutes * 60) {
            return .suppress(.coolingDown)
        }
        let resolvedKind: AlertKind = (kind == .enteredZone && escalation) ? .escalation : kind
        return .raise(kind: resolvedKind, reading: reading)
    }
}
