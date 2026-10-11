import XCTest
@testable import AeroscopeKit

final class TripTests: XCTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_800_000_000)

    private func at(_ minutes: Double) -> Date { t0.addingTimeInterval(minutes * 60) }

    private func sample(_ zone: String, _ aqi: Int, _ minutes: Double) -> TripSample {
        TripSample(at: at(minutes), zoneId: zone, zoneName: zone, aqi: aqi, geo: nil, world: nil, simulated: true)
    }

    private func newTrip() -> Trip {
        .start(id: "trip-1", at: t0, source: .demo, mode: .walk, originZoneId: "z-lg",
               destinationZoneId: "z-rf", destinationName: "Red Fort", plannedZoneIds: ["z-lg", "z-ig", "z-cp"])
    }

    func testActiveDurationExcludesPauses() throws {
        var trip = newTrip()
        XCTAssertEqual(trip.activeDuration(at: at(10)), 600, accuracy: 0.001)
        try trip.pause(at: at(10))
        XCTAssertEqual(trip.activeDuration(at: at(25)), 600, accuracy: 0.001, "clock stops while paused")
        try trip.resume(at: at(25))
        XCTAssertEqual(trip.activeDuration(at: at(30)), 900, accuracy: 0.001)
        try trip.end(at: at(30))
        XCTAssertEqual(trip.activeDuration(at: at(90)), 900, accuracy: 0.001)
        XCTAssertEqual(trip.phase, .ended)
        XCTAssertEqual(trip.endedAt, at(30))
    }

    func testInvalidTransitionsThrow() throws {
        var trip = newTrip()
        XCTAssertThrowsError(try trip.resume(at: at(1))) { error in
            XCTAssertEqual(error as? TripError, .invalidTransition(from: .active, action: "resume"))
        }
        try trip.pause(at: at(1))
        XCTAssertThrowsError(try trip.pause(at: at(2)))
        try trip.end(at: at(3))
        XCTAssertThrowsError(try trip.end(at: at(4)))
        XCTAssertThrowsError(try trip.record(sample("z-cp", 200, 5)))
    }

    func testEndingWhilePausedKeepsPausedDurationOut() throws {
        var trip = newTrip()
        try trip.pause(at: at(5))
        try trip.end(at: at(50))
        XCTAssertEqual(trip.activeDuration(at: at(50)), 300, accuracy: 0.001)
    }

    func testExposureIsTimeWeighted() throws {
        var trip = newTrip()
        try trip.record(sample("z-lg", 100, 0))
        try trip.record(sample("z-cp", 300, 10))   // 10 min at 100
        try trip.end(at: at(20))                   // 10 min at 300
        XCTAssertEqual(trip.exposure.averageAqi, 200)
        XCTAssertEqual(trip.exposure.peakAqi, 300)
        XCTAssertEqual(trip.exposure.peakZoneName, "z-cp")
        XCTAssertEqual(trip.exposure.secondsAtOrAbovePoor, 600, accuracy: 0.001)
    }

    func testNoExposureAccruesWhilePaused() throws {
        var trip = newTrip()
        try trip.record(sample("z-lg", 100, 0))
        try trip.pause(at: at(10))                 // 10 min at 100
        try trip.record(sample("z-cp", 400, 20))   // position updates, no exposure
        try trip.resume(at: at(40))
        try trip.end(at: at(50))                   // 10 min at 400
        XCTAssertEqual(trip.exposure.exposedSeconds, 1200, accuracy: 0.001)
        XCTAssertEqual(trip.exposure.averageAqi, 250)
    }

    func testZonesVisitedAndNextPlannedZone() throws {
        var trip = newTrip()
        try trip.record(sample("z-lg", 130, 0))
        XCTAssertEqual(trip.nextPlannedZoneId, "z-ig")
        try trip.record(sample("z-lg", 130, 1))
        try trip.record(sample("z-ig", 185, 2))
        XCTAssertEqual(trip.zonesVisited, ["z-lg", "z-ig"])
        XCTAssertEqual(trip.nextPlannedZoneId, "z-cp")
        trip.replan(zoneIds: ["z-ig", "z-yb", "z-rf"])
        XCTAssertEqual(trip.nextPlannedZoneId, "z-yb")
        XCTAssertEqual(trip.rerouteCount, 1)
        XCTAssertFalse(trip.hasArrived)
    }

    func testSummaryAndCodableRoundTrip() throws {
        var trip = newTrip()
        try trip.record(sample("z-lg", 120, 0))
        trip.attach(alertId: "a1")
        trip.attach(alertId: "a1")
        let data = try AeroscopeJSON.encoder().encode(trip)
        var decoded = try AeroscopeJSON.decoder().decode(Trip.self, from: data)
        XCTAssertEqual(decoded, trip)
        try decoded.end(at: at(15))
        let summary = TripSummary(trip: decoded, endedAt: at(15))
        XCTAssertEqual(summary.alertCount, 1)
        XCTAssertEqual(summary.averageAqi, 120)
        XCTAssertEqual(summary.activeSeconds, 900, accuracy: 0.01)
    }
}
