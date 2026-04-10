import Foundation

@MainActor
final class ExportWriter: ObservableObject {
    @Published private(set) var isExporting = false
    @Published private(set) var lastExportBundle: BridgeExportBundle?
    @Published private(set) var lastError: String?

    func writeSnapshot(
        workouts: [BridgeWorkout],
        routes: [String: BridgeRoute],
        collections: [String: BridgeHealthCollection],
        deletedActivityIds: [String]
    ) async -> BridgeExportBundle? {
        guard !isExporting else {
            return nil
        }

        isExporting = true
        lastError = nil
        defer { isExporting = false }

        do {
            let exportBundle = try await Task.detached(priority: .userInitiated) {
                try SnapshotExportFileWriter.writeSnapshot(
                    workouts: workouts,
                    routes: routes,
                    collections: collections,
                    deletedActivityIds: deletedActivityIds
                )
            }.value
            lastExportBundle = exportBundle
            return exportBundle
        } catch {
            lastExportBundle = nil
            lastError = error.localizedDescription
            return nil
        }
    }
}

private enum SnapshotExportFileWriter {
    static func writeSnapshot(
        workouts: [BridgeWorkout],
        routes: [String: BridgeRoute],
        collections: [String: BridgeHealthCollection],
        deletedActivityIds: [String]
    ) throws -> BridgeExportBundle {
        let generatedAt = Date().ISO8601Format()
        let exportDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "apple-health-export-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)

        let snapshotURL = exportDirectory.appendingPathComponent("cache-export.json")
        let manifestURL = exportDirectory.appendingPathComponent("export-manifest.json")

        try writeSnapshotFile(
            to: snapshotURL,
            generatedAt: generatedAt,
            workouts: workouts,
            routes: routes,
            collections: collections,
            deletedActivityIds: deletedActivityIds
        )

        let manifest = AppleHealthExportManifest(
            exportedAt: generatedAt,
            workoutCount: workouts.count,
            routeCount: routes.values.filter { !$0.coordinates.isEmpty }.count,
            collectionCount: collections.count,
            sampleCount: collections.values.reduce(0) { $0 + $1.samples.count }
        )
        try writeManifestFile(manifest, to: manifestURL)

        return BridgeExportBundle(
            directoryURL: exportDirectory,
            snapshotURL: snapshotURL,
            manifestURL: manifestURL
        )
    }

    private static func writeSnapshotFile(
        to url: URL,
        generatedAt: String,
        workouts: [BridgeWorkout],
        routes: [String: BridgeRoute],
        collections: [String: BridgeHealthCollection],
        deletedActivityIds: [String]
    ) throws {
        FileManager.default.createFile(atPath: url.path(), contents: nil)
        let handle = try FileHandle(forWritingTo: url)
        defer {
            try? handle.close()
        }

        try handle.write(contentsOf: Data("{".utf8))
        try writeObjectField("generatedAt", value: generatedAt, to: handle, trailingComma: true)
        try writeObjectField("provider", value: "appleHealth", to: handle, trailingComma: true)
        try writeObjectField("registryGeneratedAt", value: GeneratedHealthKitCatalog.generatedAt, to: handle, trailingComma: true)

        try handle.write(contentsOf: Data("\"activities\":{".utf8))
        let sortedWorkouts = workouts.sorted {
            (($0.startDate ?? .distantPast), $0.id) > (($1.startDate ?? .distantPast), $1.id)
        }
        for (index, workout) in sortedWorkouts.enumerated() {
            let route = routes[workout.id]
            let routeCoordinates = route?.coordinates.map { [$0.latitude, $0.longitude] }
            let activity = AppleHealthExportActivity(
                activityId: workout.id,
                sportType: workout.sportType,
                startDate: workout.startDate?.ISO8601Format(),
                distanceMeters: workout.distanceMeters,
                distanceKm: workout.distanceMeters.map { $0 / 1000 },
                movingTimeSeconds: workout.elapsedTimeSeconds,
                elapsedTimeSeconds: workout.elapsedTimeSeconds,
                averageHeartrate: workout.averageHeartrate,
                maxHeartrate: workout.maxHeartrate,
                summaryPolyline: route.map { encodePolyline($0.coordinates) },
                detailFetchedAt: generatedAt,
                hasStreams: routeCoordinates?.isEmpty == false,
                routeStreams: routeCoordinates?.isEmpty == false ? AppleHealthExportRouteStreams(
                    latlng: routeCoordinates,
                    altitude: route?.altitude,
                    distance: route?.distance,
                    heartrate: nil,
                    velocitySmooth: route?.velocitySmooth,
                    moving: nil
                ) : nil,
                source: AppleHealthExportSource(
                    bundleIdentifier: workout.bundleIdentifier,
                    name: workout.sourceName,
                    deviceName: workout.deviceName,
                    deviceModel: workout.deviceModel
                )
            )
            try writeDictionaryEntry(
                key: workout.id,
                value: activity,
                to: handle,
                isLast: index == sortedWorkouts.count - 1
            )
        }
        try handle.write(contentsOf: Data("},".utf8))

        try handle.write(contentsOf: Data("\"collections\":{".utf8))
        let sortedCollections = collections.keys.sorted()
        for (collectionIndex, key) in sortedCollections.enumerated() {
            guard let collection = collections[key] else {
                continue
            }

            try writeJSONString(key, to: handle)
            try handle.write(contentsOf: Data(":".utf8))
            try handle.write(contentsOf: Data("{".utf8))
            try writeObjectField("key", value: collection.key, to: handle, trailingComma: true)
            try writeObjectField("kind", value: collection.kind, to: handle, trailingComma: true)
            try writeObjectField("displayName", value: collection.displayName, to: handle, trailingComma: true)
            try writeObjectField("unit", value: collection.unit, to: handle, trailingComma: true)
            try writeObjectField("objectTypeIdentifier", value: collection.objectTypeIdentifier, to: handle, trailingComma: true)
            try writeObjectField("queryStrategy", value: collection.queryStrategy, to: handle, trailingComma: true)
            try writeObjectField(
                "requiresPerObjectAuthorization",
                value: collection.requiresPerObjectAuthorization,
                to: handle,
                trailingComma: true
            )
            try handle.write(contentsOf: Data("\"samples\":[".utf8))

            for (sampleIndex, sample) in collection.samples.enumerated() {
                let exportSample = AppleHealthExportSample(
                    sampleId: sample.sampleId,
                    startDate: sample.startDate?.ISO8601Format(),
                    endDate: sample.endDate?.ISO8601Format(),
                    numericValue: sample.numericValue,
                    categoryValue: sample.categoryValue,
                    textValue: sample.textValue,
                    payload: sample.payload,
                    source: sample.source,
                    metadata: sample.metadata
                )
                try handle.write(contentsOf: encodeJSONFragment(exportSample))
                if sampleIndex < collection.samples.count - 1 {
                    try handle.write(contentsOf: Data(",".utf8))
                }
            }

            try handle.write(contentsOf: Data("]}".utf8))
            if collectionIndex < sortedCollections.count - 1 {
                try handle.write(contentsOf: Data(",".utf8))
            }
        }
        try handle.write(contentsOf: Data("},".utf8))

        try writeObjectField("deletedActivityIds", value: deletedActivityIds, to: handle, trailingComma: false)
        try handle.write(contentsOf: Data("}".utf8))
    }

    private static func writeManifestFile(_ manifest: AppleHealthExportManifest, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let manifestData = try encoder.encode(manifest)
        try manifestData.write(to: url)
    }

    private static func writeObjectField<T: Encodable>(
        _ key: String,
        value: T,
        to handle: FileHandle,
        trailingComma: Bool
    ) throws {
        try writeJSONString(key, to: handle)
        try handle.write(contentsOf: Data(":".utf8))
        try handle.write(contentsOf: encodeJSONFragment(value))
        if trailingComma {
            try handle.write(contentsOf: Data(",".utf8))
        }
    }

    private static func writeDictionaryEntry<T: Encodable>(
        key: String,
        value: T,
        to handle: FileHandle,
        isLast: Bool
    ) throws {
        try writeJSONString(key, to: handle)
        try handle.write(contentsOf: Data(":".utf8))
        try handle.write(contentsOf: encodeJSONFragment(value))
        if !isLast {
            try handle.write(contentsOf: Data(",".utf8))
        }
    }

    private static func writeJSONString(_ string: String, to handle: FileHandle) throws {
        try handle.write(contentsOf: encodeJSONFragment(string))
    }

    private static func encodeJSONFragment<T: Encodable>(_ value: T) throws -> Data {
        let encoder = JSONEncoder()
        return try encoder.encode(value)
    }
}

private func encodePolyline(_ coordinates: [CLLocationCoordinate]) -> String {
    var previousLatitude = 0
    var previousLongitude = 0

    return coordinates.map { coordinate in
        let scaledLatitude = Int((coordinate.latitude * 1e5).rounded())
        let scaledLongitude = Int((coordinate.longitude * 1e5).rounded())
        let encodedLatitude = encodeSignedInteger(scaledLatitude - previousLatitude)
        let encodedLongitude = encodeSignedInteger(scaledLongitude - previousLongitude)
        previousLatitude = scaledLatitude
        previousLongitude = scaledLongitude
        return encodedLatitude + encodedLongitude
    }.joined()
}

private func encodeSignedInteger(_ value: Int) -> String {
    var current = value < 0 ? ~(value << 1) : value << 1
    var output = ""

    while current >= 0x20 {
        output.append(Character(UnicodeScalar((0x20 | (current & 0x1f)) + 63)!))
        current >>= 5
    }

    output.append(Character(UnicodeScalar(current + 63)!))
    return output
}
