import XCTest
@testable import AeroscopeKit

final class PendingQueueTests: XCTestCase {
    private func location(_ i: Int) -> BackendOperation {
        .tripEvent(tripId: "t", event: TripEventRequest(type: .location, at: Date(timeIntervalSince1970: Double(i))))
    }

    func testFifoAndDeduplication() {
        var queue = PendingActionQueue()
        let a = PendingAction(operation: location(1), createdAt: .now)
        let b = PendingAction(operation: location(2), createdAt: .now)
        XCTAssertTrue(queue.enqueue(a))
        XCTAssertTrue(queue.enqueue(b))
        XCTAssertFalse(queue.enqueue(a), "same idempotency key is not queued twice")
        XCTAssertEqual(queue.actions.map(\.id), [a.id, b.id])
        queue.remove(ids: [a.id])
        XCTAssertEqual(queue.first?.id, b.id)
    }

    func testCapacityShedsOnlyLocationUpdates() {
        var queue = PendingActionQueue()
        let start = PendingAction(operation: .startTrip(StartTripRequest(
            tripId: "t", startedAt: .now, mode: .walk, source: .live, origin: nil, destinationZoneId: nil, plannedZoneIds: [])), createdAt: .now)
        queue.enqueue(start)
        for i in 0..<(PendingActionQueue.capacity + 20) {
            queue.enqueue(PendingAction(operation: location(i), createdAt: .now))
        }
        XCTAssertEqual(queue.count, PendingActionQueue.capacity)
        XCTAssertEqual(queue.first?.id, start.id, "trip lifecycle actions are never shed")
    }

    func testLocationWithDeviceAlertIsNotDroppable() {
        let alert = PollutionAlert(id: "a", tripId: "t", zoneId: "z", zoneName: "Z", aqi: 300, pm25: nil, kind: .enteredZone,
                                   origin: .device, createdAt: .now, scenarioLabel: nil, simulated: true)
        var queue = PendingActionQueue()
        let action = PendingAction(operation: location(1), createdAt: .now)
        queue.enqueue(action)
        XCTAssertTrue(queue.first!.operation.isDroppable)
        queue.attach(deviceAlert: alert, to: action.id)
        XCTAssertFalse(queue.first!.operation.isDroppable)
    }

    @MainActor
    func testSyncQueueStopsAtRetryableFailureAndPersists() async throws {
        let store = makeTempStore()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let dataset = try CityDataset.bundled()
        let clock = TestClock()
        let backend = FakeLiveBackend(dataset: dataset, clock: clock.closure)
        let sync = SyncQueue(store: store, key: "q")
        let start = PendingAction(operation: .startTrip(StartTripRequest(
            tripId: "t", startedAt: clock.now, mode: .walk, source: .live, origin: nil, destinationZoneId: nil, plannedZoneIds: [])),
            createdAt: clock.now)
        sync.enqueue(start)
        sync.enqueue(PendingAction(operation: .tripEvent(tripId: "t", event: TripEventRequest(type: .pause, at: clock.now)), createdAt: clock.now))

        await backend.setOnline(false)
        let blocked = await sync.flush(using: backend, now: clock.closure)
        XCTAssertNotNil(blocked.blockedBy)
        XCTAssertEqual(sync.count, 2)
        XCTAssertEqual(sync.queue.first?.attempts, 1)

        // Survives a relaunch.
        let reloaded = SyncQueue(store: store, key: "q")
        XCTAssertEqual(reloaded.count, 2)

        await backend.setOnline(true)
        var delivered: [UUID] = []
        reloaded.onDelivered = { action, _ in delivered.append(action.id) }
        let outcome = await reloaded.flush(using: backend, now: clock.closure)
        XCTAssertNil(outcome.blockedBy)
        XCTAssertEqual(reloaded.count, 0)
        XCTAssertEqual(delivered.first, start.id)
        if case .success? = reloaded.result(for: start.id) {} else { XCTFail("result should be remembered") }
    }

    @MainActor
    func testConcurrentFlushesAreSerialised() async throws {
        let store = makeTempStore()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let clock = TestClock()
        let backend = FakeLiveBackend(dataset: try CityDataset.bundled(), clock: clock.closure)
        let sync = SyncQueue(store: store, key: "q")
        sync.enqueue(PendingAction(operation: .startTrip(StartTripRequest(
            tripId: "t", startedAt: clock.now, mode: .walk, source: .live, origin: nil, destinationZoneId: nil, plannedZoneIds: [])),
            createdAt: clock.now))
        for i in 0..<5 { sync.enqueue(PendingAction(operation: location(i), createdAt: clock.now)) }
        async let first = sync.flush(using: backend, now: clock.closure)
        async let second = sync.flush(using: backend, now: clock.closure)
        _ = await (first, second)
        let keys = await backend.performedKeys()
        XCTAssertEqual(keys.count, Set(keys).count, "no action is sent twice")
        XCTAssertEqual(keys.count, 6)
    }
}

final class ConnectivityMessageTests: XCTestCase {
    func testRoundTripThroughPropertyListDictionary() throws {
        // The wire format keeps millisecond precision, so use exact timestamps.
        let t = Date(timeIntervalSince1970: 1_800_000_000.25)
        let action = PendingAction(operation: .alertAction(alertId: "a1", request: AlertActionRequest(action: .acknowledge, at: t)),
                                   createdAt: t)
        let messages: [ConnectivityMessage] = [
            .preferences(.default),
            .demoCommand(.setScenario(Scenario(preset: .winterStagnation, timeIndex: 7))),
            .pendingActions([action]),
            .actionResults(delivered: [action.id], dropped: []),
            .credentials(CredentialTransfer(apiKey: nil, userId: "u", userKey: "k")),
            .requestSummary,
        ]
        for message in messages {
            let dictionary = try message.encoded()
            // WatchConnectivity only accepts property-list types.
            XCTAssertTrue(PropertyListSerialization.propertyList(dictionary, isValidFor: .binary))
            XCTAssertEqual(try ConnectivityMessage.decode(dictionary), message)
        }
    }

    func testContextSlotsOnlyForLatestState() {
        XCTAssertEqual(ConnectivityMessage.preferences(.default).contextSlot, "preferences")
        XCTAssertNil(ConnectivityMessage.pendingActions([]).contextSlot)
        XCTAssertNil(ConnectivityMessage.credentials(CredentialTransfer(apiKey: "x", userId: "u", userKey: "k")).contextSlot,
                     "secrets never sit in application context")
    }
}

@MainActor
final class CompanionModelTests: XCTestCase {
    func testRelayDeliversWatchActionsAndAcknowledges() async throws {
        let store = makeTempStore()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let clock = TestClock()
        let backend = FakeLiveBackend(dataset: try CityDataset.bundled(), clock: clock.closure)
        let connectivity = FakeConnectivity()
        let model = CompanionModel(dependencies: .init(
            store: store, keychain: KeychainStore(service: "com.aeroscope.tests.\(UUID().uuidString)"),
            connectivity: connectivity, makeLiveBackend: { s, _ in s.isConfigured ? backend : nil },
            clock: clock.closure, defaultBaseURL: "https://api.example.test/prod"
        ))
        let start = PendingAction(operation: .startTrip(StartTripRequest(
            tripId: "t", startedAt: clock.now, mode: .walk, source: .live, origin: nil, destinationZoneId: nil, plannedZoneIds: [])),
            createdAt: clock.now)
        let pause = PendingAction(operation: .tripEvent(tripId: "t", event: TripEventRequest(type: .pause, at: clock.now)), createdAt: clock.now)

        await backend.setOnline(false)
        await model.handle(.pendingActions([start, pause]))
        XCTAssertEqual(model.relay.count, 2, "kept while the phone is offline too")

        await backend.setOnline(true)
        await model.flushRelay()
        XCTAssertEqual(model.relay.count, 0)
        let ack = connectivity.sent.compactMap { message, _ -> [UUID]? in
            if case .actionResults(let delivered, _) = message { return delivered }
            return nil
        }.flatMap { $0 }
        XCTAssertEqual(Set(ack), [start.id, pause.id])
        XCTAssertEqual(model.relayLog.first?.outcome, .delivered)
        let keys = await backend.performedKeys()
        XCTAssertEqual(keys, [start.id, pause.id], "the watch's ids are reused as idempotency keys")
    }

    func testWatchSummaryKeepsNewest() async throws {
        let store = makeTempStore()
        defer { try? FileManager.default.removeItem(at: store.directory) }
        let model = CompanionModel(dependencies: .init(store: store, keychain: KeychainStore(service: "t.\(UUID())"), connectivity: nil,
                                                       makeLiveBackend: { _, _ in nil }))
        func summary(_ t: TimeInterval, pending: Int) -> WatchSummary {
            WatchSummary(generatedAt: Date(timeIntervalSince1970: t), mode: .demo, snapshot: nil, trip: nil, recentTrips: [],
                         recentAlerts: [], pendingActionCount: pending, locationAuthorization: .authorized,
                         notificationAuthorization: .authorized, pushRegistered: false, lastSyncAt: nil, lastSyncError: nil,
                         demoScenario: .demoDefault)
        }
        await model.handle(.watchSummary(summary(200, pending: 2)))
        await model.handle(.watchSummary(summary(100, pending: 9)))
        XCTAssertEqual(model.watchSummary?.pendingActionCount, 2)
    }
}

final class KeychainStoreTests: XCTestCase {
    func testRoundTripAndDelete() throws {
        let keychain = KeychainStore(service: "com.aeroscope.tests.\(UUID().uuidString)")
        defer { try? keychain.set(nil, for: "k") }
        do {
            try keychain.set("one", for: "k")
        } catch KeychainStore.KeychainError.unexpectedStatus(let status) {
            throw XCTSkip("Keychain unavailable in this test environment (status \(status))")
        }
        XCTAssertEqual(keychain.string(for: "k"), "one")
        try keychain.set("two", for: "k")
        XCTAssertEqual(keychain.string(for: "k"), "two")
        try keychain.set(nil, for: "k")
        XCTAssertNil(keychain.string(for: "k"))
    }
}
