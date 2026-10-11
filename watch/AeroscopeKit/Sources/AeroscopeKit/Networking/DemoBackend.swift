import Foundation

/// In-process implementation of the watch API for the deterministic
/// demonstration mode. It runs the same evaluation, alert and routing code as
/// the offline fallback, against the bundled Delhi dataset and a selectable
/// scenario. Everything it returns is simulated and labelled DEMO by the UI.
public actor DemoBackend: AeroscopeBackend {
    public nonisolated var mode: DataSourceMode { .demo }

    private struct DemoTrip {
        var phase: TripPhase
        var mode: TravelMode
        var plannedZoneIds: [String]
        var destinationZoneId: String?
        var lastEvaluation: Evaluation?
    }

    private let dataset: CityDataset
    private var scenario: Scenario
    private var preferences: AlertPreferences
    private var trips: [String: DemoTrip] = [:]
    private var alerts: [String: PollutionAlert] = [:]
    private var alertOrder: [String] = []
    private var replay: [UUID: OperationResult] = [:]
    private let clock: @Sendable () -> Date

    public init(
        dataset: CityDataset, scenario: Scenario = .demoDefault, preferences: AlertPreferences = .default,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.dataset = dataset
        self.scenario = scenario
        self.preferences = preferences
        self.clock = clock
    }

    public func setScenario(_ scenario: Scenario) { self.scenario = scenario }
    public func currentScenario() -> Scenario { scenario }
    public func setPreferences(_ preferences: AlertPreferences) { self.preferences = preferences }

    /// Restores a trip after an app relaunch so demo events keep working.
    public func adopt(trip: Trip, alerts existing: [PollutionAlert]) {
        guard trip.isOngoing else { return }
        trips[trip.id] = DemoTrip(phase: trip.phase, mode: trip.mode, plannedZoneIds: trip.plannedZoneIds,
                                  destinationZoneId: trip.destinationZoneId, lastEvaluation: nil)
        for alert in existing where alert.tripId == trip.id { store(alert) }
    }

    // MARK: AeroscopeBackend

    public func health() async throws -> HealthResponse {
        HealthResponse(status: "ok", version: "demo", provenance: dataset.provenance, scenario: scenario, push: false, realtime: false)
    }

    public func cityData() async throws -> CityDataResponse {
        CityDataResponse(dataset: dataset, scenario: scenario, generatedAt: clock())
    }

    public func currentReading(_ query: ReadingQuery) async throws -> CurrentReadingResponse {
        let payload = LocationPayload(geo: query.location, zoneId: query.zoneId, world: nil, accuracyMeters: nil, simulated: true)
        let match = try Self.unwrap(TripEvaluator.resolve(payload, in: dataset))
        guard let zone = dataset.zone(id: match.zoneId) else { throw BackendError.notFound("Unknown zone") }
        return CurrentReadingResponse(
            reading: ScenarioEngine.reading(for: zone, scenario: scenario, provenance: dataset.provenance),
            match: match, scenario: scenario, generatedAt: clock()
        )
    }

    public func perform(_ operation: BackendOperation, idempotencyKey: UUID) async throws -> OperationResult {
        if var stored = replay[idempotencyKey] {
            stored.replayed = true
            return stored
        }
        let result = try apply(operation)
        replay[idempotencyKey] = result
        return result
    }

    public func compareRoutes(_ request: RouteCompareRequest) async throws -> RouteComparison {
        guard let comparison = planner().compare(
            from: request.fromZoneId, to: request.toZoneId, mode: request.mode,
            plannedZoneIds: request.plannedZoneIds ?? [], scenarioLabel: scenario.label, now: clock()
        ) else { throw BackendError.notFound("No route between those zones") }
        return comparison
    }

    public func tripStatus(tripId: String) async throws -> TripStatusResponse {
        guard let trip = trips[tripId] else { throw BackendError.notFound("Unknown trip") }
        return TripStatusResponse(
            tripId: tripId, phase: trip.phase, plannedZoneIds: trip.plannedZoneIds, lastEvaluation: trip.lastEvaluation,
            lastEvaluationSource: trip.lastEvaluation == nil ? nil : .device, lastEvaluationAt: trip.lastEvaluation?.dataAsOf,
            alerts: alertOrder.compactMap { alerts[$0] }.filter { $0.tripId == tripId }
        )
    }

    public func recentAlerts(limit: Int) async throws -> [PollutionAlert] {
        Array(alertOrder.reversed().compactMap { alerts[$0] }.prefix(limit))
    }

    public func registerDevice(_ registration: DeviceRegistration) async throws {}

    // MARK: Operations

    private func apply(_ operation: BackendOperation) throws -> OperationResult {
        let now = clock()
        switch operation {
        case .startTrip(let request):
            if let existing = trips[request.tripId] {
                return OperationResult(tripPhase: existing.phase, plannedZoneIds: existing.plannedZoneIds)
            }
            trips[request.tripId] = DemoTrip(phase: .active, mode: request.mode, plannedZoneIds: request.plannedZoneIds,
                                             destinationZoneId: request.destinationZoneId, lastEvaluation: nil)
            let evaluation = try request.origin.map { try evaluate($0, tripId: request.tripId, now: now) }
            return OperationResult(tripPhase: .active, plannedZoneIds: request.plannedZoneIds, evaluation: evaluation,
                                   alert: evaluation?.alert)

        case .tripEvent(let tripId, let event):
            guard var trip = trips[tripId] else { throw BackendError.notFound("Unknown trip") }
            if let deviceAlert = event.deviceAlert { store(deviceAlert) }
            switch event.type {
            case .location:
                guard trip.phase != .ended, let location = event.location else {
                    throw BackendError.rejected(status: 409, message: "Trip is not accepting locations")
                }
                let evaluation = try evaluate(location, tripId: tripId, now: now)
                return OperationResult(tripPhase: trips[tripId]?.phase, evaluation: evaluation, alert: evaluation.alert)
            case .pause:
                guard trip.phase == .active else { throw BackendError.rejected(status: 409, message: "Trip is not active") }
                trip.phase = .paused
            case .resume:
                guard trip.phase == .paused else { throw BackendError.rejected(status: 409, message: "Trip is not paused") }
                trip.phase = .active
            case .end:
                guard trip.phase != .ended else { throw BackendError.rejected(status: 409, message: "Trip already ended") }
                trip.phase = .ended
            }
            trips[tripId] = trip
            return OperationResult(tripPhase: trip.phase)

        case .alertAction(let alertId, let request):
            guard var alert = alerts[alertId] else { throw BackendError.notFound("Unknown alert") }
            var comparison: RouteComparison?
            switch request.action {
            case .acknowledge: alert.status = .acknowledged
            case .dismiss: alert.status = .dismissed
            case .requestRoute:
                alert.status = .rerouteRequested
                if let from = request.currentZoneId, let to = request.destinationZoneId {
                    comparison = planner().compare(from: from, to: to, mode: request.mode ?? .walk,
                                                   plannedZoneIds: request.plannedZoneIds ?? [],
                                                   scenarioLabel: scenario.label, now: now)
                }
            }
            alert.updatedAt = now
            alerts[alertId] = alert
            return OperationResult(alert: alert, routeComparison: comparison)

        case .acceptRoute(let tripId, let request):
            guard var trip = trips[tripId] else { throw BackendError.notFound("Unknown trip") }
            if request.choice == .alternative, !request.zoneIds.isEmpty { trip.plannedZoneIds = request.zoneIds }
            trips[tripId] = trip
            var updated: PollutionAlert?
            if let alertId = request.alertId, var alert = alerts[alertId] {
                alert.status = request.choice == .alternative ? .rerouted : .acknowledged
                alert.updatedAt = now
                alerts[alertId] = alert
                updated = alert
            }
            return OperationResult(tripPhase: trip.phase, plannedZoneIds: trip.plannedZoneIds, alert: updated)

        case .updatePreferences(let prefs):
            preferences = prefs
            return OperationResult()
        }
    }

    private func evaluate(_ location: LocationPayload, tripId: String, now: Date) throws -> Evaluation {
        guard var trip = trips[tripId] else { throw BackendError.notFound("Unknown trip") }
        let history = alertOrder.compactMap { alerts[$0] }.filter { $0.tripId == tripId }.map(\.historyEntry)
        let evaluation = try Self.unwrap(TripEvaluator.evaluate(
            location: location, dataset: dataset, scenario: scenario, dataAsOf: now, preferences: preferences,
            tripId: tripId, tripPhase: trip.phase, plannedZoneIds: trip.plannedZoneIds, history: history,
            origin: .demo, now: now
        ))
        if let alert = evaluation.alert { store(alert) }
        trip.lastEvaluation = evaluation
        trips[tripId] = trip
        return evaluation
    }

    private func store(_ alert: PollutionAlert) {
        if alerts[alert.id] == nil { alertOrder.append(alert.id) }
        alerts[alert.id] = alert
    }

    private func planner() -> RoutePlanner {
        RoutePlanner(dataset: dataset, readings: ScenarioEngine.readings(for: dataset, scenario: scenario))
    }

    private static func unwrap<T>(_ result: Result<T, EvaluationError>) throws -> T {
        switch result {
        case .success(let value): return value
        case .failure(.outsideCoverage(let name, let km)):
            let detail = name.map { n in km.map { " (nearest: \(n), \(Int($0)) km)" } ?? " (nearest: \(n))" } ?? ""
            throw BackendError.outsideCoverage("Outside Delhi coverage\(detail)")
        case .failure(.unknownZone(let id)): throw BackendError.notFound("Unknown zone \(id)")
        case .failure(.noPosition): throw BackendError.rejected(status: 400, message: "No position supplied")
        }
    }
}
