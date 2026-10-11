import Foundation
import Observation

public struct RelayLogEntry: Codable, Hashable, Sendable, Identifiable {
    public enum Outcome: String, Codable, Sendable {
        case delivered
        case rejected
        case waiting
    }

    public var id: UUID
    public var at: Date
    public var summary: String
    public var outcome: Outcome
    public var detail: String?
}

public enum ConnectionCheck: Hashable, Sendable {
    case notConfigured
    case unknown
    case checking
    case ok(HealthResponse, checkedAt: Date)
    case failed(String, checkedAt: Date)
}

/// State and behaviour of the iPhone companion: backend connection, alert
/// preferences, demo remote control, watch status, and relaying actions the
/// watch could not deliver itself.
@MainActor
@Observable
public final class CompanionModel {
    public struct Dependencies {
        public var store: FileStore
        public var keychain: KeychainStore
        public var connectivity: ConnectivitySending?
        public var makeLiveBackend: (BackendSettings, TokenStore) -> (any AeroscopeBackend)?
        public var clock: @Sendable () -> Date
        public var defaultBaseURL: String?

        public init(
            store: FileStore, keychain: KeychainStore, connectivity: ConnectivitySending?,
            makeLiveBackend: @escaping (BackendSettings, TokenStore) -> (any AeroscopeBackend)? = { settings, tokens in
                LiveBackendClient(settings: settings, tokens: tokens)
            },
            clock: @escaping @Sendable () -> Date = { Date() }, defaultBaseURL: String? = nil
        ) {
            self.store = store
            self.keychain = keychain
            self.connectivity = connectivity
            self.makeLiveBackend = makeLiveBackend
            self.clock = clock
            self.defaultBaseURL = defaultBaseURL
        }
    }

    enum Keys {
        static let backendSettings = "companion.backendSettings"
        static let preferences = "companion.preferences"
        static let watchSummary = "companion.watchSummary"
        static let relayLog = "companion.relayLog"
        static let relayQueue = "companion.relayQueue"
    }

    public private(set) var backendSettings: BackendSettings
    /// The iPhone's own session (iPhone sign-in UI is not part of this build).
    public var hasApiKey: Bool { false }
    public private(set) var connection: ConnectionCheck = .unknown
    public private(set) var preferences: AlertPreferences
    public private(set) var watchSummary: WatchSummary?
    public private(set) var backendAlerts: [PollutionAlert] = []
    public private(set) var relayLog: [RelayLogEntry]
    public let relay: SyncQueue

    @ObservationIgnored private let deps: Dependencies
    @ObservationIgnored private var backend: (any AeroscopeBackend)?
    @ObservationIgnored private var tokens: TokenStore?

    public init(dependencies deps: Dependencies) {
        self.deps = deps
        let store = deps.store
        let settings = store.load(BackendSettings.self, key: Keys.backendSettings)
            ?? BackendSettings(baseURL: deps.defaultBaseURL, updatedAt: deps.clock())
        backendSettings = settings
        preferences = store.load(AlertPreferences.self, key: Keys.preferences) ?? .default
        watchSummary = store.load(WatchSummary.self, key: Keys.watchSummary)
        relayLog = store.load([RelayLogEntry].self, key: Keys.relayLog) ?? []
        relay = SyncQueue(store: store, key: Keys.relayQueue)
        let tokenStore = TokenStore(keychain: deps.keychain, clock: deps.clock)
        tokens = tokenStore
        backend = deps.makeLiveBackend(settings, tokenStore)
        connection = settings.isConfigured ? .unknown : .notConfigured
        store.save(settings, key: Keys.backendSettings)
    }

    public var now: Date { deps.clock() }

    public func start() async {
        // The watch adopts these if they are newer than its own copy.
        deps.connectivity?.send(.backendSettings(backendSettings), delivery: .latestState)
        deps.connectivity?.send(.preferences(preferences), delivery: .latestState)
        deps.connectivity?.send(.requestSummary, delivery: .immediate)
        if backendSettings.isConfigured { await testConnection() }
        await flushRelay()
        await refreshActivity()
    }

    // MARK: Backend connection

    /// Validates a backend URL. HTTPS is required except for local development hosts.
    nonisolated public static func validate(baseURL raw: String) -> String? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased(), let host = url.host?.lowercased() else {
            return "Enter a full URL, e.g. https://abc123.execute-api.ap-south-1.amazonaws.com/prod"
        }
        if scheme == "https" { return nil }
        let isLocal = host == "localhost" || host.hasSuffix(".local") || host.hasPrefix("127.")
            || host.hasPrefix("192.168.") || host.hasPrefix("10.")
        if scheme == "http" && isLocal { return nil }
        return "Use HTTPS. Plain HTTP is only allowed for a local development server."
    }

    /// Saves the connection, stores the key in the Keychain and shares both with the watch.
    @discardableResult
    public func saveBackend(baseURL: String, apiKey: String? = nil) async -> String? {
        if let problem = Self.validate(baseURL: baseURL) { return problem }
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        backendSettings = BackendSettings(baseURL: trimmed.isEmpty ? nil : trimmed, updatedAt: now)
        deps.store.save(backendSettings, key: Keys.backendSettings)
        if let tokens { backend = deps.makeLiveBackend(backendSettings, tokens) }
        deps.connectivity?.send(.backendSettings(backendSettings), delivery: .latestState)
        connection = backendSettings.isConfigured ? .unknown : .notConfigured
        if backendSettings.isConfigured {
            await testConnection()
            _ = await submitPreferences()
        }
        return nil
    }


    public func testConnection() async {
        guard let backend else {
            connection = .notConfigured
            return
        }
        connection = .checking
        do {
            connection = .ok(try await backend.health(), checkedAt: now)
        } catch {
            connection = .failed(BackendError.from(error).userMessage, checkedAt: now)
        }
    }

    public func refreshActivity() async {
        guard let backend else { return }
        if let alerts = try? await backend.recentAlerts(limit: 20) { backendAlerts = alerts }
    }

    // MARK: Preferences

    public func updatePreferences(_ change: (inout AlertPreferences) -> Void) async {
        var updated = preferences
        change(&updated)
        updated.updatedAt = now
        guard updated != preferences else { return }
        preferences = updated
        deps.store.save(updated, key: Keys.preferences)
        deps.connectivity?.send(.preferences(updated), delivery: .latestState)
        _ = await submitPreferences()
    }

    private func submitPreferences() async -> Bool {
        guard backend != nil else { return false }
        relay.enqueue(PendingAction(operation: .updatePreferences(preferences), createdAt: now))
        await flushRelay()
        return true
    }

    // MARK: Demo & watch

    public func send(_ command: DemoCommand) {
        deps.connectivity?.send(.demoCommand(command), delivery: .immediate)
    }

    public func requestWatchSummary() {
        deps.connectivity?.send(.requestSummary, delivery: .immediate)
    }

    public func handle(_ message: ConnectivityMessage) async {
        switch message {
        case .watchSummary(let summary):
            guard summary.generatedAt >= (watchSummary?.generatedAt ?? .distantPast) else { return }
            watchSummary = summary
            deps.store.save(summary, key: Keys.watchSummary)
        case .preferences(let incoming):
            guard incoming.updatedAt > preferences.updatedAt else { return }
            preferences = incoming
            deps.store.save(incoming, key: Keys.preferences)
        case .pendingActions(let actions):
            for action in actions where relay.enqueue(action) {
                log(action, .waiting, detail: "Received from watch")
            }
            await flushRelay()
        case .backendSettings, .pairingCode, .demoCommand, .actionResults, .requestSummary:
            return
        }
    }

    // MARK: Relay

    /// Delivers relayed watch actions with this phone's connection and tells
    /// the watch which ones are done so it can drop them from its own queue.
    public func flushRelay() async {
        guard relay.count > 0, let backend else { return }
        let actions = Dictionary(uniqueKeysWithValues: relay.queue.actions.map { ($0.id, $0) })
        let outcome = await relay.flush(using: backend, now: deps.clock)
        for (id, _) in outcome.delivered { if let a = actions[id] { log(a, .delivered, detail: nil) } }
        for (id, error) in outcome.dropped { if let a = actions[id] { log(a, .rejected, detail: error.userMessage) } }
        let done = Array(outcome.delivered.keys) + Array(outcome.dropped.keys)
        if !done.isEmpty {
            deps.connectivity?.send(.actionResults(delivered: Array(outcome.delivered.keys), dropped: Array(outcome.dropped.keys)),
                                    delivery: .guaranteed)
        }
    }

    private func log(_ action: PendingAction, _ outcome: RelayLogEntry.Outcome, detail: String?) {
        relayLog.insert(RelayLogEntry(id: UUID(), at: now, summary: action.operation.summary, outcome: outcome, detail: detail), at: 0)
        if relayLog.count > 30 { relayLog.removeLast(relayLog.count - 30) }
        deps.store.save(relayLog, key: Keys.relayLog)
    }
}
