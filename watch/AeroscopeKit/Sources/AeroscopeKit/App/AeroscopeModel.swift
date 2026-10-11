import Foundation
import Observation
import os

/// Cached city data from the live backend, for offline estimates.
public struct CityCache: Codable, Hashable, Sendable {
    public var dataset: CityDataset
    public var scenario: Scenario
    public var fetchedAt: Date

    public init(dataset: CityDataset, scenario: Scenario, fetchedAt: Date) {
        self.dataset = dataset
        self.scenario = scenario
        self.fetchedAt = fetchedAt
    }
}

/// The watch app's state and behaviour. Views read its properties and call
/// its intents; platform services are injected through `Dependencies` so the
/// whole workflow is unit-testable without a device.
@MainActor
@Observable
public final class AeroscopeModel {
    public struct Dependencies {
        public var store: FileStore
        public var keychain: KeychainStore
        public var location: LocationProviding
        public var notifier: AlertNotifying
        public var haptics: HapticsPlaying
        public var connectivity: ConnectivitySending?
        public var dataset: CityDataset
        public var makeLiveBackend: (BackendSettings, BackendCredentials) -> (any AeroscopeBackend)?
        public var clock: @Sendable () -> Date
        public var demoStepInterval: Duration
        /// Seed for the backend URL (from the build configuration), used until the iPhone sends one.
        public var defaultBaseURL: String?
        public var deviceId: String
        public var bundleId: String
        public var apnsEnvironment: String
        public var requestPushRegistration: () -> Void

        public init(
            store: FileStore, keychain: KeychainStore, location: LocationProviding, notifier: AlertNotifying,
            haptics: HapticsPlaying, connectivity: ConnectivitySending?, dataset: CityDataset,
            makeLiveBackend: @escaping (BackendSettings, BackendCredentials) -> (any AeroscopeBackend)? = { settings, credentials in
                LiveBackendClient(settings: settings, credentials: credentials)
            },
            clock: @escaping @Sendable () -> Date = { Date() }, demoStepInterval: Duration = .seconds(8),
            defaultBaseURL: String? = nil, deviceId: String, bundleId: String, apnsEnvironment: String = "sandbox",
            requestPushRegistration: @escaping () -> Void = {}
        ) {
            self.store = store
            self.keychain = keychain
            self.location = location
            self.notifier = notifier
            self.haptics = haptics
            self.connectivity = connectivity
            self.dataset = dataset
            self.makeLiveBackend = makeLiveBackend
            self.clock = clock
            self.demoStepInterval = demoStepInterval
            self.defaultBaseURL = defaultBaseURL
            self.deviceId = deviceId
            self.bundleId = bundleId
            self.apnsEnvironment = apnsEnvironment
            self.requestPushRegistration = requestPushRegistration
        }
    }

    enum Keys {
        static let mode = "mode"
        static func snapshot(_ mode: DataSourceMode) -> String { "snapshot.\(mode.rawValue)" }
        static let trip = "trip"
        static let recentTrips = "recentTrips"
        static let alerts = "alerts"
        static let preferences = "preferences"
        static let backendSettings = "backendSettings"
        static let cityCache = "cityCache"
        static let demoScenario = "demoScenario"
        static let pushToken = "pushToken"
        static let pendingActions = "pendingActions"
    }

    static let maxAlerts = 40
    static let maxRecentTrips = 10
    static let cityCacheMaxAge: TimeInterval = 6 * 3600
    static let fixReuseWindow: TimeInterval = 120
    static let refreshInterval: TimeInterval = 5 * 60
    static let relayRetryAfter: TimeInterval = 30 * 60
    static let offlineNotice = "Saved offline · will sync"
    private static let log = Logger(subsystem: "com.aeroscope", category: "Model")

    // MARK: Observable state

    public private(set) var mode: DataSourceMode
    public private(set) var snapshot: ReadingSnapshot?
    public private(set) var issue: ReadingIssue?
    public private(set) var isRefreshing = false
    public private(set) var trip: Trip?
    public private(set) var recentTrips: [TripSummary]
    public private(set) var alerts: [PollutionAlert]
    public var presentedAlertId: String?
    public private(set) var routeState: RouteState = .idle
    public private(set) var preferences: AlertPreferences
    public private(set) var backendSettings: BackendSettings
    public private(set) var hasApiKey: Bool
    public private(set) var locationAuthorization: LocationAuthorization
    public private(set) var notificationAuthorization: NotificationAuthorization = .notDetermined
    public private(set) var cityCache: CityCache?
    public private(set) var demoScenario: Scenario
    public private(set) var demoJourney: DemoJourney?
    public private(set) var pushRegistered = false
    public private(set) var lastFix: LocationFix?
    /// Short, transient status line (e.g. "Saved offline · will sync").
    public private(set) var notice: String?
    public var isForeground = true
    public let sync: SyncQueue

    // MARK: Private

    @ObservationIgnored private let deps: Dependencies
    @ObservationIgnored private let demoBackend: DemoBackend
    @ObservationIgnored private var liveBackend: (any AeroscopeBackend)?
    @ObservationIgnored private var pushToken: String?
    @ObservationIgnored private var inFlight: Set<UUID> = []
    @ObservationIgnored private var demoTask: Task<Void, Never>?
    @ObservationIgnored private var started = false

    public init(dependencies deps: Dependencies) {
        self.deps = deps
        let store = deps.store
        let storedTrip = store.load(Trip.self, key: Keys.trip)
        // An ongoing trip pins the mode it was started in.
        let initialMode = storedTrip?.source ?? store.load(DataSourceMode.self, key: Keys.mode) ?? .live
        let initialPreferences = store.load(AlertPreferences.self, key: Keys.preferences) ?? .default
        let initialScenario = store.load(Scenario.self, key: Keys.demoScenario) ?? .demoDefault
        let settings = store.load(BackendSettings.self, key: Keys.backendSettings)
            ?? BackendSettings(baseURL: deps.defaultBaseURL, userId: UUID().uuidString, updatedAt: Date(timeIntervalSince1970: 0))
        let restored = store.load(ReadingSnapshot.self, key: Keys.snapshot(initialMode)).map(\.restored)

        mode = initialMode
        trip = storedTrip
        recentTrips = store.load([TripSummary].self, key: Keys.recentTrips) ?? []
        alerts = store.load([PollutionAlert].self, key: Keys.alerts) ?? []
        preferences = initialPreferences
        backendSettings = settings
        cityCache = store.load(CityCache.self, key: Keys.cityCache)
        demoScenario = initialScenario
        pushToken = store.load(String.self, key: Keys.pushToken)
        hasApiKey = deps.keychain.string(for: KeychainStore.apiKeyAccount) != nil
        locationAuthorization = deps.location.authorization
        snapshot = restored?.source == initialMode ? restored : nil
        sync = SyncQueue(store: store, key: Keys.pendingActions)
        demoBackend = DemoBackend(dataset: deps.dataset, scenario: initialScenario, preferences: initialPreferences, clock: deps.clock)
        rebuildLiveBackend()
        store.save(settings, key: Keys.backendSettings)
    }

    // MARK: Derived

    public var presentedAlert: PollutionAlert? { presentedAlertId.flatMap { id in alerts.first { $0.id == id } } }
    public var pendingActionCount: Int { sync.count }
    public var isBackendConfigured: Bool { backendSettings.isConfigured }
    public var now: Date { deps.clock() }
    public var lastSyncError: String? { sync.lastError?.userMessage }

    /// The dataset used for zone geometry, names and routing. AQI values in
    /// live mode never come from the bundled demo baselines.
    public var dataset: CityDataset {
        mode == .live ? (cityCache?.dataset ?? deps.dataset) : deps.dataset
    }

    public var destinationChoices: [ZoneBaseline] { dataset.zones.sorted { $0.name < $1.name } }

    public func zoneName(_ id: String?) -> String? { id.flatMap { dataset.zone(id: $0)?.name } }

    public var plannedRouteNames: [String] { trip?.plannedZoneIds.compactMap { zoneName($0) } ?? [] }

    /// True when the snapshot's position is recent enough to call "current".
    public func snapshotLocationIsCurrent(at date: Date) -> Bool {
        guard let fixAt = snapshot?.location?.at else { return false }
        return date.timeIntervalSince(fixAt) < 5 * 60
    }

    public var openAlertCount: Int { alerts.filter(\.isOpen).count }

    // MARK: Lifecycle

    public func start() async {
        guard !started else { return }
        started = true
        deps.location.onUpdate = { [weak self] fix in self?.handleFix(fix) }
        deps.location.onAuthorizationChange = { [weak self] auth in self?.handleAuthorizationChange(auth) }
        deps.location.onFailure = { [weak self] message in self?.handleLocationFailure(message) }
        sync.onDelivered = { [weak self] action, result in self?.handleBacklogDelivery(action, result) }
        notificationAuthorization = await deps.notifier.authorizationStatus()
        if notificationAuthorization == .authorized { deps.requestPushRegistration() }
        await demoBackend.setScenario(demoScenario)
        await demoBackend.setPreferences(preferences)

        if let trip, trip.isOngoing {
            if trip.source == .demo {
                await demoBackend.adopt(trip: trip, alerts: alerts)
                demoJourney = resumedJourney(for: trip)
                if trip.phase == .active { startDemoTicker() }
            } else if trip.phase == .active {
                deps.location.startTripUpdates()
            }
        }
        await refresh()
        publishSummary()
    }

    /// Foreground housekeeping: keeps the reading fresh and the queue moving.
    public func runForegroundLoop() async {
        while !Task.isCancelled {
            await refreshIfDue()
            try? await Task.sleep(for: .seconds(60))
        }
    }

    public func refreshIfDue() async {
        if mode == .live, trip?.phase == .active {
            await flushQueue()
            await pollTripStatus()
        }
        let age = snapshot.map { now.timeIntervalSince($0.fetchedAt) } ?? .infinity
        if age > Self.refreshInterval { await refresh() }
    }

    /// Background app refresh: update the reading, sync, pick up server-side alerts.
    public func backgroundRefresh() async {
        await refresh()
        await pollTripStatus()
        publishSummary()
    }

    // MARK: Reading

    public func refresh() async {
        guard !isRefreshing else { return }
        isRefreshing = true
        defer { isRefreshing = false }

        switch mode {
        case .demo:
            let point = demoJourney?.current ?? demoOrigin
            await refreshReading(at: LocationFix(point: point, at: now, accuracyMeters: 5, simulated: true))
        case .live:
            await flushQueue()
            await refreshCityCacheIfNeeded()
            switch locationAuthorization {
            case .notDetermined:
                issue = .locationNotDetermined
                deps.location.requestAuthorization()
            case .denied, .restricted, .servicesDisabled:
                issue = .locationDenied
            case .authorized:
                if let fix = lastFix, now.timeIntervalSince(fix.at) < Self.fixReuseWindow {
                    await refreshReading(at: fix)
                } else {
                    if snapshot == nil { issue = .locationUnavailable }
                    deps.location.requestFix()
                }
            }
        }
    }

    private func refreshReading(at fix: LocationFix) async {
        if mode == .live && liveBackend == nil {
            issue = .backendNotConfigured
            return
        }
        let backend: any AeroscopeBackend = mode == .demo ? demoBackend : liveBackend!
        do {
            let response = try await backend.currentReading(ReadingQuery(location: fix.point))
            setSnapshot(ReadingSnapshot(
                reading: response.reading, source: mode, obtainedAs: mode == .demo ? .demo : .live,
                dataAsOf: response.generatedAt, fetchedAt: now, location: fix, world: response.match.world,
                scenarioLabel: response.scenario?.label
            ))
            issue = nil
        } catch {
            handleReadingError(BackendError.from(error), fix: fix)
        }
    }

    private func handleReadingError(_ error: BackendError, fix: LocationFix?) {
        switch error {
        case .outsideCoverage(let message):
            issue = .outsideCoverage(message.isEmpty ? "AEROSCOPE covers Delhi. Try Demo mode elsewhere." : message)
        case .notConfigured:
            issue = .backendNotConfigured
        case _ where error.isRetryable:
            if let fix, let estimate = offlineSnapshot(for: fix) { setSnapshot(estimate) }
            issue = .offline
        default:
            issue = .backendError(error.userMessage)
        }
    }

    /// Estimate from backend data cached earlier. Labelled CACHED, timed at the cache time.
    private func offlineSnapshot(for fix: LocationFix) -> ReadingSnapshot? {
        guard mode == .live, let cache = cityCache else { return nil }
        guard case .inside(let match) = ZoneLocator(dataset: cache.dataset).locate(fix.point),
              let zone = cache.dataset.zone(id: match.zoneId) else { return nil }
        return ReadingSnapshot(
            reading: ScenarioEngine.reading(for: zone, scenario: cache.scenario, provenance: cache.dataset.provenance),
            source: .live, obtainedAs: .cached, dataAsOf: cache.fetchedAt, fetchedAt: now, location: fix,
            world: match.world, scenarioLabel: cache.scenario.label
        )
    }

    private func refreshCityCacheIfNeeded() async {
        guard mode == .live, let backend = liveBackend else { return }
        if let cache = cityCache, now.timeIntervalSince(cache.fetchedAt) < Self.cityCacheMaxAge { return }
        guard let response = try? await backend.cityData() else { return }
        let cache = CityCache(dataset: response.dataset.enriched(from: deps.dataset), scenario: response.scenario,
                              fetchedAt: response.generatedAt)
        cityCache = cache
        deps.store.save(cache, key: Keys.cityCache)
    }

    private func setSnapshot(_ value: ReadingSnapshot) {
        // A reading from one source never stands in for the other.
        guard value.source == mode else { return }
        snapshot = value
        deps.store.save(value, key: Keys.snapshot(mode))
    }

    // MARK: Location

    private func handleFix(_ fix: LocationFix) {
        guard mode == .live else { return }
        lastFix = fix
        Task { await process(fix) }
    }

    /// Routes a real position fix: a trip event while travelling, otherwise a reading refresh.
    func process(_ fix: LocationFix) async {
        guard mode == .live else { return }
        lastFix = fix
        if let trip, trip.phase == .active { await submitLocation(fix) } else { await refreshReading(at: fix) }
    }

    private func handleAuthorizationChange(_ authorization: LocationAuthorization) {
        let wasAuthorized = locationAuthorization.isAuthorized
        locationAuthorization = authorization
        if authorization.isAuthorized && !wasAuthorized && mode == .live {
            deps.location.requestFix()
            if trip?.phase == .active { deps.location.startTripUpdates() }
        } else if !authorization.isAuthorized && mode == .live {
            issue = authorization == .notDetermined ? .locationNotDetermined : .locationDenied
        }
        publishSummary()
    }

    private func handleLocationFailure(_ message: String) {
        guard mode == .live else { return }
        Self.log.info("Location failure: \(message, privacy: .public)")
        if snapshot == nil || !snapshotLocationIsCurrent(at: now) { issue = .locationUnavailable }
    }

    public func requestLocationPermission() {
        deps.location.requestAuthorization()
    }

    public func requestNotificationPermission() async {
        notificationAuthorization = await deps.notifier.requestAuthorization()
        if notificationAuthorization == .authorized { deps.requestPushRegistration() }
        publishSummary()
    }

    func locate(_ point: GeoPoint) -> ZoneMatch? {
        if case .inside(let match) = ZoneLocator(dataset: dataset).locate(point) { return match }
        return nil
    }

    private func payload(for fix: LocationFix) -> LocationPayload {
        let locator = ZoneLocator(dataset: dataset)
        let match: ZoneMatch? = if case .inside(let m) = locator.locate(fix.point) { m } else { nil }
        return LocationPayload(geo: fix.point, zoneId: match?.zoneId, world: match?.world ?? locator.world(for: fix.point),
                               accuracyMeters: fix.accuracyMeters, simulated: fix.simulated)
    }

    // MARK: Trip

    public func startTrip(destinationZoneId: String?) async {
        guard trip?.isOngoing != true else { return }
        if notificationAuthorization == .notDetermined { await requestNotificationPermission() }

        let startedAt = now
        let originFix: LocationFix? = mode == .demo
            ? LocationFix(point: demoJourney?.current ?? demoOrigin, at: startedAt, accuracyMeters: 5, simulated: true)
            : lastFix.flatMap { startedAt.timeIntervalSince($0.at) < 600 ? $0 : nil }
        let originZoneId = originFix.flatMap { locate($0.point)?.zoneId }
        var planned: [String] = []
        if let origin = originZoneId, let destination = destinationZoneId {
            planned = RoutePlanner(dataset: dataset, aqiByZone: [:]).path(from: origin, to: destination, kind: .fastest) ?? []
        }
        let newTrip = Trip.start(
            at: startedAt, source: mode, mode: preferences.travelMode, originZoneId: originZoneId,
            destinationZoneId: destinationZoneId, destinationName: zoneName(destinationZoneId), plannedZoneIds: planned
        )
        trip = newTrip
        routeState = .idle
        saveTrip()
        deps.haptics.play(.start)

        if mode == .demo {
            demoJourney = DemoJourney(zoneIds: demoRoute(for: newTrip, from: originZoneId), dataset: deps.dataset)
            startDemoTicker()
        } else {
            deps.location.startTripUpdates()
        }

        let request = StartTripRequest(
            tripId: newTrip.id, startedAt: startedAt, mode: newTrip.mode, source: mode,
            origin: originFix.map(payload(for:)), destinationZoneId: destinationZoneId, plannedZoneIds: planned
        )
        switch await submit(.startTrip(request)) {
        case .delivered(let result):
            if let evaluation = result.evaluation { applyEvaluation(evaluation, fix: originFix, fresh: true) }
        case .queued(let actionId):
            if let originFix { evaluateOffline(fix: originFix, actionId: actionId) }
        case .rejected(let error):
            notice = "Trip saved on watch · \(error.userMessage)"
        }
        publishSummary()
    }

    public func pauseTrip() async {
        guard var current = trip, current.phase == .active else { return }
        let at = now
        do { try current.pause(at: at) } catch { return }
        trip = current
        saveTrip()
        stopDemoTicker()
        if mode == .live { deps.location.stopTripUpdates() }
        deps.haptics.play(.stop)
        _ = await submit(.tripEvent(tripId: current.id, event: TripEventRequest(type: .pause, at: at)))
        publishSummary()
    }

    public func resumeTrip() async {
        guard var current = trip, current.phase == .paused else { return }
        let at = now
        do { try current.resume(at: at) } catch { return }
        trip = current
        saveTrip()
        if mode == .demo { startDemoTicker() } else { deps.location.startTripUpdates() }
        deps.haptics.play(.start)
        _ = await submit(.tripEvent(tripId: current.id, event: TripEventRequest(type: .resume, at: at)))
        publishSummary()
    }

    public func endTrip() async {
        guard var current = trip, current.isOngoing else { return }
        let at = now
        do { try current.end(at: at) } catch { return }
        recentTrips.insert(TripSummary(trip: current, endedAt: at), at: 0)
        if recentTrips.count > Self.maxRecentTrips { recentTrips.removeLast(recentTrips.count - Self.maxRecentTrips) }
        deps.store.save(recentTrips, key: Keys.recentTrips)
        trip = nil
        saveTrip()
        routeState = .idle
        stopDemoTicker()
        if mode == .live { deps.location.stopTripUpdates() }
        deps.haptics.play(.stop)
        _ = await submit(.tripEvent(tripId: current.id, event: TripEventRequest(type: .end, at: at)))
        publishSummary()
    }

    private func submitLocation(_ fix: LocationFix) async {
        guard let current = trip, current.isOngoing else { return }
        let event = TripEventRequest(type: .location, at: fix.at, location: payload(for: fix))
        switch await submit(.tripEvent(tripId: current.id, event: event)) {
        case .delivered(let result):
            if let evaluation = result.evaluation { applyEvaluation(evaluation, fix: fix, fresh: true) }
        case .queued(let actionId):
            evaluateOffline(fix: fix, actionId: actionId)
        case .rejected(let error):
            handleReadingError(error, fix: fix)
        }
        publishSummary()
    }

    private func applyEvaluation(_ evaluation: Evaluation, fix: LocationFix?, fresh: Bool) {
        setSnapshot(ReadingSnapshot(
            reading: evaluation.reading, source: mode, obtainedAs: mode == .demo ? .demo : .live,
            dataAsOf: evaluation.dataAsOf, fetchedAt: now, location: fix, world: evaluation.match.world,
            scenarioLabel: evaluation.scenario?.label
        ))
        issue = nil
        recordSample(match: evaluation.match, aqi: evaluation.reading.aqi, at: fix?.at ?? evaluation.dataAsOf,
                     geo: fix?.point, simulated: fix?.simulated ?? evaluation.reading.simulated)
        if let alert = evaluation.alert { receive(alert, present: fresh) }
    }

    /// Offline path: evaluate from cached backend data and attach any alert to
    /// the queued event so the backend records the same alert id on sync.
    private func evaluateOffline(fix: LocationFix, actionId: UUID) {
        if liveBackend == nil {
            issue = .backendNotConfigured
            notice = "Saved on watch · connect a backend to sync"
        } else {
            issue = .offline
            notice = Self.offlineNotice
        }
        guard let cache = cityCache, let current = trip else { return }
        let result = TripEvaluator.evaluate(
            location: payload(for: fix), dataset: cache.dataset, scenario: cache.scenario, dataAsOf: cache.fetchedAt,
            preferences: preferences, tripId: current.id, tripPhase: current.phase, plannedZoneIds: current.plannedZoneIds,
            history: history(for: current.id), origin: .device, now: now
        )
        guard case .success(let evaluation) = result else { return }
        setSnapshot(ReadingSnapshot(
            reading: evaluation.reading, source: .live, obtainedAs: .cached, dataAsOf: cache.fetchedAt, fetchedAt: now,
            location: fix, world: evaluation.match.world, scenarioLabel: cache.scenario.label
        ))
        recordSample(match: evaluation.match, aqi: evaluation.reading.aqi, at: fix.at, geo: fix.point, simulated: fix.simulated)
        if let alert = evaluation.alert {
            sync.attach(deviceAlert: alert, to: actionId)
            receive(alert, present: true)
        }
    }

    private func recordSample(match: ZoneMatch, aqi: Int, at: Date, geo: GeoPoint?, simulated: Bool) {
        guard var current = trip, current.isOngoing else { return }
        if let last = current.lastSample, at < last.at { return }
        try? current.record(TripSample(at: at, zoneId: match.zoneId, zoneName: match.zoneName, aqi: aqi, geo: geo,
                                       world: match.world, simulated: simulated))
        trip = current
        saveTrip()
    }

    private func history(for tripId: String) -> [AlertHistoryEntry] {
        alerts.filter { $0.tripId == tripId }.map(\.historyEntry)
    }

    /// Picks up alerts and simulated moves the backend produced on its own
    /// (e.g. a demo operator moving the avatar from the dashboard).
    public func pollTripStatus() async {
        guard mode == .live, let current = trip, current.isOngoing, let backend = liveBackend, sync.count == 0 else { return }
        guard let status = try? await backend.tripStatus(tripId: current.id) else { return }
        for alert in status.alerts.sorted(by: { $0.createdAt < $1.createdAt }) {
            receive(alert, present: alert.isOpen && now.timeIntervalSince(alert.createdAt) < 300)
        }
        if status.lastEvaluationSource == .operator, let evaluation = status.lastEvaluation,
           let at = status.lastEvaluationAt, at > (trip?.lastSample?.at ?? .distantPast) {
            applyEvaluation(evaluation, fix: nil, fresh: false)
        }
    }

    // MARK: Alerts

    private func receive(_ alert: PollutionAlert, present: Bool) {
        if let i = alerts.firstIndex(where: { $0.id == alert.id }) {
            // Keep a locally newer status (an action may still be queued).
            if (alert.updatedAt ?? alert.createdAt) >= (alerts[i].updatedAt ?? alerts[i].createdAt) { alerts[i] = alert }
            saveAlerts()
            return
        }
        alerts.insert(alert, at: 0)
        if alerts.count > Self.maxAlerts { alerts.removeLast(alerts.count - Self.maxAlerts) }
        if var current = trip, alert.tripId == current.id {
            current.attach(alertId: alert.id)
            trip = current
            saveTrip()
        }
        saveAlerts()
        guard present, alert.isOpen else { return }
        if isForeground {
            presentedAlertId = alert.id
            deps.haptics.play(.alert)
        } else {
            let notifier = deps.notifier
            Task { await notifier.deliver(alert) }
        }
    }

    /// A pushed alert (remote notification) received while the app runs.
    public func receiveRemoteAlert(_ alert: PollutionAlert) {
        receive(alert, present: true)
    }

    private func updateAlert(_ id: String, status: AlertStatus) {
        guard let i = alerts.firstIndex(where: { $0.id == id }) else { return }
        alerts[i].status = status
        alerts[i].updatedAt = now
        saveAlerts()
    }

    public func acknowledge(alertId: String) async {
        updateAlert(alertId, status: .acknowledged)
        deps.notifier.removeDelivered(alertId: alertId)
        if presentedAlertId == alertId { presentedAlertId = nil }
        if routeState.alertId == alertId { routeState = .idle }
        deps.haptics.play(.success)
        _ = await submit(.alertAction(alertId: alertId, request: AlertActionRequest(action: .acknowledge, at: now)))
        publishSummary()
    }

    public func dismiss(alertId: String) async {
        updateAlert(alertId, status: .dismissed)
        deps.notifier.removeDelivered(alertId: alertId)
        if presentedAlertId == alertId { presentedAlertId = nil }
        if routeState.alertId == alertId { routeState = .idle }
        _ = await submit(.alertAction(alertId: alertId, request: AlertActionRequest(action: .dismiss, at: now)))
        publishSummary()
    }

    public func requestRoute(alertId: String) async {
        guard alerts.contains(where: { $0.id == alertId }) else { return }
        updateAlert(alertId, status: .rerouteRequested)
        deps.notifier.removeDelivered(alertId: alertId)
        routeState = .loading(alertId: alertId)
        let currentZone = trip?.lastSample?.zoneId ?? snapshot?.reading.zoneId

        guard let current = trip, current.isOngoing, let destination = current.destinationZoneId, let from = currentZone else {
            routeState = .noDestination(currentZone.flatMap { localNeighbor(of: $0) }, alertId: alertId)
            _ = await submit(.alertAction(alertId: alertId, request: AlertActionRequest(action: .requestRoute, at: now)))
            return
        }
        let request = AlertActionRequest(action: .requestRoute, at: now, mode: current.mode, currentZoneId: from,
                                         destinationZoneId: destination, plannedZoneIds: current.plannedZoneIds)
        switch await submit(.alertAction(alertId: alertId, request: request)) {
        case .delivered(let result):
            if let comparison = result.routeComparison {
                routeState = .loaded(comparison, alertId: alertId, offlineEstimate: false)
            } else if let comparison = localComparison(from: from, to: destination) {
                routeState = .loaded(comparison, alertId: alertId, offlineEstimate: mode == .live)
            } else {
                routeState = .failed("No route available", alertId: alertId)
            }
        case .queued, .rejected:
            if let comparison = localComparison(from: from, to: destination) {
                routeState = .loaded(comparison, alertId: alertId, offlineEstimate: mode == .live)
            } else {
                routeState = .failed("Route comparison needs a connection", alertId: alertId)
            }
        }
    }

    public func chooseRoute(_ comparison: RouteComparison, choice: RouteChoice) async {
        guard var current = trip, current.isOngoing else {
            routeState = .idle
            return
        }
        let option = choice == .alternative ? (comparison.alternative ?? comparison.current) : comparison.current
        let alertId = routeState.alertId
        if choice == .alternative, comparison.alternative != nil {
            let prefix = current.plannedZoneIds.prefix { $0 != option.zoneIds.first }
            current.replan(zoneIds: Array(prefix) + option.zoneIds)
            trip = current
            saveTrip()
            if mode == .demo { demoJourney?.reroute(zoneIds: option.zoneIds, dataset: deps.dataset) }
        }
        if let alertId { updateAlert(alertId, status: choice == .alternative ? .rerouted : .acknowledged) }
        routeState = .idle
        if presentedAlertId == alertId { presentedAlertId = nil }
        deps.haptics.play(.success)
        let request = AcceptRouteRequest(routeId: option.id, choice: choice, zoneIds: option.zoneIds, alertId: alertId, at: now)
        _ = await submit(.acceptRoute(tripId: current.id, request: request))
        publishSummary()
    }

    public func closeRoute() {
        routeState = .idle
    }

    /// Readings for local route maths: demo scenario, or cached backend data.
    private func localReadings() -> (CityDataset, [String: ZoneReading], String)? {
        switch mode {
        case .demo:
            return (deps.dataset, ScenarioEngine.readings(for: deps.dataset, scenario: demoScenario), demoScenario.label)
        case .live:
            guard let cache = cityCache else { return nil }
            return (cache.dataset, ScenarioEngine.readings(for: cache.dataset, scenario: cache.scenario), cache.scenario.label)
        }
    }

    private func localComparison(from: String, to: String) -> RouteComparison? {
        guard let (data, readings, label) = localReadings() else { return nil }
        return RoutePlanner(dataset: data, readings: readings)
            .compare(from: from, to: to, mode: trip?.mode ?? preferences.travelMode,
                     plannedZoneIds: trip?.plannedZoneIds ?? [], scenarioLabel: label, now: now)
    }

    private func localNeighbor(of zoneId: String) -> NeighborSuggestion? {
        guard let (data, readings, _) = localReadings() else { return nil }
        return RoutePlanner(dataset: data, readings: readings).cleanerNeighbor(of: zoneId, mode: preferences.travelMode)
    }

    public func handleNotificationAction(_ action: NotificationAction, alert: PollutionAlert?) async {
        guard let alert else { return }
        receive(alert, present: false)
        switch action {
        case .acknowledge: await acknowledge(alertId: alert.id)
        case .reroute:
            presentedAlertId = alert.id
            await requestRoute(alertId: alert.id)
        case .open: presentedAlertId = alert.id
        case .dismiss: break
        }
    }

    // MARK: Preferences & settings

    public func updatePreferences(_ change: (inout AlertPreferences) -> Void) async {
        var updated = preferences
        change(&updated)
        updated.updatedAt = now
        guard updated != preferences else { return }
        preferences = updated
        deps.store.save(updated, key: Keys.preferences)
        deps.connectivity?.send(.preferences(updated), delivery: .latestState)
        await demoBackend.setPreferences(updated)
        if mode == .live { _ = await submit(.updatePreferences(updated)) }
    }

    public func setMode(_ newMode: DataSourceMode) async {
        guard newMode != mode, trip?.isOngoing != true else { return }
        stopDemoTicker()
        mode = newMode
        deps.store.save(newMode, key: Keys.mode)
        // Each mode has its own last reading; a demo reading never appears as cached live data.
        snapshot = deps.store.load(ReadingSnapshot.self, key: Keys.snapshot(newMode)).map(\.restored)
        if snapshot?.source != newMode { snapshot = nil }
        issue = nil
        routeState = .idle
        presentedAlertId = nil
        demoJourney = nil
        notice = nil
        await refresh()
        publishSummary()
    }

    // MARK: Demo

    private var demoOrigin: GeoPoint {
        deps.dataset.zone(id: DemoJourney.defaultOriginZoneId)?.geo ?? GeoPoint(lat: 28.5931, lon: 77.2197)
    }

    /// The zones the simulated position follows during a demo trip.
    private func demoRoute(for trip: Trip, from origin: String?) -> [String] {
        trip.plannedZoneIds.isEmpty ? defaultDemoRoute(from: origin) : trip.plannedZoneIds
    }

    /// Without a destination the simulated position follows the default demo route.
    private func defaultDemoRoute(from origin: String?) -> [String] {
        let start = origin ?? DemoJourney.defaultOriginZoneId
        let goal = start == DemoJourney.defaultDestinationZoneId ? DemoJourney.defaultOriginZoneId : DemoJourney.defaultDestinationZoneId
        return RoutePlanner(dataset: deps.dataset, aqiByZone: [:]).path(from: start, to: goal, kind: .fastest) ?? [start]
    }

    private func resumedJourney(for trip: Trip) -> DemoJourney {
        var route = demoRoute(for: trip, from: trip.originZoneId)
        if let here = trip.lastSample?.zoneId, let i = route.firstIndex(of: here) { route = Array(route[i...]) }
        return DemoJourney(zoneIds: route, dataset: deps.dataset)
    }

    private func startDemoTicker() {
        demoTask?.cancel()
        let interval = deps.demoStepInterval
        demoTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: interval)
                guard !Task.isCancelled, let self else { return }
                await self.demoStep()
            }
        }
    }

    private func stopDemoTicker() {
        demoTask?.cancel()
        demoTask = nil
    }

    /// Moves the simulated position one step (also the iPhone's "Advance" control).
    public func demoStep() async {
        guard mode == .demo else { return }
        if demoJourney == nil {
            demoJourney = trip.map(resumedJourney(for:))
                ?? DemoJourney(zoneIds: defaultDemoRoute(from: nil), dataset: deps.dataset)
        }
        guard var journey = demoJourney, let point = journey.advance() else { return }
        demoJourney = journey
        let fix = LocationFix(point: point, at: now, accuracyMeters: 5, simulated: true)
        if let trip, trip.phase == .active {
            await submitLocation(fix)
            if journey.isFinished {
                stopDemoTicker()
                notice = trip.destinationName.map { "Arrived at \($0)" } ?? "Demo route complete"
            }
        } else {
            await refreshReading(at: fix)
        }
    }

    public func restartDemoJourney() async {
        guard mode == .demo else { return }
        if let trip, trip.isOngoing {
            demoJourney = DemoJourney(zoneIds: demoRoute(for: trip, from: trip.originZoneId), dataset: deps.dataset)
            if trip.phase == .active { startDemoTicker() }
        } else {
            demoJourney = nil
        }
        notice = nil
        await refresh()
    }

    public func setDemoScenario(_ scenario: Scenario) async {
        demoScenario = scenario
        deps.store.save(scenario, key: Keys.demoScenario)
        await demoBackend.setScenario(scenario)
        if mode == .demo { await refresh() }
        publishSummary()
    }

    // MARK: Backend submission & sync

    enum SubmitOutcome {
        case delivered(OperationResult)
        case queued(UUID)
        case rejected(BackendError)
    }

    private func submit(_ operation: BackendOperation) async -> SubmitOutcome {
        let action = PendingAction(operation: operation, createdAt: now)
        if mode == .demo {
            do { return .delivered(try await demoBackend.perform(operation, idempotencyKey: action.id)) }
            catch { return .rejected(BackendError.from(error)) }
        }
        sync.enqueue(action)
        inFlight.insert(action.id)
        defer { inFlight.remove(action.id) }
        await flushQueue()
        switch sync.result(for: action.id) {
        case .success(let result)?: return .delivered(result)
        case .failure(let error)?: return .rejected(error)
        case nil: return .queued(action.id)
        }
    }

    public func flushQueue() async {
        guard mode == .live, sync.count > 0 else { return }
        guard let backend = liveBackend else {
            relayPendingActionsToPhone()
            return
        }
        let outcome = await sync.flush(using: backend, now: deps.clock)
        if let blocked = outcome.blockedBy, blocked.canRelayThroughPhone { relayPendingActionsToPhone() }
        if outcome.blockedBy == nil, !outcome.delivered.isEmpty, notice == Self.offlineNotice { notice = nil }
    }

    /// Hands undelivered actions to the iPhone, which has its own connection.
    private func relayPendingActionsToPhone() {
        guard let connectivity = deps.connectivity, connectivity.isCounterpartAvailable else { return }
        let cutoff = now.addingTimeInterval(-Self.relayRetryAfter)
        let actions = sync.queue.actions.filter { ($0.relayedViaPhoneAt ?? .distantPast) < cutoff }
        guard !actions.isEmpty else { return }
        connectivity.send(.pendingActions(actions), delivery: .immediate)
        sync.markRelayed(ids: Set(actions.map(\.id)), at: now)
    }

    /// Results of actions delivered by an earlier flush (backlog), not by the call that queued them.
    private func handleBacklogDelivery(_ action: PendingAction, _ result: OperationResult) {
        guard !inFlight.contains(action.id) else { return }
        if let alert = result.alert ?? result.evaluation?.alert {
            receive(alert, present: now.timeIntervalSince(alert.createdAt) < 120)
        }
    }

    private func rebuildLiveBackend() {
        let credentials = deps.keychain.loadCredentials()
        hasApiKey = credentials.apiKey != nil
        liveBackend = deps.makeLiveBackend(backendSettings, credentials)
    }

    // MARK: Push

    public func registerPushToken(_ token: Data) async {
        let hex = token.map { String(format: "%02x", $0) }.joined()
        pushToken = hex
        deps.store.save(hex, key: Keys.pushToken)
        await registerDeviceIfPossible()
    }

    private func registerDeviceIfPossible() async {
        guard let token = pushToken, let backend = liveBackend else { return }
        do {
            try await backend.registerDevice(DeviceRegistration(
                deviceId: deps.deviceId, token: token, platform: "watchOS", environment: deps.apnsEnvironment,
                bundleId: deps.bundleId
            ))
            pushRegistered = true
        } catch {
            pushRegistered = false
            Self.log.info("Device registration failed: \(BackendError.from(error).userMessage, privacy: .public)")
        }
        publishSummary()
    }

    // MARK: Connectivity

    public func handle(_ message: ConnectivityMessage) async {
        switch message {
        case .preferences(let incoming):
            guard incoming.updatedAt > preferences.updatedAt else { return }
            preferences = incoming
            deps.store.save(incoming, key: Keys.preferences)
            await demoBackend.setPreferences(incoming)
        case .backendSettings(let incoming):
            guard incoming.updatedAt > backendSettings.updatedAt else { return }
            // The user id changes only together with its key (`.credentials`).
            backendSettings = BackendSettings(baseURL: incoming.baseURL, userId: backendSettings.userId, updatedAt: incoming.updatedAt)
            deps.store.save(backendSettings, key: Keys.backendSettings)
            cityCache = nil
            deps.store.remove(key: Keys.cityCache)
            rebuildLiveBackend()
            await registerDeviceIfPossible()
            if mode == .live { await refresh() }
        case .credentials(let transfer):
            do {
                try deps.keychain.set(transfer.apiKey, for: KeychainStore.apiKeyAccount)
                try deps.keychain.set(transfer.userKey, for: KeychainStore.userKeyAccount)
            } catch {
                Self.log.error("Could not store credentials from iPhone: \(String(describing: error), privacy: .public)")
                return
            }
            backendSettings.userId = transfer.userId
            deps.store.save(backendSettings, key: Keys.backendSettings)
            rebuildLiveBackend()
            await registerDeviceIfPossible()
            if mode == .live { await refresh() }
        case .demoCommand(let command):
            switch command {
            case .setMode(let newMode): await setMode(newMode)
            case .setScenario(let scenario): await setDemoScenario(scenario)
            case .advance: await demoStep()
            case .restartJourney: await restartDemoJourney()
            }
        case .actionResults(let delivered, let dropped):
            sync.remove(ids: Set(delivered + dropped))
        case .requestSummary:
            break
        case .pendingActions, .watchSummary:
            return
        }
        publishSummary()
    }

    public var summary: WatchSummary {
        WatchSummary(
            generatedAt: now, mode: mode, snapshot: snapshot, trip: trip, recentTrips: recentTrips,
            recentAlerts: Array(alerts.prefix(10)), pendingActionCount: sync.count,
            locationAuthorization: locationAuthorization, notificationAuthorization: notificationAuthorization,
            pushRegistered: pushRegistered, lastSyncAt: sync.lastDeliveredAt, lastSyncError: lastSyncError,
            demoScenario: demoScenario
        )
    }

    public func publishSummary() {
        deps.connectivity?.send(.watchSummary(summary), delivery: .latestState)
    }

    // MARK: Persistence

    private func saveTrip() { deps.store.save(trip, key: Keys.trip) }
    private func saveAlerts() { deps.store.save(alerts, key: Keys.alerts) }
}
