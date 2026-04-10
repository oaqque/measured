import Foundation

struct BridgeExportBundle: Identifiable, Sendable {
    let directoryURL: URL
    let snapshotURL: URL
    let manifestURL: URL

    var id: String { directoryURL.path }
}

struct AppleHealthExportSnapshot: Codable, Sendable {
    let generatedAt: String
    let provider: String
    let activities: [String: AppleHealthExportActivity]
    let collections: [String: AppleHealthExportCollection]
    let deletedActivityIds: [String]
}

struct AppleHealthExportManifest: Codable, Sendable {
    let exportedAt: String
    let workoutCount: Int
    let routeCount: Int
    let collectionCount: Int
    let sampleCount: Int
}

struct AppleHealthExportActivity: Codable, Sendable {
    let activityId: String
    let sportType: String?
    let startDate: String?
    let distanceMeters: Double?
    let distanceKm: Double?
    let movingTimeSeconds: Int?
    let elapsedTimeSeconds: Int?
    let averageHeartrate: Double?
    let maxHeartrate: Double?
    let summaryPolyline: String?
    let detailFetchedAt: String?
    let hasStreams: Bool
    let routeStreams: AppleHealthExportRouteStreams?
    let source: AppleHealthExportSource?
}

struct AppleHealthExportRouteStreams: Codable, Sendable {
    let latlng: [[Double]]?
    let altitude: [Double]?
    let distance: [Double]?
    let heartrate: [Double]?
    let velocitySmooth: [Double]?
    let moving: [Bool]?
}

struct AppleHealthExportSource: Codable, Sendable {
    let bundleIdentifier: String?
    let name: String?
    let deviceName: String?
    let deviceModel: String?
}

struct AppleHealthExportCollection: Codable, Sendable {
    let key: String
    let kind: String
    let displayName: String
    let unit: String?
    let samples: [AppleHealthExportSample]
}

struct AppleHealthExportSample: Codable, Sendable {
    let sampleId: String
    let startDate: String?
    let endDate: String?
    let numericValue: Double?
    let categoryValue: Int?
    let source: AppleHealthExportSource?
    let metadata: [String: String]?
}

struct BridgeWorkout: Identifiable, Sendable {
    let id: String
    let sportType: String?
    let startDate: Date?
    let distanceMeters: Double?
    let elapsedTimeSeconds: Int?
    let averageHeartrate: Double?
    let maxHeartrate: Double?
    let sourceName: String?
    let bundleIdentifier: String?
    let deviceName: String?
    let deviceModel: String?
}

struct BridgeRoute: Sendable {
    let activityId: String
    let coordinates: [CLLocationCoordinate]
    let altitude: [Double]?
    let distance: [Double]?
    let velocitySmooth: [Double]?
}

struct BridgeHealthCollection: Sendable {
    let key: String
    let kind: String
    let displayName: String
    let unit: String?
    let samples: [BridgeHealthSample]
}

struct BridgeHealthSample: Sendable {
    let sampleId: String
    let startDate: Date?
    let endDate: Date?
    let numericValue: Double?
    let categoryValue: Int?
    let source: AppleHealthExportSource?
    let metadata: [String: String]?
}

struct CLLocationCoordinate: Sendable {
    let latitude: Double
    let longitude: Double
}
