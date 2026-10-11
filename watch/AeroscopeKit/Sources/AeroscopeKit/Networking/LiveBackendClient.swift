import Foundation

/// HTTPS client for the AEROSCOPE API on API Gateway. Every call carries the
/// signed-in user's Cognito access token; a 401 triggers one refresh and retry.
public struct LiveBackendClient: AeroscopeBackend {
    /// Performs one HTTP exchange. Injected so tests can stub responses on
    /// every platform (watchOS ignores custom `URLProtocol` classes).
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, URLResponse)
    /// A valid access token, or throws `AuthError.signInRequired`.
    public typealias TokenProvider = @Sendable () async throws -> String

    public var mode: DataSourceMode { .live }

    private let baseURL: URL
    private let accessToken: TokenProvider
    private let refreshToken: TokenProvider?
    private let transport: Transport
    private let timeout: TimeInterval

    public init(baseURL: URL, accessToken: @escaping TokenProvider, refreshToken: TokenProvider? = nil, timeout: TimeInterval = 8,
                transport: @escaping Transport = { try await URLSession.shared.data(for: $0) }) {
        self.baseURL = baseURL
        self.accessToken = accessToken
        self.refreshToken = refreshToken
        self.timeout = timeout
        self.transport = transport
    }

    /// A client for the configured URL that uses (and refreshes) the session in `tokens`.
    public init?(settings: BackendSettings, tokens: TokenStore) {
        guard let url = settings.url else { return nil }
        self.init(baseURL: url, accessToken: { try await tokens.accessToken() }, refreshToken: { try await tokens.refreshed().accessToken })
    }

    // MARK: AeroscopeBackend

    public func health() async throws -> HealthResponse {
        try await send("GET", "v1/health", auth: false)
    }

    public func cityData() async throws -> CityDataResponse {
        try await send("GET", "v1/city", auth: false)
    }

    public func currentReading(_ query: ReadingQuery) async throws -> CurrentReadingResponse {
        var items: [URLQueryItem] = []
        if let p = query.location {
            items.append(URLQueryItem(name: "lat", value: String(format: "%.6f", p.lat)))
            items.append(URLQueryItem(name: "lon", value: String(format: "%.6f", p.lon)))
        }
        if let zoneId = query.zoneId { items.append(URLQueryItem(name: "zoneId", value: zoneId)) }
        return try await send("GET", "v1/air-quality/current", query: items, auth: false)
    }

    public func perform(_ operation: BackendOperation, idempotencyKey: UUID) async throws -> OperationResult {
        let key = idempotencyKey.uuidString
        switch operation {
        case .startTrip(let body):
            return try await send("POST", "v1/trips", body: body, idempotencyKey: key)
        case .tripEvent(let tripId, let body):
            return try await send("POST", "v1/trips/\(escape(tripId))/events", body: body, idempotencyKey: key)
        case .alertAction(let alertId, let body):
            return try await send("POST", "v1/alerts/\(escape(alertId))/actions", body: body, idempotencyKey: key)
        case .acceptRoute(let tripId, let body):
            return try await send("POST", "v1/trips/\(escape(tripId))/route", body: body, idempotencyKey: key)
        case .updatePreferences(let body):
            return try await send("PUT", "v1/preferences", body: body, idempotencyKey: key)
        }
    }

    public func compareRoutes(_ request: RouteCompareRequest) async throws -> RouteComparison {
        try await send("POST", "v1/routes/compare", body: request)
    }

    public func tripStatus(tripId: String) async throws -> TripStatusResponse {
        try await send("GET", "v1/trips/\(escape(tripId))")
    }

    public func activeTrip() async throws -> TripStatusResponse? {
        let response: ActiveTripResponse = try await send("GET", "v1/trips/active")
        return response.trip
    }

    public func recentAlerts(limit: Int) async throws -> [PollutionAlert] {
        let response: AlertsResponse = try await send("GET", "v1/alerts", query: [URLQueryItem(name: "limit", value: String(limit))])
        return response.alerts
    }

    public func registerDevice(_ registration: DeviceRegistration) async throws {
        let _: EmptyResponse = try await send("PUT", "v1/devices/\(escape(registration.deviceId))", body: registration)
    }

    // MARK: Transport

    private struct EmptyResponse: Decodable {}
    private struct ActiveTripResponse: Decodable {
        var trip: TripStatusResponse?
    }
    private struct NoBody: Encodable {}
    private struct ErrorBody: Decodable {
        var error: String?
        var code: String?
    }

    private func escape(_ segment: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return segment.addingPercentEncoding(withAllowedCharacters: allowed) ?? segment
    }

    /// Exposed for tests: the request a call would send.
    func makeRequest(_ method: String, _ path: String, query: [URLQueryItem] = [], body: Data? = nil,
                     idempotencyKey: String? = nil, token: String? = nil) throws -> URLRequest {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw BackendError.transport("Invalid backend URL")
        }
        // `path` segments are already percent-encoded by `escape`.
        let basePath = components.percentEncodedPath.hasSuffix("/")
            ? String(components.percentEncodedPath.dropLast()) : components.percentEncodedPath
        components.percentEncodedPath = basePath + "/" + path
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw BackendError.transport("Invalid URL for \(path)") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        // The backend pushes alerts only for requests that did not come
        // straight from the watch (which already shows them in-app).
        request.setValue(Self.clientPlatform, forHTTPHeaderField: "x-aeroscope-client")
        if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    private func send<Response: Decodable>(_ method: String, _ path: String, query: [URLQueryItem] = [], auth: Bool = true) async throws -> Response {
        try await send(method, path, query: query, body: Optional<NoBody>.none, idempotencyKey: nil, auth: auth)
    }

    private func send<Body: Encodable, Response: Decodable>(
        _ method: String, _ path: String, query: [URLQueryItem] = [], body: Body?, idempotencyKey: String? = nil, auth: Bool = true
    ) async throws -> Response {
        let data = try body.map { try AeroscopeJSON.encoder().encode($0) }
        // Public routes work signed out; user routes need a session.
        let token: String?
        do { token = try await accessToken() } catch {
            if auth { throw BackendError.unauthorized }
            token = nil
        }
        var (responseData, http) = try await exchange(try makeRequest(method, path, query: query, body: data, idempotencyKey: idempotencyKey, token: token))
        // An expired or revoked access token: refresh once and retry with the new one.
        if http.statusCode == 401, token != nil, let refreshToken {
            guard let fresh = try? await refreshToken() else { throw BackendError.unauthorized }
            (responseData, http) = try await exchange(try makeRequest(method, path, query: query, body: data, idempotencyKey: idempotencyKey, token: fresh))
        }
        guard (200..<300).contains(http.statusCode) else {
            throw Self.error(status: http.statusCode, body: responseData)
        }
        if Response.self == EmptyResponse.self, responseData.isEmpty { return EmptyResponse() as! Response }
        do {
            return try AeroscopeJSON.decoder().decode(Response.self, from: responseData.isEmpty ? Data("{}".utf8) : responseData)
        } catch {
            throw BackendError.decoding(String(describing: error))
        }
    }

    private func exchange(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let responseData: Data
        let response: URLResponse
        do {
            (responseData, response) = try await transport(request)
        } catch {
            throw BackendError.from(error)
        }
        guard let http = response as? HTTPURLResponse else { throw BackendError.transport("Non-HTTP response") }
        return (responseData, http)
    }

    static var clientPlatform: String {
        #if os(watchOS)
        "watchOS"
        #elseif os(iOS)
        "iOS"
        #else
        "other"
        #endif
    }

    static func error(status: Int, body: Data) -> BackendError {
        let parsed = try? JSONDecoder().decode(ErrorBody.self, from: body)
        let message = parsed?.error ?? ""
        switch status {
        case 401, 403: return .unauthorized
        case 404 where parsed?.code == "outside-coverage": return .outsideCoverage(message)
        case 404: return .notFound(message)
        case 408: return .offline("Request timed out")
        case 429: return .rateLimited
        case 400..<500: return .rejected(status: status, message: message)
        default: return .server(status: status, message: message)
        }
    }
}
