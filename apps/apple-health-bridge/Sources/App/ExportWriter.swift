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
        let snapshot = SnapshotExportBuilder.snapshot(
            workouts: workouts,
            routes: routes,
            collections: collections,
            deletedActivityIds: deletedActivityIds
        )
        let manifest = SnapshotExportBuilder.manifest(for: snapshot)
        let exportDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(
            "apple-health-export-\(UUID().uuidString)",
            isDirectory: true
        )
        try FileManager.default.createDirectory(at: exportDirectory, withIntermediateDirectories: true)

        let snapshotURL = exportDirectory.appendingPathComponent("cache-export.json")
        let manifestURL = exportDirectory.appendingPathComponent("export-manifest.json")

        try writeSnapshotFile(snapshot, to: snapshotURL)
        try writeManifestFile(manifest, to: manifestURL)

        return BridgeExportBundle(
            directoryURL: exportDirectory,
            snapshotURL: snapshotURL,
            manifestURL: manifestURL
        )
    }

    private static func writeSnapshotFile(
        _ snapshot: AppleHealthExportSnapshot,
        to url: URL
    ) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let snapshotData = try encoder.encode(snapshot)
        try snapshotData.write(to: url)
    }

    private static func writeManifestFile(_ manifest: AppleHealthExportManifest, to url: URL) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let manifestData = try encoder.encode(manifest)
        try manifestData.write(to: url)
    }
}

enum SnapshotExportBuilder {
    static func snapshot(
        workouts: [BridgeWorkout],
        routes: [String: BridgeRoute],
        collections: [String: BridgeHealthCollection],
        deletedActivityIds: [String]
    ) -> AppleHealthExportSnapshot {
        let generatedAt = Date().ISO8601Format()

        return AppleHealthExportSnapshot(
            generatedAt: generatedAt,
            provider: "appleHealth",
            registryGeneratedAt: GeneratedHealthKitCatalog.generatedAt,
            activities: exportedActivities(workouts: workouts, routes: routes, generatedAt: generatedAt),
            collections: exportedCollections(collections),
            deletedActivityIds: deletedActivityIds.sorted()
        )
    }

    static func manifest(for snapshot: AppleHealthExportSnapshot) -> AppleHealthExportManifest {
        AppleHealthExportManifest(
            exportedAt: snapshot.generatedAt,
            workoutCount: snapshot.activities.count,
            routeCount: snapshot.activities.values.filter { $0.hasStreams }.count,
            collectionCount: snapshot.collections.count,
            sampleCount: snapshot.collections.values.reduce(0) { $0 + $1.samples.count }
        )
    }

    private static func exportedActivities(
        workouts: [BridgeWorkout],
        routes: [String: BridgeRoute],
        generatedAt: String
    ) -> [String: AppleHealthExportActivity] {
        Dictionary(
            uniqueKeysWithValues: workouts.map { workout in
                let route = routes[workout.id]
                let routeCoordinates = route?.coordinates.map { [$0.latitude, $0.longitude] }
                return (
                    workout.id,
                    AppleHealthExportActivity(
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
                )
            }
        )
    }

    private static func exportedCollections(
        _ collections: [String: BridgeHealthCollection]
    ) -> [String: AppleHealthExportCollection] {
        Dictionary(
            uniqueKeysWithValues: collections.map { key, collection in
                (
                    key,
                    AppleHealthExportCollection(
                        key: collection.key,
                        kind: collection.kind,
                        displayName: collection.displayName,
                        unit: collection.unit,
                        objectTypeIdentifier: collection.objectTypeIdentifier,
                        queryStrategy: collection.queryStrategy,
                        requiresPerObjectAuthorization: collection.requiresPerObjectAuthorization,
                        samples: collection.samples.map { sample in
                            AppleHealthExportSample(
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
                        }
                    )
                )
            }
        )
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
