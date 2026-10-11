import Foundation

public enum BackendError: Error, Hashable, Sendable {
    /// No backend URL configured for live mode.
    case notConfigured
    /// No connectivity, DNS failure, timeout or dropped connection.
    case offline(String)
    case unauthorized
    case notFound(String)
    case outsideCoverage(String)
    case rejected(status: Int, message: String)
    case rateLimited
    case server(status: Int, message: String)
    case decoding(String)
    case transport(String)

    /// Retryable errors keep queued actions for a later attempt; the rest are
    /// permanent and drop the action.
    public var isRetryable: Bool {
        switch self {
        case .offline, .rateLimited, .server, .transport, .notConfigured: true
        case .unauthorized, .notFound, .outsideCoverage, .rejected, .decoding: false
        }
    }

    /// Problems the paired iPhone may be able to route around (it has its own
    /// connection and its own backend settings).
    public var canRelayThroughPhone: Bool {
        switch self {
        case .offline, .notConfigured: true
        default: false
        }
    }

    public var userMessage: String {
        switch self {
        case .notConfigured: "Backend not configured"
        case .offline: "No connection"
        case .unauthorized: "Backend rejected credentials"
        case .notFound(let m): m.isEmpty ? "Not found" : m
        case .outsideCoverage(let m): m.isEmpty ? "Outside Delhi coverage" : m
        case .rejected(_, let m): m.isEmpty ? "Request rejected" : m
        case .rateLimited: "Too many requests, retrying later"
        case .server(let s, _): "Backend error (\(s))"
        case .decoding: "Unexpected backend response"
        case .transport(let m): m
        }
    }

    public static func from(_ error: Error) -> BackendError {
        if let e = error as? BackendError { return e }
        if let e = error as? URLError {
            switch e.code {
            case .notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotFindHost, .cannotConnectToHost,
                 .dnsLookupFailed, .internationalRoamingOff, .dataNotAllowed, .callIsActive,
                 .secureConnectionFailed:
                return .offline(e.localizedDescription)
            case .cancelled:
                return .transport("Cancelled")
            case .appTransportSecurityRequiresSecureConnection:
                return .transport("Backend URL must use HTTPS")
            default:
                return .transport(e.localizedDescription)
            }
        }
        if error is DecodingError { return .decoding(String(describing: error)) }
        return .transport(error.localizedDescription)
    }
}
