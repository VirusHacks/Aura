import Foundation
import Security

/// Generic-password Keychain storage for credentials such as the API key.
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
    static let apiKeyAccount = "aeroscope.api-key"
    static let userKeyAccount = "aeroscope.user-key"

    /// The stored credentials, creating the per-installation user key if missing.
    func loadCredentials() -> BackendCredentials {
        var userKey = string(for: Self.userKeyAccount)
        if userKey == nil {
            let generated = BackendCredentials.generateUserKey()
            if (try? set(generated, for: Self.userKeyAccount)) != nil { userKey = generated }
        }
        return BackendCredentials(apiKey: string(for: Self.apiKeyAccount), userKey: userKey)
    }
}
