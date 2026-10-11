import Foundation

/// Tokens from Amazon Cognito (or a local dev server). The refresh token is
/// stored only in this device's Keychain and is never sent over WatchConnectivity.
public struct AuthTokens: Codable, Hashable, Sendable {
    public var accessToken: String
    public var idToken: String
    public var refreshToken: String?
    public var expiresAt: Date
    /// Cognito username (used for refresh and watch pairing).
    public var username: String
    public var email: String?
    public var sub: String?
    /// Local dev server token (`dev.<id>`): identifies, does not authenticate.
    public var isDev: Bool

    public init(accessToken: String, idToken: String, refreshToken: String?, expiresAt: Date, username: String,
                email: String?, sub: String?, isDev: Bool = false) {
        self.accessToken = accessToken
        self.idToken = idToken
        self.refreshToken = refreshToken
        self.expiresAt = expiresAt
        self.username = username
        self.email = email
        self.sub = sub
        self.isDev = isDev
    }

    /// True when the access token should be refreshed before use.
    public func needsRefresh(at date: Date) -> Bool { !isDev && expiresAt.timeIntervalSince(date) < 120 }

    /// Reads `sub`, `email` and `cognito:username` from a JWT's payload (display and bookkeeping only;
    /// the backend verifies signatures).
    static func claims(of jwt: String) -> [String: Any] {
        let parts = jwt.split(separator: ".")
        guard parts.count >= 2 else { return [:] }
        var b64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
        return object
    }

    static func from(result: CognitoClient.AuthenticationResult, fallbackRefresh: String?, username: String, now: Date) -> AuthTokens {
        let claims = claims(of: result.IdToken)
        return AuthTokens(
            accessToken: result.AccessToken, idToken: result.IdToken, refreshToken: result.RefreshToken ?? fallbackRefresh,
            expiresAt: now.addingTimeInterval(TimeInterval(result.ExpiresIn)),
            username: (claims["cognito:username"] as? String) ?? username,
            email: claims["email"] as? String, sub: claims["sub"] as? String
        )
    }

    static func dev(_ token: String, username: String, email: String?, now: Date) -> AuthTokens {
        AuthTokens(accessToken: token, idToken: token, refreshToken: nil, expiresAt: now.addingTimeInterval(86_400 * 30),
                   username: username, email: email, sub: String(token.dropFirst(4)), isDev: true)
    }
}

public enum AuthError: Error, Hashable, Sendable {
    /// No session, or it could not be refreshed: the user must sign in (pair) again.
    case signInRequired
    case rejected(String)
    case network(String)

    public var userMessage: String {
        switch self {
        case .signInRequired: "Sign in required"
        case .rejected(let m): m
        case .network(let m): m
        }
    }
}

/// `GET /v1/client-config`: public identifiers needed to sign in.
public struct ClientConfig: Codable, Hashable, Sendable {
    public struct Cognito: Codable, Hashable, Sendable {
        public var userPoolId: String
        public var webClientId: String
        public var iosClientId: String
        public var watchClientId: String
    }

    public var region: String
    public var cognito: Cognito
    public var webUrl: String?

    /// The local dev server has no Cognito.
    public var isDevServer: Bool { cognito.userPoolId.isEmpty }
}

/// Minimal Amazon Cognito user pools client (public app clients, no secret).
public struct CognitoClient: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, URLResponse)

    public struct AuthenticationResult: Codable, Hashable, Sendable {
        public var AccessToken: String
        public var IdToken: String
        public var RefreshToken: String?
        public var ExpiresIn: Int
    }

    struct InitiateResponse: Decodable {
        var AuthenticationResult: AuthenticationResult?
        var ChallengeName: String?
        var Session: String?
    }

    public let region: String
    public let clientId: String
    private let transport: Transport

    public init(region: String, clientId: String, transport: @escaping Transport = { try await URLSession.shared.data(for: $0) }) {
        self.region = region
        self.clientId = clientId
        self.transport = transport
    }

    func makeRequest(target: String, body: [String: Any]) throws -> URLRequest {
        guard let url = URL(string: "https://cognito-idp.\(region).amazonaws.com/") else { throw AuthError.network("Invalid region") }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
        request.httpMethod = "POST"
        request.setValue("application/x-amz-json-1.1", forHTTPHeaderField: "Content-Type")
        request.setValue("AWSCognitoIdentityProviderService.\(target)", forHTTPHeaderField: "X-Amz-Target")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return request
    }

    private func call<T: Decodable>(_ target: String, _ body: [String: Any]) async throws -> T {
        let request = try makeRequest(target: target, body: body)
        let data: Data
        let response: URLResponse
        do { (data, response) = try await transport(request) } catch { throw AuthError.network(BackendError.from(error).userMessage) }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let type = (json?["__type"] as? String)?.split(separator: "#").last.map(String.init) ?? "Error"
            if type == "NotAuthorizedException" { throw AuthError.signInRequired }
            throw AuthError.rejected(Self.message(for: type, fallback: json?["message"] as? String))
        }
        do { return try JSONDecoder().decode(T.self, from: data) } catch { throw AuthError.network("Unexpected sign-in response") }
    }

    static func message(for type: String, fallback: String?) -> String {
        switch type {
        case "UserNotFoundException": "Incorrect email or password."
        case "UserNotConfirmedException": "Confirm your email first (use the dashboard)."
        case "TooManyRequestsException", "LimitExceededException": "Too many attempts. Try again in a minute."
        default: fallback ?? "Sign-in failed (\(type))."
        }
    }

    /// iPhone: email + password (USER_PASSWORD_AUTH, over TLS).
    public func signIn(email: String, password: String, now: Date) async throws -> AuthTokens {
        let res: InitiateResponse = try await call("InitiateAuth", [
            "AuthFlow": "USER_PASSWORD_AUTH", "ClientId": clientId,
            "AuthParameters": ["USERNAME": email, "PASSWORD": password],
        ])
        guard let result = res.AuthenticationResult else { throw AuthError.rejected("Additional sign-in step required (\(res.ChallengeName ?? "unknown")).") }
        return AuthTokens.from(result: result, fallbackRefresh: nil, username: email, now: now)
    }

    /// Watch: CUSTOM_AUTH answered with the pairing proof `<pairingId>.<secret>`.
    public func signInWithPairing(username: String, answer: String, now: Date) async throws -> AuthTokens {
        let start: InitiateResponse = try await call("InitiateAuth", [
            "AuthFlow": "CUSTOM_AUTH", "ClientId": clientId, "AuthParameters": ["USERNAME": username],
        ])
        guard start.ChallengeName == "CUSTOM_CHALLENGE", let session = start.Session else {
            throw AuthError.rejected("Pairing sign-in is not available.")
        }
        let res: InitiateResponse = try await call("RespondToAuthChallenge", [
            "ChallengeName": "CUSTOM_CHALLENGE", "ClientId": clientId, "Session": session,
            "ChallengeResponses": ["USERNAME": username, "ANSWER": answer],
        ])
        guard let result = res.AuthenticationResult else { throw AuthError.rejected("The pairing was not accepted. Get a new code.") }
        return AuthTokens.from(result: result, fallbackRefresh: nil, username: username, now: now)
    }

    public func refresh(_ tokens: AuthTokens, now: Date) async throws -> AuthTokens {
        guard let refreshToken = tokens.refreshToken else { throw AuthError.signInRequired }
        let res: InitiateResponse = try await call("InitiateAuth", [
            "AuthFlow": "REFRESH_TOKEN_AUTH", "ClientId": clientId, "AuthParameters": ["REFRESH_TOKEN": refreshToken],
        ])
        guard let result = res.AuthenticationResult else { throw AuthError.signInRequired }
        return AuthTokens.from(result: result, fallbackRefresh: refreshToken, username: tokens.username, now: now)
    }

    /// Ends the session: revoking the refresh token invalidates tokens issued from it.
    public func revoke(_ tokens: AuthTokens) async {
        guard let refreshToken = tokens.refreshToken else { return }
        let _: [String: String]? = try? await call("RevokeToken", ["ClientId": clientId, "Token": refreshToken])
    }
}

/// Holds the session; hands out a valid access token, refreshing when needed.
public actor TokenStore {
    public typealias Refresher = @Sendable (AuthTokens) async throws -> AuthTokens

    private let keychain: KeychainStore
    private let clock: @Sendable () -> Date
    private var tokens: AuthTokens?
    private var refresher: Refresher?
    private var inFlight: Task<AuthTokens, Error>?

    public init(keychain: KeychainStore, clock: @escaping @Sendable () -> Date) {
        self.keychain = keychain
        self.clock = clock
        self.tokens = keychain.loadTokens()
    }

    public var current: AuthTokens? { tokens }

    public func setRefresher(_ refresher: Refresher?) { self.refresher = refresher }

    public func save(_ new: AuthTokens?) {
        tokens = new
        try? keychain.saveTokens(new)
    }

    /// A usable access token, or `AuthError.signInRequired`.
    public func accessToken() async throws -> String {
        guard let tokens else { throw AuthError.signInRequired }
        guard tokens.needsRefresh(at: clock()) else { return tokens.accessToken }
        return try await refreshed().accessToken
    }

    /// Forces a refresh (after a 401). Clears the session if the refresh token is no longer valid.
    @discardableResult
    public func refreshed() async throws -> AuthTokens {
        if let inFlight { return try await inFlight.value }
        guard let tokens, let refresher else { throw AuthError.signInRequired }
        let task = Task { try await refresher(tokens) }
        inFlight = task
        defer { inFlight = nil }
        do {
            let new = try await task.value
            save(new)
            return new
        } catch AuthError.signInRequired {
            save(nil)
            throw AuthError.signInRequired
        }
    }
}

// MARK: Watch pairing

public struct PairingStart: Codable, Hashable, Sendable {
    public var pairingId: String
    public var code: String
    public var secret: String
    public var expiresAt: Date
}

public struct PairingStatus: Codable, Hashable, Sendable {
    public enum State: String, Codable, Sendable {
        case pending, approved, consumed, expired
    }

    public var status: State
    public var username: String?
    public var email: String?
    /// Local dev server only.
    public var devToken: String?
}

/// The watch side of pairing: ask for a code, then wait for the user to approve it.
public struct PairingClient: Sendable {
    public typealias Transport = @Sendable (URLRequest) async throws -> (Data, URLResponse)
    private let baseURL: URL
    private let transport: Transport

    public init(baseURL: URL, transport: @escaping Transport = { try await URLSession.shared.data(for: $0) }) {
        self.baseURL = baseURL
        self.transport = transport
    }

    private func send<T: Decodable>(_ method: String, _ path: String, headers: [String: String] = [:]) async throws -> T {
        var request = URLRequest(url: baseURL.appendingPathComponent(path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (k, v) in headers { request.setValue(v, forHTTPHeaderField: k) }
        let (data, response): (Data, URLResponse)
        do { (data, response) = try await transport(request) } catch { throw BackendError.from(error) }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else { throw LiveBackendClient.error(status: status, body: data) }
        do { return try AeroscopeJSON.decoder().decode(T.self, from: data) } catch { throw BackendError.decoding(String(describing: error)) }
    }

    public func clientConfig() async throws -> ClientConfig { try await send("GET", "v1/client-config") }
    public func start() async throws -> PairingStart { try await send("POST", "v1/pairing") }
    public func status(_ pairing: PairingStart) async throws -> PairingStatus {
        try await send("GET", "v1/pairing/\(pairing.pairingId)", headers: ["x-pairing-secret": pairing.secret])
    }
}
