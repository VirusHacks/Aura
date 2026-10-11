import XCTest
@testable import AeroscopeKit

/// Drives the real HTTP client against the Node backend to prove the Swift and
/// JavaScript sides agree on the wire format. Skipped unless a server is given:
///
///     (cd backend && PORT=8799 node dev-server.mjs) &
///     AEROSCOPE_DEV_SERVER=http://localhost:8799 swift test --filter LiveContractTests
final class LiveContractTests: XCTestCase {
    private var client: LiveBackendClient!

    override func setUpWithError() throws {
        guard let raw = ProcessInfo.processInfo.environment["AEROSCOPE_DEV_SERVER"], let url = URL(string: raw) else {
            throw XCTSkip("Set AEROSCOPE_DEV_SERVER to run the contract tests against a running backend")
        }
        client = LiveBackendClient(baseURL: url, userId: "contract-\(UUID().uuidString.prefix(8))",
                                   apiKey: ProcessInfo.processInfo.environment["AEROSCOPE_API_KEY"],
                                   userKey: BackendCredentials.generateUserKey())
    }

    func testFullTripContract() async throws {
        let health = try await client.health()
        XCTAssertEqual(health.status, "ok")

        let city = try await client.cityData()
        XCTAssertEqual(city.dataset.zones.count, 17)
        XCTAssertTrue(city.dataset.zones.allSatisfy { $0.geo != nil })
        XCTAssertFalse(city.dataset.links.isEmpty)

        let dataset = try CityDataset.bundled()
        let geo = { (id: String) in dataset.zone(id: id)!.geo! }
        let current = try await client.currentReading(ReadingQuery(location: geo("z-cp")))
        XCTAssertEqual(current.reading.zoneId, "z-cp")
        XCTAssertEqual(current.reading.category, AQIScale.category(for: current.reading.aqi))

        // Readings on the wire equal the Swift engine for the backend's scenario.
        let scenario = try XCTUnwrap(current.scenario)
        XCTAssertEqual(current.reading.aqi, ScenarioEngine.reading(for: dataset.zone(id: "z-cp")!, scenario: scenario, provenance: .demo).aqi)

        var prefs = AlertPreferences.default
        prefs.updatedAt = Date()
        _ = try await client.perform(.updatePreferences(prefs), idempotencyKey: UUID())

        let tripId = UUID().uuidString
        let planned = ["z-lg", "z-ig", "z-cp", "z-ndls", "z-cc", "z-rf"]
        let start = try await client.perform(.startTrip(StartTripRequest(
            tripId: tripId, startedAt: Date(), mode: .walk, source: .live,
            origin: LocationPayload(geo: geo("z-lg"), zoneId: "z-lg", world: nil, accuracyMeters: 10, simulated: false),
            destinationZoneId: "z-rf", plannedZoneIds: planned
        )), idempotencyKey: UUID())
        XCTAssertEqual(start.tripPhase, .active)
        XCTAssertEqual(start.evaluation?.match.zoneId, "z-lg")

        let key = UUID()
        let event = TripEventRequest(type: .location, at: Date(),
                                     location: LocationPayload(geo: geo("z-ig"), zoneId: nil, world: nil, accuracyMeters: 10, simulated: false))
        let moved = try await client.perform(.tripEvent(tripId: tripId, event: event), idempotencyKey: key)
        let evaluation = try XCTUnwrap(moved.evaluation)
        XCTAssertEqual(evaluation.match.zoneId, "z-ig")
        XCTAssertNotNil(evaluation.match.world)
        let replay = try await client.perform(.tripEvent(tripId: tripId, event: event), idempotencyKey: key)
        XCTAssertEqual(replay.replayed, true)

        if let alert = evaluation.alert {
            XCTAssertEqual(alert.tripId, tripId)
            let routed = try await client.perform(.alertAction(alertId: alert.id, request: AlertActionRequest(
                action: .requestRoute, at: Date(), mode: .walk, currentZoneId: "z-ig", destinationZoneId: "z-rf", plannedZoneIds: planned
            )), idempotencyKey: UUID())
            XCTAssertEqual(routed.alert?.status, .rerouteRequested)
            let comparison = try XCTUnwrap(routed.routeComparison)
            let option = comparison.alternative ?? comparison.current
            let accepted = try await client.perform(.acceptRoute(tripId: tripId, request: AcceptRouteRequest(
                routeId: option.id, choice: comparison.alternative == nil ? .current : .alternative,
                zoneIds: option.zoneIds, alertId: alert.id, at: Date()
            )), idempotencyKey: UUID())
            XCTAssertNotNil(accepted.plannedZoneIds)
        }

        let compared = try await client.compareRoutes(RouteCompareRequest(fromZoneId: "z-lg", toZoneId: "z-rf", mode: .cycle))
        XCTAssertEqual(compared.current.zoneIds.first, "z-lg")

        let status = try await client.tripStatus(tripId: tripId)
        XCTAssertEqual(status.phase, .active)
        XCTAssertEqual(status.lastEvaluationSource, .device)

        try await client.registerDevice(DeviceRegistration(deviceId: "contract-watch", token: "abcdef0123456789", platform: "watchOS",
                                                           environment: "sandbox", bundleId: "com.aeroscope.test"))
        _ = try await client.recentAlerts(limit: 5)

        let ended = try await client.perform(.tripEvent(tripId: tripId, event: TripEventRequest(type: .end, at: Date())), idempotencyKey: UUID())
        XCTAssertEqual(ended.tripPhase, .ended)

        do {
            _ = try await client.currentReading(ReadingQuery(location: GeoPoint(lat: 37.33, lon: -122.0)))
            XCTFail("expected outside coverage")
        } catch {
            guard case .outsideCoverage = error as? BackendError else { return XCTFail("got \(error)") }
        }
    }
}
