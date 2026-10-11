import Foundation
import Security

/// Generic-password Keychain storage for the sign-in session.
public struct KeychainStore: Sendable {
    public enum KeychainError: Error, Equatable {
        case unexpectedStatus(OSStatus)
    }

    public let service: String

    public init(service: String = "com.aeroscope.credentials") {
        self.service = service
    }

    private func query(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func string(for account: String) -> String? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Stores `value`, or deletes the item when `value` is nil or empty.
    public func set(_ value: String?, for account: String) throws {
        let base = query(account)
        guard let value, !value.isEmpty else {
            let status = SecItemDelete(base as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError.unexpectedStatus(status) }
            return
        }
        let data = Data(value.utf8)
        let update: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(base as CFDictionary, update as CFDictionary)
        if status == errSecItemNotFound {
            status = SecItemAdd(base.merging(update) { $1 } as CFDictionary, nil)
        }
        guard status == errSecSuccess else { throw KeychainError.unexpectedStatus(status) }
    }
}

public extension KeychainStore {
    static let tokensAccount = "aeroscope.auth-tokens"

    /// The signed-in session for this device, if any.
    func loadTokens() -> AuthTokens? {
        guard let raw = string(for: Self.tokensAccount) else { return nil }
        return try? AeroscopeJSON.decoder().decode(AuthTokens.self, from: Data(raw.utf8))
    }

    /// Stores the session (nil signs out). Kept on this device only.
    func saveTokens(_ tokens: AuthTokens?) throws {
        guard let tokens else { return try set(nil, for: Self.tokensAccount) }
        let data = try AeroscopeJSON.encoder().encode(tokens)
        try set(String(decoding: data, as: UTF8.self), for: Self.tokensAccount)
    }
}
