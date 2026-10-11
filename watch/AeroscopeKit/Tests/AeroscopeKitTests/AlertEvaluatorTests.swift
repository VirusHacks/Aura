import XCTest
@testable import AeroscopeKit

final class AlertEvaluatorTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    private func reading(_ zone: String, _ aqi: Int) -> ZoneReading {
        ZoneReading(zoneId: zone, zoneName: zone.uppercased(), region: "central", aqi: aqi, pm25: nil, pm10: nil,
                    dominant: .pm25, temperature: nil, windSpeed: nil, scenarioTime: nil, provenance: .demo, simulated: true)
    }

    private func context(
        _ r: ZoneReading, upcoming: ZoneReading? = nil, phase: TripPhase? = .active,
        history: [AlertHistoryEntry] = [], age: TimeInterval = 0
    ) -> AlertContext {
        AlertContext(reading: r, dataAsOf: now.addingTimeInterval(-age), upcoming: upcoming, tripPhase: phase,
                     history: history, now: now)
    }

    private func entry(_ zone: String, _ category: AQICategory, minutesAgo: Double, kind: AlertKind = .enteredZone) -> AlertHistoryEntry {
        AlertHistoryEntry(zoneId: zone, category: category, kind: kind, createdAt: now.addingTimeInterval(-minutesAgo * 60))
    }

    func testRaisesWhenZoneReachesThreshold() {
        let decision = AlertEvaluator.evaluate(context(reading("cp", 201)), preferences: .default)
        XCTAssertEqual(decision, .raise(kind: .enteredZone, reading: reading("cp", 201)))
    }

    func testBelowThresholdDoesNotRaise() {
        XCTAssertEqual(AlertEvaluator.evaluate(context(reading("cp", 200)), preferences: .default), .suppress(.belowThreshold))
    }

    func testDisabledNeverRaises() {
        var prefs = AlertPreferences.default
        prefs.alertsEnabled = false
        XCTAssertEqual(AlertEvaluator.evaluate(context(reading("cp", 480)), preferences: prefs), .suppress(.disabled))
    }

    func testOnlyDuringActiveTrips() {
        XCTAssertEqual(AlertEvaluator.evaluate(context(reading("cp", 350), phase: nil), preferences: .default), .suppress(.noActiveTrip))
        XCTAssertEqual(AlertEvaluator.evaluate(context(reading("cp", 350), phase: .paused), preferences: .default), .suppress(.noActiveTrip))
        var prefs = AlertPreferences.default
        prefs.onlyDuringTrips = false
        XCTAssertEqual(AlertEvaluator.evaluate(context(reading("cp", 350), phase: nil), preferences: prefs),
                       .raise(kind: .enteredZone, reading: reading("cp", 350)))
    }

    func testStaleDataNeverRaises() {
        let decision = AlertEvaluator.evaluate(context(reading("cp", 450), age: 31 * 60), preferences: .default)
        XCTAssertEqual(decision, .suppress(.staleData))
    }

    func testSensitiveGroupLowersThresholdByOneCategory() {
        var prefs = AlertPreferences.default
        prefs.sensitiveGroup = true
        XCTAssertEqual(prefs.effectiveThreshold, .moderate)
        XCTAssertEqual(AlertEvaluator.evaluate(context(reading("lg", 130)), preferences: prefs),
                       .raise(kind: .enteredZone, reading: reading("lg", 130)))
        prefs.threshold = .satisfactory
        XCTAssertEqual(prefs.effectiveThreshold, .satisfactory, "never drops below Satisfactory")
    }

    func testSameZoneSameCategoryIsNotRepeated() {
        let decision = AlertEvaluator.evaluate(
            context(reading("cp", 240), history: [entry("cp", .poor, minutesAgo: 60)]), preferences: .default)
        XCTAssertEqual(decision, .suppress(.alreadyWarned))
    }

    func testUpcomingWarningCountsForTheZoneWhenEntered() {
        let decision = AlertEvaluator.evaluate(
            context(reading("cp", 236), history: [entry("cp", .poor, minutesAgo: 1, kind: .upcoming)]), preferences: .default)
        XCTAssertEqual(decision, .suppress(.alreadyWarned))
    }

    func testCooldownSuppressesNewZoneAtSameLevel() {
        let decision = AlertEvaluator.evaluate(
            context(reading("ndls", 262), history: [entry("cp", .poor, minutesAgo: 5)]), preferences: .default)
        XCTAssertEqual(decision, .suppress(.coolingDown))
        let later = AlertEvaluator.evaluate(
            context(reading("ndls", 262), history: [entry("cp", .poor, minutesAgo: 16)]), preferences: .default)
        XCTAssertEqual(later, .raise(kind: .enteredZone, reading: reading("ndls", 262)))
    }

    func testEscalationBypassesCooldown() {
        let decision = AlertEvaluator.evaluate(
            context(reading("an", 360), history: [entry("cp", .poor, minutesAgo: 2)]), preferences: .default)
        XCTAssertEqual(decision, .raise(kind: .escalation, reading: reading("an", 360)))
    }

    func testSameZoneWorseCategoryAlertsAgain() {
        let decision = AlertEvaluator.evaluate(
            context(reading("cp", 320), history: [entry("cp", .poor, minutesAgo: 2)]), preferences: .default)
        XCTAssertEqual(decision, .raise(kind: .escalation, reading: reading("cp", 320)))
    }

    func testLookAheadWarnsAboutNextZone() {
        let decision = AlertEvaluator.evaluate(context(reading("ig", 185), upcoming: reading("cp", 236)), preferences: .default)
        XCTAssertEqual(decision, .raise(kind: .upcoming, reading: reading("cp", 236)))
    }

    func testLookAheadCanBeDisabled() {
        var prefs = AlertPreferences.default
        prefs.lookAhead = false
        let decision = AlertEvaluator.evaluate(context(reading("ig", 185), upcoming: reading("cp", 236)), preferences: prefs)
        XCTAssertEqual(decision, .suppress(.belowThreshold))
    }

    func testCurrentZoneTakesPriorityOverUpcoming() {
        let decision = AlertEvaluator.evaluate(context(reading("cp", 236), upcoming: reading("ndls", 262)), preferences: .default)
        XCTAssertEqual(decision, .raise(kind: .enteredZone, reading: reading("cp", 236)))
    }

    func testUpcomingCheckedWhenCurrentAlreadyWarned() {
        let decision = AlertEvaluator.evaluate(
            context(reading("cp", 236), upcoming: reading("an", 412), history: [entry("cp", .poor, minutesAgo: 1)]),
            preferences: .default)
        XCTAssertEqual(decision, .raise(kind: .upcoming, reading: reading("an", 412)))
    }

    func testAlertCopy() {
        let alert = PollutionAlert(id: "a", tripId: "t", zoneId: "z-cp", zoneName: "Connaught Place", aqi: 236, pm25: 102,
                                   kind: .upcoming, origin: .demo, createdAt: now, scenarioLabel: nil, simulated: true)
        XCTAssertEqual(alert.category, .poor)
        XCTAssertEqual(alert.title, "Poor air ahead")
        XCTAssertTrue(alert.message.contains("Connaught Place"))
        XCTAssertEqual(alert.advice, AQICategory.poor.band.advice)
    }
}
