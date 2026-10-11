import XCTest
@testable import AeroscopeKit

/// End-to-end watch workflows against fakes: trip → alert → route → backend.
@MainActor
final class ModelWorkflowTests: XCTestCase {
    private var dataset: CityDataset!
    private var clock: TestClock!
    private var store: FileStore!
    private var location: FakeLocation!
    private var notifier: FakeNotifier!
    private var haptics: FakeHaptics!
    private var connectivity: FakeConnectivity!
    private var live: FakeLiveBackend!
    private let keychain = KeychainStore(service: "com.aeroscope.tests.\(UUID().uuidString)")

    override func setUp() async throws {
        dataset = try CityDataset.bundled()
        clock = TestClock()
        store = makeTempStore()
        location = FakeLocation()
        notifier = FakeNotifier()
        haptics = FakeHaptics()
        connectivity = FakeConnectivity()
        live = FakeLiveBackend(dataset: dataset, clock: clock.closure)
    }

    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: store.directory)
        try? keychain.set(nil, for: KeychainStore.apiKeyAccount)
        try? keychain.set(nil, for: KeychainStore.userKeyAccount)
    }

    private func makeModel(baseURL: String? = "https://api.example.test/prod") -> AeroscopeModel {
        let live = self.live!
        return AeroscopeModel(dependencies: .init(
            store: store, keychain: keychain, location: location, notifier: notifier, haptics: haptics,
            connectivity: connectivity, dataset: dataset,
            makeLiveBackend: { settings, _ in settings.isConfigured ? live : nil },
            clock: clock.closure, demoStepInterval: .seconds(3600), defaultBaseURL: baseURL,
            deviceId: "test-device", bundleId: "com.aeroscope.test"
        ))
    }

    // MARK: Demo flow

    func testDemoTripRaisesAlertAndAcceptsCleanerRoute() async throws {
        let model = makeModel()
        await model.start()
        await model.setMode(.demo)
        XCTAssertEqual(model.snapshot?.status(at: clock.now), .demo)
        XCTAssertEqual(model.snapshot?.reading.zoneId, "z-lg")

        await model.startTrip(destinationZoneId: "z-rf")
        let trip = try XCTUnwrap(model.trip)
        XCTAssertEqual(trip.plannedZoneIds, ["z-lg", "z-ig", "z-cp", "z-ndls", "z-cc", "z-rf"])
        XCTAssertEqual(trip.source, .demo)
        XCTAssertNil(model.presentedAlertId, "Lodhi Garden is Moderate under the default scenario")

        for _ in 0..<6 where model.presentedAlertId == nil {
            clock.advance(minutes: 1)
            await model.demoStep()
        }
        let alert = try XCTUnwrap(model.presentedAlert)
        XCTAssertEqual(alert.kind, .upcoming)
        XCTAssertEqual(alert.zoneId, "z-cp")
        XCTAssertEqual(alert.origin, .demo)
        XCTAssertEqual(model.trip?.lastSample?.zoneId, "z-ig")
        XCTAssertTrue(haptics.played.contains(.alert))
        XCTAssertTrue(notifier.delivered.isEmpty, "foreground alerts show in-app, not as a notification")

        await model.requestRoute(alertId: alert.id)
        guard case .loaded(let comparison, let alertId, let offline) = model.routeState else {
            return XCTFail("expected a route comparison, got \(model.routeState)")
        }
        XCTAssertEqual(alertId, alert.id)
        XCTAssertFalse(offline)
        XCTAssertEqual(comparison.alternative?.zoneIds, ["z-ig", "z-yb", "z-rf"])

        await model.chooseRoute(comparison, choice: .alternative)
        XCTAssertEqual(model.trip?.plannedZoneIds, ["z-lg", "z-ig", "z-yb", "z-rf"])
        XCTAssertEqual(model.trip?.rerouteCount, 1)
        XCTAssertEqual(model.alerts.first { $0.id == alert.id }?.status, .rerouted)
        XCTAssertNil(model.presentedAlertId)
        XCTAssertEqual(model.demoJourney?.zoneIds, ["z-ig", "z-yb", "z-rf"])

        // The simulated position now heads for Yamuna Riverfront.
        for _ in 0..<3 {
            clock.advance(minutes: 1)
            await model.demoStep()
        }
        XCTAssertEqual(model.trip?.lastSample?.zoneId, "z-yb")

        await model.endTrip()
        XCTAssertNil(model.trip)
        XCTAssertEqual(model.recentTrips.first?.rerouteCount, 1)
        XCTAssertGreaterThan(model.recentTrips.first?.zonesVisited ?? 0, 2)
        XCTAssertEqual(model.pendingActionCount, 0, "demo mode never queues backend actions")
    }

    func testBackgroundAlertIsDeliveredAsNotification() async throws {
        let model = makeModel()
        await model.start()
        await model.setMode(.demo)
        await model.startTrip(destinationZoneId: "z-rf")
        model.isForeground = false
        for _ in 0..<6 where notifier.delivered.isEmpty {
            clock.advance(minutes: 1)
            await model.demoStep()
        }
        // Delivery hops through a Task; let it run.
        for _ in 0..<5 where notifier.delivered.isEmpty { await Task.yield() }
        XCTAssertEqual(notifier.delivered.first?.zoneId, "z-cp")
        XCTAssertNil(model.presentedAlertId)

        let alert = try XCTUnwrap(notifier.delivered.first)
        await model.handleNotificationAction(.acknowledge, alert: alert)
        XCTAssertEqual(model.alerts.first { $0.id == alert.id }?.status, .acknowledged)
        XCTAssertTrue(notifier.removed.contains(alert.id))
    }

    // MARK: Honesty of data status

    func testLiveModeNeverFallsBackToDemoData() async throws {
        let model = makeModel(baseURL: nil)
        await model.start()
        XCTAssertEqual(model.mode, .live)
        await model.process(fix(at: "z-cp", in: dataset, time: clock.now))
        XCTAssertNil(model.snapshot, "no backend means no reading, not a demo reading")
        XCTAssertEqual(model.issue, .backendNotConfigured)

        await model.setMode(.demo)
        XCTAssertEqual(model.snapshot?.source, .demo)
        await model.setMode(.live)
        XCTAssertNil(model.snapshot, "the demo reading must not carry over into live mode")
    }

    func testLiveReadingAgesFromLiveToCachedAndStale() async throws {
        let model = makeModel()
        await model.start()
        await model.process(fix(at: "z-cp", in: dataset, time: clock.now))
        let snapshot = try XCTUnwrap(model.snapshot)
        XCTAssertEqual(snapshot.status(at: clock.now), .live)
        XCTAssertEqual(snapshot.reading.zoneId, "z-cp")
        XCTAssertNotNil(snapshot.world)
        XCTAssertEqual(snapshot.status(at: clock.now.addingTimeInterval(11 * 60)), .cached)
        XCTAssertTrue(snapshot.isStale(at: clock.now.addingTimeInterval(31 * 60)))

        // Relaunch: a restored snapshot is never LIVE.
        let relaunched = makeModel()
        XCTAssertEqual(relaunched.snapshot?.status(at: clock.now), .cached)
    }

    func testOutsideCoverageIsReported() async throws {
        let model = makeModel()
        await model.start()
        await model.process(LocationFix(point: GeoPoint(lat: 37.33, lon: -122.0), at: clock.now, accuracyMeters: 5, simulated: false))
        guard case .outsideCoverage = model.issue else { return XCTFail("expected outside coverage, got \(String(describing: model.issue))") }
        XCTAssertNil(model.snapshot)
    }

    func testLocationDeniedKeepsLastKnownSnapshot() async throws {
        let model = makeModel()
        await model.start()
        await model.process(fix(at: "z-cp", in: dataset, time: clock.now))
        XCTAssertNotNil(model.snapshot)
        location.authorization = .denied
        location.onAuthorizationChange?(.denied)
        clock.advance(minutes: 40)
        await model.refresh()
        XCTAssertEqual(model.issue, .locationDenied)
        XCTAssertEqual(model.snapshot?.reading.zoneId, "z-cp", "last known zone stays visible")
        XCTAssertFalse(model.snapshotLocationIsCurrent(at: clock.now))
        XCTAssertTrue(model.snapshot?.isStale(at: clock.now) ?? false)
    }

    // MARK: Offline queue and relay

    func testOfflineTripQueuesInOrderAndSyncsLater() async throws {
        let model = makeModel()
        await model.start()
        await model.process(fix(at: "z-lg", in: dataset, time: clock.now))   // primes the city cache
        XCTAssertNotNil(model.cityCache)

        await live.setOnline(false)
        await model.startTrip(destinationZoneId: "z-rf")
        clock.advance(minutes: 2)
        await model.process(fix(at: "z-ig", in: dataset, time: clock.now))
        XCTAssertEqual(model.pendingActionCount, 2)
        XCTAssertEqual(model.snapshot?.obtainedAs, .cached, "offline estimates are labelled CACHED")
        XCTAssertEqual(model.issue, .offline)
        XCTAssertEqual(model.trip?.lastSample?.zoneId, "z-ig", "the trip keeps recording offline")

        // The offline evaluation raised the look-ahead alert on the device.
        let deviceAlert = try XCTUnwrap(model.alerts.first)
        XCTAssertEqual(deviceAlert.origin, .device)
        XCTAssertEqual(deviceAlert.zoneId, "z-cp")

        await live.setOnline(true)
        await model.flushQueue()
        XCTAssertEqual(model.pendingActionCount, 0)
        let ops = await live.performedOperations()
        XCTAssertEqual(ops.count, 2)
        guard case .startTrip = ops[0], case .tripEvent(_, let event) = ops[1] else { return XCTFail("wrong order: \(ops)") }
        XCTAssertEqual(event.deviceAlert?.id, deviceAlert.id, "the backend records the device's alert id")
    }

    func testStaleCacheNeverRaisesAlerts() async throws {
        let model = makeModel()
        await model.start()
        await model.process(fix(at: "z-lg", in: dataset, time: clock.now))
        clock.advance(minutes: 45)
        await live.setOnline(false)
        await model.startTrip(destinationZoneId: "z-rf")
        await model.process(fix(at: "z-cp", in: dataset, time: clock.now))
        XCTAssertTrue(model.alerts.isEmpty, "cached data older than 30 minutes must not alert")
        XCTAssertEqual(model.trip?.lastSample?.zoneId, "z-cp")
    }

    func testUndeliverableActionsAreRelayedToPhoneAndClearedOnAck() async throws {
        let model = makeModel()
        await model.start()
        await live.setOnline(false)
        await model.startTrip(destinationZoneId: nil)
        let relayed = connectivity.relayedActions
        XCTAssertEqual(relayed.count, 1)
        XCTAssertNotNil(model.sync.queue.actions.first?.relayedViaPhoneAt)

        await model.handle(.actionResults(delivered: relayed.map(\.id), dropped: []))
        XCTAssertEqual(model.pendingActionCount, 0)
    }

    func testPermanentRejectionDropsActionWithoutBlockingQueue() async throws {
        let model = makeModel()
        await model.start()
        await live.setPermanentFailure(.rejected(status: 400, message: "bad"))
        await model.startTrip(destinationZoneId: nil)
        XCTAssertEqual(model.pendingActionCount, 0)
        XCTAssertNotNil(model.trip, "the local trip survives a rejected sync")
    }

    // MARK: Settings and sync

    func testPreferencesSyncLastWriterWins() async throws {
        let model = makeModel()
        await model.start()
        var newer = model.preferences
        newer.threshold = .veryPoor
        newer.updatedAt = clock.now.addingTimeInterval(60)
        await model.handle(.preferences(newer))
        XCTAssertEqual(model.preferences.threshold, .veryPoor)

        var older = newer
        older.threshold = .moderate
        older.updatedAt = clock.now.addingTimeInterval(-60)
        await model.handle(.preferences(older))
        XCTAssertEqual(model.preferences.threshold, .veryPoor)
    }

    func testLocalPreferenceChangeIsSharedAndSubmitted() async throws {
        let model = makeModel()
        await model.start()
        await model.updatePreferences { $0.sensitiveGroup = true }
        XCTAssertTrue(connectivity.sent.contains { message, delivery in
            if case .preferences(let p) = message { return p.sensitiveGroup && delivery == .latestState }
            return false
        })
        let ops = await live.performedOperations()
        XCTAssertTrue(ops.contains { if case .updatePreferences = $0 { return true }; return false })
    }

    func testModeSwitchIsBlockedDuringTrip() async throws {
        let model = makeModel()
        await model.start()
        await model.setMode(.demo)
        await model.startTrip(destinationZoneId: nil)
        await model.setMode(.live)
        XCTAssertEqual(model.mode, .demo)
        await model.endTrip()
        await model.setMode(.live)
        XCTAssertEqual(model.mode, .live)
    }

    func testTripSurvivesRelaunch() async throws {
        let model = makeModel()
        await model.start()
        await model.setMode(.demo)
        await model.startTrip(destinationZoneId: "z-rf")
        clock.advance(minutes: 3)
        await model.pauseTrip()

        let relaunched = makeModel()
        XCTAssertEqual(relaunched.trip?.id, model.trip?.id)
        XCTAssertEqual(relaunched.trip?.phase, .paused)
        XCTAssertEqual(relaunched.mode, .demo)
        await relaunched.start()
        await relaunched.resumeTrip()
        XCTAssertEqual(relaunched.trip?.phase, .active)
        XCTAssertEqual(relaunched.trip?.activeDuration(at: clock.now) ?? 0, 180, accuracy: 0.5)
    }

    func testIdentityChangesOnlyWithItsKey() async throws {
        try requireKeychain(keychain)
        let model = makeModel()
        await model.start()
        let ownId = model.backendSettings.userId
        XCTAssertNotNil(keychain.string(for: KeychainStore.userKeyAccount), "a user key is created on first use")

        await model.handle(.backendSettings(BackendSettings(baseURL: "https://other.example/prod", userId: "phone-user",
                                                            updatedAt: clock.now.addingTimeInterval(60))))
        XCTAssertEqual(model.backendSettings.userId, ownId, "settings alone never switch identity")
        XCTAssertEqual(model.backendSettings.baseURL, "https://other.example/prod")

        let key = BackendCredentials.generateUserKey()
        await model.handle(.credentials(CredentialTransfer(apiKey: "api", userId: "phone-user", userKey: key)))
        XCTAssertEqual(model.backendSettings.userId, "phone-user")
        XCTAssertEqual(keychain.string(for: KeychainStore.userKeyAccount), key)
        XCTAssertTrue(model.hasApiKey)
    }

    func testPushTokenRegistersDevice() async throws {
        let model = makeModel()
        await model.start()
        await model.registerPushToken(Data([0xAB, 0x01]))
        XCTAssertTrue(model.pushRegistered)
    }

    func testRemoteAlertForegroundPresentsSheet() async throws {
        let model = makeModel()
        await model.start()
        let alert = PollutionAlert(id: "remote-1", tripId: nil, zoneId: "z-an", zoneName: "Anand Vihar", aqi: 412, pm25: 250,
                                   kind: .enteredZone, origin: .backend, createdAt: clock.now, scenarioLabel: nil, simulated: true)
        model.receiveRemoteAlert(alert)
        XCTAssertEqual(model.presentedAlertId, "remote-1")
        model.receiveRemoteAlert(alert)
        XCTAssertEqual(model.alerts.filter { $0.id == "remote-1" }.count, 1, "duplicates are merged")
    }
}
