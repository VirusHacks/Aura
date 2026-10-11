import Foundation

/// The AEROSCOPE watch API. `LiveBackendClient` talks HTTPS to API Gateway;
/// `DemoBackend` runs the same contract in-process for deterministic demos.
public protocol AeroscopeBackend: Sendable {
    var mode: DataSourceMode { get }

    func health() async throws -> HealthResponse
    func cityData() async throws -> CityDataResponse
    func currentReading(_ query: ReadingQuery) async throws -> CurrentReadingResponse
    func perform(_ operation: BackendOperation, idempotencyKey: UUID) async throws -> OperationResult
    func compareRoutes(_ request: RouteCompareRequest) async throws -> RouteComparison
    func tripStatus(tripId: String) async throws -> TripStatusResponse
    func recentAlerts(limit: Int) async throws -> [PollutionAlert]
    func registerDevice(_ registration: DeviceRegistration) async throws
}

/// Secrets for the watch API, kept in the Keychain.
public struct BackendCredentials: Hashable, Sendable {
    /// API Gateway usage-plan key (`x-api-key`).
    public var apiKey: String?
    /// Per-installation secret (`x-aeroscope-user-key`). The backend pins its
    /// hash to the user id on first use, so a user id alone cannot be impersonated.
    public var userKey: String?

    public init(apiKey: String?, userKey: String?) {
        self.apiKey = apiKey
        self.userKey = userKey
    }

    /// 256 random bits, hex encoded.
    public static func generateUserKey() -> String {
        var rng = SystemRandomNumberGenerator()
        return (0..<4).map { _ in String(format: "%016llx", rng.next() as UInt64) }.joined()
    }
}

/// Connection settings shared between the iPhone and the watch. Secrets are
/// never stored here; they live in the Keychain.
public struct BackendSettings: Codable, Hashable, Sendable {
    /// API Gateway stage URL, e.g. https://abc123.execute-api.ap-south-1.amazonaws.com/prod
    public var baseURL: String?
    /// Stable per-installation user id until Cognito sign-in is added.
    public var userId: String
    public var updatedAt: Date

    public init(baseURL: String?, userId: String, updatedAt: Date) {
        self.baseURL = baseURL
        self.userId = userId
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
