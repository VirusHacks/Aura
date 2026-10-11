import Foundation
import Observation

/// A backend call waiting to be delivered. `id` doubles as the idempotency
/// key, so delivering the same action twice (watch and iPhone) is harmless.
public struct PendingAction: Codable, Hashable, Sendable, Identifiable {
    public var id: UUID
    public var operation: BackendOperation
    public var createdAt: Date
    public var attempts: Int
    public var lastAttemptAt: Date?
    public var lastError: String?
    /// Set when the action was handed to the iPhone for delivery.
    public var relayedViaPhoneAt: Date?

    public init(id: UUID = UUID(), operation: BackendOperation, createdAt: Date) {
        self.id = id
        self.operation = operation
        self.createdAt = createdAt
        self.attempts = 0
    }
}

/// FIFO queue of pending actions. Order matters (a trip must start before
/// its events), so delivery stops at the first retryable failure.
public struct PendingActionQueue: Codable, Hashable, Sendable {
    public static let capacity = 300

    public private(set) var actions: [PendingAction] = []

    public init(actions: [PendingAction] = []) {
        self.actions = actions
    }

    public var isEmpty: Bool { actions.isEmpty }
    public var count: Int { actions.count }
    public var first: PendingAction? { actions.first }

    public func contains(_ id: UUID) -> Bool { actions.contains { $0.id == id } }

    @discardableResult
    public mutating func enqueue(_ action: PendingAction) -> Bool {
        guard !contains(action.id) else { return false }
        actions.append(action)
        // Under pressure shed the oldest plain location updates, never trip
        // lifecycle, alert or route actions.
        while actions.count > Self.capacity, let i = actions.firstIndex(where: { $0.operation.isDroppable }) {
            actions.remove(at: i)
        }
        return true
    }

    public mutating func remove(ids: Set<UUID>) {
        actions.removeAll { ids.contains($0.id) }
    }

    public mutating func recordFailure(id: UUID, message: String, at date: Date) {
        guard let i = actions.firstIndex(where: { $0.id == id }) else { return }
        actions[i].attempts += 1
        actions[i].lastAttemptAt = date
        actions[i].lastError = message
    }

    public mutating func markRelayed(ids: Set<UUID>, at date: Date) {
        for i in actions.indices where ids.contains(actions[i].id) { actions[i].relayedViaPhoneAt = date }
    }

    public func unrelayed() -> [PendingAction] { actions.filter { $0.relayedViaPhoneAt == nil } }

    /// Attaches an offline-evaluated alert to a queued location event.
    public mutating func attach(deviceAlert: PollutionAlert, to id: UUID) {
        guard let i = actions.firstIndex(where: { $0.id == id }),
              case .tripEvent(let tripId, var event) = actions[i].operation else { return }
        event.deviceAlert = deviceAlert
        actions[i].operation = .tripEvent(tripId: tripId, event: event)
    }
}

public struct FlushOutcome: Sendable {
    public var delivered: [UUID: OperationResult] = [:]
    public var dropped: [UUID: BackendError] = [:]
    /// The retryable error that stopped delivery, if any.
    public var blockedBy: BackendError?
}

/// Persistent queue plus the delivery loop, shared by the watch and the
/// iPhone relay. Flushes are serialised: a flush requested while another is
/// running waits for it, then runs its own pass.
@MainActor
@Observable
public final class SyncQueue {
    public private(set) var queue: PendingActionQueue
    public private(set) var lastDeliveredAt: Date?
    public private(set) var lastError: BackendError?
    public private(set) var isFlushing = false

    /// Called for every delivered action, in order.
    @ObservationIgnored public var onDelivered: ((PendingAction, OperationResult) -> Void)?

    @ObservationIgnored private let store: FileStore
    @ObservationIgnored private let key: String
    @ObservationIgnored private var waiters: [CheckedContinuation<Void, Never>] = []
    @ObservationIgnored private var recentResults: [UUID: Result<OperationResult, BackendError>] = [:]
    @ObservationIgnored private var recentOrder: [UUID] = []

    public init(store: FileStore, key: String) {
        self.store = store
        self.key = key
        self.queue = store.load(PendingActionQueue.self, key: key) ?? PendingActionQueue()
    }

    public var count: Int { queue.count }

    public func contains(_ id: UUID) -> Bool { queue.contains(id) }

    @discardableResult
    public func enqueue(_ action: PendingAction) -> Bool {
        let added = queue.enqueue(action)
        persist()
        return added
    }

    public func remove(ids: Set<UUID>) {
        guard !ids.isEmpty else { return }
        queue.remove(ids: ids)
        persist()
    }

    public func markRelayed(ids: Set<UUID>, at date: Date) {
        queue.markRelayed(ids: ids, at: date)
        persist()
    }

    public func attach(deviceAlert: PollutionAlert, to id: UUID) {
        queue.attach(deviceAlert: deviceAlert, to: id)
        persist()
    }

    public func removeAll(where predicate: (PendingAction) -> Bool) {
        queue.remove(ids: Set(queue.actions.filter(predicate).map(\.id)))
        persist()
    }

    /// The outcome of a recently delivered or dropped action, if known.
    public func result(for id: UUID) -> Result<OperationResult, BackendError>? { recentResults[id] }

    /// Delivers queued actions in order until the queue is empty or a
    /// retryable error blocks it. Permanent failures drop the action.
    @discardableResult
    public func flush(using backend: any AeroscopeBackend, now: () -> Date) async -> FlushOutcome {
        while isFlushing {
            await withCheckedContinuation { waiters.append($0) }
        }
        isFlushing = true
        defer {
            isFlushing = false
            let pending = waiters
            waiters.removeAll()
            pending.forEach { $0.resume() }
        }
        var outcome = FlushOutcome()
        while let next = queue.first {
            do {
                let result = try await backend.perform(next.operation, idempotencyKey: next.id)
                queue.remove(ids: [next.id])
                outcome.delivered[next.id] = result
                remember(next.id, .success(result))
                lastDeliveredAt = now()
                lastError = nil
                persist()
                onDelivered?(next, result)
            } catch {
                let e = BackendError.from(error)
                lastError = e
                if e.isRetryable {
                    queue.recordFailure(id: next.id, message: e.userMessage, at: now())
                    outcome.blockedBy = e
                    persist()
                    return outcome
                }
                queue.remove(ids: [next.id])
                outcome.dropped[next.id] = e
                remember(next.id, .failure(e))
                persist()
            }
        }
        return outcome
    }

    private func remember(_ id: UUID, _ result: Result<OperationResult, BackendError>) {
        recentResults[id] = result
        recentOrder.append(id)
        if recentOrder.count > 64 { recentResults[recentOrder.removeFirst()] = nil }
    }

    private func persist() { store.save(queue, key: key) }
}
