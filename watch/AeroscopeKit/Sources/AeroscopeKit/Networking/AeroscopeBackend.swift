import Foundation

/// The AEROSCOPE API. `LiveBackendClient` talks HTTPS to API Gateway (Cognito bearer tokens);
/// `DemoBackend` runs the same contract in-process for deterministic demos.
public protocol AeroscopeBackend: Sendable {
    var mode: DataSourceMode { get }

    func health() async throws -> HealthResponse
    func cityData() async throws -> CityDataResponse
    func currentReading(_ query: ReadingQuery) async throws -> CurrentReadingResponse
    func perform(_ operation: BackendOperation, idempotencyKey: UUID) async throws -> OperationResult
    func compareRoutes(_ request: RouteCompareRequest) async throws -> RouteComparison
    func tripStatus(tripId: String) async throws -> TripStatusResponse
    /// The user's newest trip that hasn't ended (possibly started on the dashboard), or nil.
    func activeTrip() async throws -> TripStatusResponse?
    func recentAlerts(limit: Int) async throws -> [PollutionAlert]
    func registerDevice(_ registration: DeviceRegistration) async throws
}

/// Connection settings shared between the iPhone and the watch. No secrets:
/// each device keeps its own sign-in session in its Keychain.
public struct BackendSettings: Codable, Hashable, Sendable {
    /// API base URL (the `ApiUrl` stack output), e.g. https://abc123.execute-api.us-east-1.amazonaws.com
    public var baseURL: String?
    public var updatedAt: Date

    public init(baseURL: String?, updatedAt: Date) {
        self.baseURL = baseURL
        self.updatedAt = updatedAt
    }

    public var url: URL? {
        guard let raw = baseURL?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty,
              let url = URL(string: raw), let scheme = url.scheme?.lowercased(),
              scheme == "https" || scheme == "http", url.host != nil else { return nil }
        return url
    }

    public var isConfigured: Bool { url != nil }

    public var hostLabel: String? { url?.host }
}
