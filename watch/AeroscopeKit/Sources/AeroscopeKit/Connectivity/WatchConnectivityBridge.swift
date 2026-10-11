#if canImport(WatchConnectivity)
import Foundation
import Observation
import WatchConnectivity
import os

public struct ConnectivityState: Hashable, Sendable {
    public var activated = false
    /// iPhone: a watch is paired. Watch: always true.
    public var paired = false
    /// iPhone: the watch app is installed. Watch: the iPhone app is installed.
    public var counterpartInstalled = false
    public var reachable = false
}

/// WatchConnectivity transport used by both apps. Incoming payloads are
/// decoded off the main thread and delivered on the main actor as typed
/// `ConnectivityMessage`s.
@MainActor
@Observable
public final class WatchConnectivityBridge: NSObject, ConnectivitySending {
    public private(set) var state = ConnectivityState()
    @ObservationIgnored public var onMessage: ((ConnectivityMessage) -> Void)?

    @ObservationIgnored private let session: WCSession?
    @ObservationIgnored private var context: [String: Any] = [:]
    @ObservationIgnored private var queuedUntilActivated: [(ConnectivityMessage, ConnectivityDelivery)] = []
    nonisolated private static let log = Logger(subsystem: "com.aeroscope", category: "Connectivity")

    public override init() {
        session = WCSession.isSupported() ? WCSession.default : nil
        super.init()
    }

    public func activate() {
        guard let session else { return }
        session.delegate = self
        session.activate()
    }

    public var isCounterpartAvailable: Bool { state.activated && state.counterpartInstalled }

    public func send(_ message: ConnectivityMessage, delivery: ConnectivityDelivery) {
        guard let session else { return }
        guard session.activationState == .activated else {
            queuedUntilActivated.append((message, delivery))
            return
        }
        do {
            switch delivery {
            case .latestState:
                guard let slot = message.contextSlot else { return send(message, delivery: .guaranteed) }
                context[slot] = try AeroscopeJSON.encoder().encode(message)
                try session.updateApplicationContext(context)
            case .guaranteed:
                session.transferUserInfo(try message.encoded())
            case .immediate:
                let payload = try message.encoded()
                if session.isReachable {
                    session.sendMessage(payload, replyHandler: nil) { [weak self] error in
                        Self.log.info("Live send failed, queuing transfer: \(error.localizedDescription, privacy: .public)")
                        Task { @MainActor in self?.send(message, delivery: .guaranteed) }
                    }
                } else {
                    session.transferUserInfo(payload)
                }
            }
        } catch {
            Self.log.error("Connectivity send failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func refreshState() {
        guard let session else { return }
        var s = ConnectivityState()
        s.activated = session.activationState == .activated
        s.reachable = session.isReachable
        #if os(iOS)
        s.paired = session.isPaired
        s.counterpartInstalled = session.isWatchAppInstalled
        #else
        s.paired = true
        s.counterpartInstalled = session.isCompanionAppInstalled
        #endif
        state = s
        if s.activated, !queuedUntilActivated.isEmpty {
            let queued = queuedUntilActivated
            queuedUntilActivated.removeAll()
            queued.forEach { send($0.0, delivery: $0.1) }
        }
    }

    private func deliver(_ messages: [ConnectivityMessage]) {
        messages.forEach { onMessage?($0) }
    }
}

extension WatchConnectivityBridge: WCSessionDelegate {
    nonisolated public func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let error { Self.log.error("Activation failed: \(error.localizedDescription, privacy: .public)") }
        let received = ConnectivityMessage.decodeContext(session.receivedApplicationContext)
        Task { @MainActor in
            self.refreshState()
            self.deliver(received)
        }
    }

    nonisolated public func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in self.refreshState() }
    }

    nonisolated public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        let decoded = try? ConnectivityMessage.decode(message)
        Task { @MainActor in self.deliver(decoded.map { [$0] } ?? []) }
    }

    nonisolated public func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        let decoded = try? ConnectivityMessage.decode(userInfo)
        Task { @MainActor in self.deliver(decoded.map { [$0] } ?? []) }
    }

    nonisolated public func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        let decoded = ConnectivityMessage.decodeContext(applicationContext)
        Task { @MainActor in self.deliver(decoded) }
    }

    #if os(iOS)
    nonisolated public func sessionDidBecomeInactive(_ session: WCSession) {
        Task { @MainActor in self.refreshState() }
    }

    nonisolated public func sessionDidDeactivate(_ session: WCSession) {
        // Re-activate so a newly paired watch can connect.
        session.activate()
    }

    nonisolated public func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in self.refreshState() }
    }
    #endif

    #if os(watchOS)
    nonisolated public func sessionCompanionAppInstalledDidChange(_ session: WCSession) {
        Task { @MainActor in self.refreshState() }
    }
    #endif
}
#endif
