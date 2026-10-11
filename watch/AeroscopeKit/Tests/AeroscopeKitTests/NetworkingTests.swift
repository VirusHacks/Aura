import XCTest
@testable import AeroscopeKit

/// Canned HTTP responses for `LiveBackendClient`'s injectable transport.
final class StubTransport: @unchecked Sendable {
    private let lock = NSLock()
    private var _requests: [URLRequest] = []
    private var _handler: ((URLRequest) throws -> (Int, Data))?

    var requests: [URLRequest] { lock.withLock { _requests } }
    var handler: ((URLRequest) throws -> (Int, Data))? {
        get { lock.withLock { _handler } }
        set { lock.withLock { _handler = newValue } }
    }

    var transport: LiveBackendClient.Transport {
        { [self] request in
            lock.withLock { _requests.append(request) }
            guard let handler else { throw URLError(.unknown) }
            let (status, body) = try handler(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
                                           headerFields: ["Content-Type": "application/json"])!
            return (body, response)
        }
    }
}

final class NetworkingTests: XCTestCase {
    private var client: LiveBackendClient!
    private var stub: StubTransport!

    override func setUp() {
        stub = StubTransport()
        client = LiveBackendClient(baseURL: URL(string: "https://api.example.test/prod/")!, userId: "user-1",
                                   apiKey: "secret-key", userKey: "user-secret", transport: stub.transport)
    }

    func testTripEventRequestShape() async throws {
        stub.handler = { _ in
            (200, Data(#"{"tripPhase":"active","evaluation":{"reading":{"zoneId":"z-cp","zoneName":"Connaught Place","aqi":236,"pm25":102,"provenance":"demo","simulated":true},"match":{"zoneId":"z-cp","zoneName":"Connaught Place","distanceKm":0.2,"world":{"x":2,"z":-14}},"alert":{"id":"a-1","tripId":"t/1","zoneId":"z-cp","zoneName":"Connaught Place","aqi":236,"kind":"entered-zone","origin":"backend","status":"active","createdAt":"2026-10-11T08:00:00.123Z","simulated":true},"dataAsOf":"2026-10-11T13:30:00+05:30"}}"#.utf8))
        }
        let key = UUID()
        let event = TripEventRequest(type: .location, at: Date(timeIntervalSince1970: 0),
                                     location: LocationPayload(geo: GeoPoint(lat: 28.63, lon: 77.21), zoneId: "z-cp",
                                                               world: nil, accuracyMeters: 8, simulated: false))
        let result = try await client.perform(.tripEvent(tripId: "t/1", event: event), idempotencyKey: key)

        let request = try XCTUnwrap(stub.requests.first)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.absoluteString, "https://api.example.test/prod/v1/trips/t%2F1/events")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-key"), "secret-key")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-aeroscope-user"), "user-1")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-aeroscope-user-key"), "user-secret")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Idempotency-Key"), key.uuidString)
        let body = try XCTUnwrap(request.httpBody)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
        XCTAssertEqual(json["type"] as? String, "location")
        XCTAssertEqual(json["at"] as? String, "1970-01-01T00:00:00.000Z")

        XCTAssertEqual(result.tripPhase, .active)
        XCTAssertEqual(result.evaluation?.reading.category, .poor)
        XCTAssertEqual(result.alert?.id, nil, "alert is nested in the evaluation")
        XCTAssertEqual(result.evaluation?.alert?.kind, .enteredZone)
        let expected = try XCTUnwrap(AeroscopeJSON.parseDate("2026-10-11T08:00:00Z"))
        XCTAssertEqual(result.evaluation!.dataAsOf.timeIntervalSince1970, expected.timeIntervalSince1970, accuracy: 0.001)
    }

    func testCurrentReadingQuery() async throws {
        stub.handler = { _ in
            (200, Data(#"{"reading":{"zoneId":"z-lg","zoneName":"Lodhi Garden","aqi":130},"match":{"zoneId":"z-lg","zoneName":"Lodhi Garden","distanceKm":0.1},"generatedAt":"2026-10-11T08:00:00Z"}"#.utf8))
        }
        let response = try await client.currentReading(ReadingQuery(location: GeoPoint(lat: 28.5931, lon: 77.2197)))
        let url = try XCTUnwrap(stub.requests.first?.url)
        XCTAssertEqual(url.path, "/prod/v1/air-quality/current")
        XCTAssertTrue(url.query?.contains("lat=28.593100") ?? false)
        XCTAssertEqual(response.reading.category, .moderate)
        XCTAssertNil(stub.requests.first?.value(forHTTPHeaderField: "Idempotency-Key"))
    }

    func testErrorMapping() async {
        let cases: [(Int, String, BackendError)] = [
            (401, "{}", .unauthorized),
            (404, #"{"error":"Outside Delhi coverage","code":"outside-coverage"}"#, .outsideCoverage("Outside Delhi coverage")),
            (404, #"{"error":"Unknown trip"}"#, .notFound("Unknown trip")),
            (409, #"{"error":"Trip already ended"}"#, .rejected(status: 409, message: "Trip already ended")),
            (429, "{}", .rateLimited),
            (503, #"{"error":"down"}"#, .server(status: 503, message: "down")),
        ]
        for (status, body, expected) in cases {
            stub.handler = { _ in (status, Data(body.utf8)) }
            do {
                _ = try await client.health()
                XCTFail("expected \(expected)")
            } catch {
                XCTAssertEqual(error as? BackendError, expected, "status \(status)")
            }
        }
    }

    func testTransportFailureIsOfflineAndRetryable() async {
        stub.handler = { _ in throw URLError(.notConnectedToInternet) }
        do {
            _ = try await client.health()
            XCTFail("expected failure")
        } catch {
            let e = BackendError.from(error)
            XCTAssertTrue(e.isRetryable)
            XCTAssertTrue(e.canRelayThroughPhone)
        }
        XCTAssertFalse(BackendError.unauthorized.isRetryable)
        XCTAssertFalse(BackendError.rejected(status: 400, message: "").isRetryable)
    }

    func testMalformedPayloadIsDecodingError() async {
        stub.handler = { _ in (200, Data(#"{"status":"ok"}"#.utf8)) }
        do {
            _ = try await client.health()
            XCTFail("expected decoding error")
        } catch {
            guard case .decoding = error as? BackendError else { return XCTFail("got \(error)") }
        }
    }

    func testBackendSettingsValidation() {
        XCTAssertNil(BackendSettings(baseURL: "", userId: "u", updatedAt: .now).url)
        XCTAssertNil(BackendSettings(baseURL: "ftp://x", userId: "u", updatedAt: .now).url)
        XCTAssertNotNil(BackendSettings(baseURL: " https://x.example/prod ", userId: "u", updatedAt: .now).url)
        XCTAssertNil(CompanionModel.validate(baseURL: "https://abc.execute-api.ap-south-1.amazonaws.com/prod"))
        XCTAssertNil(CompanionModel.validate(baseURL: "http://localhost:8787"))
        XCTAssertNil(CompanionModel.validate(baseURL: "http://192.168.1.20:8787"))
        XCTAssertNotNil(CompanionModel.validate(baseURL: "http://api.example.com"))
        XCTAssertNotNil(CompanionModel.validate(baseURL: "not a url"))
    }

    func testDatesAcceptFractionalSecondsAndOffsets() throws {
        XCTAssertNotNil(AeroscopeJSON.parseDate("2026-10-11T08:00:00.123Z"))
        XCTAssertNotNil(AeroscopeJSON.parseDate("2026-10-11T08:00:00Z"))
        let ist = try XCTUnwrap(AeroscopeJSON.parseDate("2026-11-14T15:00:00+05:30"))
        let utc = try XCTUnwrap(AeroscopeJSON.parseDate("2026-11-14T09:30:00Z"))
        XCTAssertEqual(ist, utc)
        XCTAssertNil(AeroscopeJSON.parseDate("yesterday"))
    }
}

final class DemoBackendTests: XCTestCase {
    func testIdempotentReplayReturnsStoredResult() async throws {
        let dataset = try CityDataset.bundled()
        let backend = DemoBackend(dataset: dataset)
        let key = UUID()
        let start = StartTripRequest(tripId: "t1", startedAt: .now, mode: .walk, source: .demo, origin: nil,
                                     destinationZoneId: "z-rf", plannedZoneIds: ["z-cp", "z-ndls"])
        let first = try await backend.perform(.startTrip(start), idempotencyKey: key)
        let second = try await backend.perform(.startTrip(start), idempotencyKey: key)
        XCTAssertNil(first.replayed)
        XCTAssertEqual(second.replayed, true)

        let location = LocationPayload(geo: dataset.zone(id: "z-cp")!.geo, zoneId: nil, world: nil, accuracyMeters: nil, simulated: true)
        let event = TripEventRequest(type: .location, at: .now, location: location)
        let a = try await backend.perform(.tripEvent(tripId: "t1", event: event), idempotencyKey: UUID())
        XCTAssertEqual(a.alert?.zoneId, "z-cp")
        let alerts = try await backend.recentAlerts(limit: 10)
        XCTAssertEqual(alerts.count, 1)
    }

    func testInvalidTransitionsAreRejected() async throws {
        let backend = DemoBackend(dataset: try CityDataset.bundled())
        let start = StartTripRequest(tripId: "t2", startedAt: .now, mode: .walk, source: .demo, origin: nil,
                                     destinationZoneId: nil, plannedZoneIds: [])
        _ = try await backend.perform(.startTrip(start), idempotencyKey: UUID())
        do {
            _ = try await backend.perform(.tripEvent(tripId: "t2", event: TripEventRequest(type: .resume, at: .now)), idempotencyKey: UUID())
            XCTFail("resume of an active trip must fail")
        } catch {
            XCTAssertEqual(error as? BackendError, .rejected(status: 409, message: "Trip is not paused"))
        }
        do {
            _ = try await backend.perform(.tripEvent(tripId: "missing", event: TripEventRequest(type: .end, at: .now)), idempotencyKey: UUID())
            XCTFail("unknown trip must fail")
        } catch {
            XCTAssertEqual(error as? BackendError, .notFound("Unknown trip"))
        }
    }

    func testScenarioChangeAffectsReadings() async throws {
        let dataset = try CityDataset.bundled()
        let backend = DemoBackend(dataset: dataset)
        let before = try await backend.currentReading(ReadingQuery(zoneId: "z-an")).reading.aqi
        await backend.setScenario(Scenario(preset: .clearMorning, timeIndex: 2))
        let after = try await backend.currentReading(ReadingQuery(zoneId: "z-an")).reading.aqi
        XCTAssertLessThan(after, before)
    }
}
