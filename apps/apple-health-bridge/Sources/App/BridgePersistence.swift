import Foundation
import HealthKit

enum BridgePersistence {
    static var directoryURL: URL {
        let baseURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first ??
            FileManager.default.temporaryDirectory
        return baseURL.appendingPathComponent("AppleHealthBridgeCache", isDirectory: true)
    }
}

final class BridgeFileStore<Value: Codable> {
    private let filename: String
    private let encoder: JSONEncoder
    private let decoder: JSONDecoder

    init(filename: String) {
        self.filename = filename
        self.encoder = JSONEncoder()
        self.decoder = JSONDecoder()
        self.encoder.dateEncodingStrategy = .iso8601
        self.decoder.dateDecodingStrategy = .iso8601
    }

    func loadValue() throws -> Value? {
        let url = fileURL
        guard FileManager.default.fileExists(atPath: url.path) else {
            return nil
        }

        let data = try Data(contentsOf: url)
        return try decoder.decode(Value.self, from: data)
    }

    func saveValue(_ value: Value?) throws {
        let url = fileURL
        let fileManager = FileManager.default

        try fileManager.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )

        guard let value else {
            if fileManager.fileExists(atPath: url.path) {
                try fileManager.removeItem(at: url)
            }
            return
        }

        let data = try encoder.encode(value)
        try data.write(to: url, options: .atomic)
    }

    var exists: Bool {
        FileManager.default.fileExists(atPath: fileURL.path)
    }

    private var fileURL: URL {
        BridgePersistence.directoryURL.appendingPathComponent(filename)
    }
}

final class PersistentHealthKitAnchorStore {
    private let anchorKey: String
    private let userDefaults: UserDefaults

    init(anchorKey: String, userDefaults: UserDefaults = .standard) {
        self.anchorKey = anchorKey
        self.userDefaults = userDefaults
    }

    func loadAnchor() throws -> HKQueryAnchor? {
        guard let data = userDefaults.data(forKey: anchorKey) else {
            return nil
        }

        return try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    func saveAnchor(_ anchor: HKQueryAnchor?) throws {
        guard let anchor else {
            userDefaults.removeObject(forKey: anchorKey)
            return
        }

        let data = try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
        userDefaults.set(data, forKey: anchorKey)
    }
}
