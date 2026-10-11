import Foundation
import os

/// Small JSON-file persistence in Application Support. Each key is one file;
/// writes are atomic so a crash mid-write never leaves a corrupt state file.
public final class FileStore: Sendable {
    public let directory: URL
    private static let log = Logger(subsystem: "com.aeroscope", category: "FileStore")

    public init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    public static func applicationSupport(folder: String = "Aeroscope") -> FileStore {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return FileStore(directory: base.appendingPathComponent(folder, isDirectory: true))
    }

    private func url(_ key: String) -> URL { directory.appendingPathComponent("\(key).json") }

    public func load<T: Decodable>(_ type: T.Type, key: String) -> T? {
        let url = url(key)
        guard let data = try? Data(contentsOf: url) else { return nil }
        do {
            return try AeroscopeJSON.decoder().decode(T.self, from: data)
        } catch {
            // A schema change or corrupt file: drop it rather than crash or loop.
            Self.log.error("Discarding unreadable \(key, privacy: .public): \(error.localizedDescription, privacy: .public)")
            try? FileManager.default.removeItem(at: url)
            return nil
        }
    }

    public func save<T: Encodable>(_ value: T?, key: String) {
        guard let value else { return remove(key: key) }
        do {
            let data = try AeroscopeJSON.encoder().encode(value)
            try data.write(to: url(key), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {
            Self.log.error("Failed to save \(key, privacy: .public): \(error.localizedDescription, privacy: .public)")
        }
    }

    public func remove(key: String) {
        try? FileManager.default.removeItem(at: url(key))
    }
}
