import Foundation
import XCTest
@testable import AeroscopeKit

final class TestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current: Date

    init(_ start: Date = Date(timeIntervalSince1970: 1_800_000_000)) {
        current = start
    }

    var now: Date { lock.withLock { current } }

    func advance(minutes: Double) {
        lock.withLock { current = current.addingTimeInterval(minutes * 60) }
    }

    var closure: @Sendable () -> Date { { [unowned self] in self.now } }
}

@MainActor
final class FakeLocation: LocationProviding {
    var authorization: LocationAuthorization = .authorized
    var onUpdate: ((LocationFix) -> Void)?
    var onAuthorizationChange: ((LocationAuthorization) -> Void)?
    var onFailure: ((String) -> Void)?
    private(set) var authorizationRequests = 0
    private(set) var fixRequests = 0
    private(set) var tripUpdatesActive = false

    func requestAuthorization() { authorizationRequests += 1 }
    func requestFix() { fixRequests += 1 }
    func startTripUpdates() { tripUpdatesActive = true }
    func stopTripUpdates() { tripUpdatesActive = false }
}

@MainActor
final class FakeNotifier: AlertNotifying {
    var status: NotificationAuthorization = .authorized
    private(set) var delivered: [PollutionAlert] = []
    private(set) var removed: [String] = []

    func authorizationStatus() async -> NotificationAuthorization { status }
    func requestAuthorization() async -> NotificationAuthorization { status }
    func deliver(_ alert: PollutionAlert) async { delivered.append(alert) }
    func removeDelivered(alertId: String) { removed.append(alertId) }
}

@MainActor
final class FakeHaptics: HapticsPlaying {
    private(set) var played: [HapticKind] = []
    func play(_ kind: HapticKind) { played.append(kind) }
}

@MainActor
final class FakeConnectivity: ConnectivitySending {
    var isCounterpartAvailable = true
    private(set) var sent: [(ConnectivityMessage, ConnectivityDelivery)] = []

    func send(_ message: ConnectivityMessage, delivery: ConnectivityDelivery) {
        sent.append((message, delivery))
    }

    var relayedActions: [PendingAction] {
        sent.flatMap { message, _ -> [PendingAction] in
            if case .pendingActions(let actions) = message { return actions }
            return []
        }
    }
}

/// A "live" backend for tests: the demo engine behind a switchable network.
actor FakeLiveBackend: AeroscopeBackend {
    nonisolated var mode: DataSourceMode { .live }

    private let engine: DemoBackend
    private var online = true
    private(set) var performed: [(UUID, BackendOperation)] = []
    var permanentFailure: BackendError?

    init(dataset: CityDataset, clock: @escaping @Sendable () -> Date) {
        engine = DemoBackend(dataset: dataset, scenario: .demoDefault, clock: clock)
    }

    func setOnline(_ value: Bool) { online = value }
    func setPermanentFailure(_ error: BackendError?) { permanentFailure = error }
    func performedOperations() -> [BackendOperation] { performed.map(\.1) }
    func performedKeys() -> [UUID] { performed.map(\.0) }

    private func check() throws {
        if !online { throw BackendError.offline("test offline") }
    }

    func health() async throws -> HealthResponse { try check(); return try await engine.health() }
    func cityData() async throws -> CityDataResponse { try check(); return try await engine.cityData() }
    func currentReading(_ query: ReadingQuery) async throws -> CurrentReadingResponse {
        try check()
        return try await engine.currentReading(query)
    }
    func perform(_ operation: BackendOperation, idempotencyKey: UUID) async throws -> OperationResult {
        try check()
        if let permanentFailure { throw permanentFailure }
        performed.append((idempotencyKey, operation))
        return try await engine.perform(operation, idempotencyKey: idempotencyKey)
    }
    func compareRoutes(_ request: RouteCompareRequest) async throws -> RouteComparison {
        try check()
        return try await engine.compareRoutes(request)
    }
    func tripStatus(tripId: String) async throws -> TripStatusResponse { try check(); return try await engine.tripStatus(tripId: tripId) }
    func recentAlerts(limit: Int) async throws -> [PollutionAlert] { try check(); return try await engine.recentAlerts(limit: limit) }
    func registerDevice(_ registration: DeviceRegistration) async throws { try check() }
}

func makeTempStore() -> FileStore {
    FileStore(directory: FileManager.default.temporaryDirectory
        .appendingPathComponent("aeroscope-tests-\(UUID().uuidString)", isDirectory: true))
}

func fix(at zoneId: String, in dataset: CityDataset, time: Date, simulated: Bool = false) -> LocationFix {
    LocationFix(point: dataset.zone(id: zoneId)!.geo!, at: time, accuracyMeters: 10, simulated: simulated)
}

/// SwiftPM test bundles on the iOS/watchOS simulator have no keychain entitlement
/// (errSecMissingEntitlement); the signed apps do. Skip keychain-backed tests there.
func requireKeychain(_ keychain: KeychainStore) throws {
    do {
        try keychain.set("probe", for: "aeroscope.tests.probe")
        try keychain.set(nil, for: "aeroscope.tests.probe")
    } catch {
        throw XCTSkip("Keychain unavailable in this test host: \(error)")
    }
}
