import XCTest
@testable import AppleHealthBridge

final class RemoteSyncTests: XCTestCase {
    private let decoder = JSONDecoder()

    func testPrepareSyncRebasesSequenceWhenReceiverCheckpointIsAhead() throws {
        let snapshot = makeSnapshot(generatedAt: "2026-04-13T00:00:00Z", distanceMeters: 5000)
        let receiverStatus = makeReceiverStatus()

        let initial = try RemoteSyncBuilder.prepareSync(
            snapshot: snapshot,
            state: .initial(),
            receiverStatus: receiverStatus,
            checkpointSequence: nil
        )

        let recovered = try RemoteSyncBuilder.prepareSync(
            snapshot: snapshot,
            state: initial.nextState,
            receiverStatus: receiverStatus,
            checkpointSequence: initial.sequence + 7
        )

        XCTAssertTrue(recovered.recoveredSenderState)
        XCTAssertFalse(recovered.changed)
        XCTAssertEqual(recovered.sequence, initial.sequence + 7)
        XCTAssertEqual(recovered.nextState.lastSequence, initial.sequence + 7)
        XCTAssertEqual(recovered.manifestDigest, initial.manifestDigest)
    }

    func testPrepareSyncAllocatesNewSequenceWhenManifestChanges() throws {
        let originalSnapshot = makeSnapshot(generatedAt: "2026-04-13T00:00:00Z", distanceMeters: 5000)
        let updatedSnapshot = makeSnapshot(generatedAt: "2026-04-13T00:10:00Z", distanceMeters: 5200)
        let receiverStatus = makeReceiverStatus()

        let initial = try RemoteSyncBuilder.prepareSync(
            snapshot: originalSnapshot,
            state: .initial(),
            receiverStatus: receiverStatus,
            checkpointSequence: nil
        )

        let updated = try RemoteSyncBuilder.prepareSync(
            snapshot: updatedSnapshot,
            state: initial.nextState,
            receiverStatus: receiverStatus,
            checkpointSequence: initial.sequence
        )

        XCTAssertTrue(updated.changed)
        XCTAssertEqual(updated.sequence, initial.sequence + 1)
        XCTAssertNotEqual(updated.manifestDigest, initial.manifestDigest)
    }

    func testMigrationFromLegacyStatePreservesSenderIdentityAndSequence() {
        let legacy = RemoteSyncLegacyLocalState(
            senderId: "bridge-legacy",
            lastSequence: 42
        )

        let migrated = RemoteSyncLocalState.migrated(from: legacy)
        XCTAssertEqual(migrated.senderId, "bridge-legacy")
        XCTAssertEqual(migrated.lastSequence, 42)
        XCTAssertNil(migrated.currentManifestDigest)
    }

    func testPrepareSyncLeavesUndatedChunkBoundsNilWhenSampleDatesAreBlank() throws {
        let blankDateSample = AppleHealthExportSample(
            sampleId: "sample-blank",
            startDate: "",
            endDate: "   ",
            numericValue: 1,
            categoryValue: nil,
            textValue: nil,
            payload: nil,
            source: nil,
            metadata: nil
        )
        let snapshot = AppleHealthExportSnapshot(
            generatedAt: "2026-04-13T00:00:00Z",
            provider: "appleHealth",
            registryGeneratedAt: "2026-04-13T00:00:00Z",
            activities: [:],
            collections: [
                "activeMoveMode": AppleHealthExportCollection(
                    key: "activeMoveMode",
                    kind: "quantity",
                    displayName: "Active Move Mode",
                    unit: nil,
                    objectTypeIdentifier: "HKQuantityTypeIdentifierActiveMoveMode",
                    queryStrategy: "quantity",
                    requiresPerObjectAuthorization: false,
                    samples: [blankDateSample]
                ),
            ],
            deletedActivityIds: []
        )

        let prepared = try RemoteSyncBuilder.prepareSync(
            snapshot: snapshot,
            state: .initial(),
            receiverStatus: makeReceiverStatus(),
            checkpointSequence: nil
        )

        let chunk = try XCTUnwrap(prepared.manifest.sampleChunks.first)
        XCTAssertEqual(chunk.bucketId, "undated")
        XCTAssertNil(chunk.minStartDate)
        XCTAssertNil(chunk.maxStartDate)
    }

    func testPrepareSyncDoesNotDuplicateRouteStreamsIntoActivitySummaries() throws {
        let routeStreams = AppleHealthExportRouteStreams(
            latlng: stride(from: 0, to: 4000, by: 1).map { index in
                [Double(index) / 1000.0, Double(index) / 1000.0]
            },
            altitude: nil,
            distance: nil,
            heartrate: nil,
            velocitySmooth: nil,
            moving: nil
        )
        let snapshot = AppleHealthExportSnapshot(
            generatedAt: "2026-04-13T00:00:00Z",
            provider: "appleHealth",
            registryGeneratedAt: "2026-04-13T00:00:00Z",
            activities: [
                "activity-1": AppleHealthExportActivity(
                    activityId: "activity-1",
                    sportType: "run",
                    startDate: "2026-04-13T00:00:00Z",
                    distanceMeters: 5000,
                    distanceKm: 5,
                    movingTimeSeconds: 1500,
                    elapsedTimeSeconds: 1510,
                    averageHeartrate: 145,
                    maxHeartrate: 170,
                    summaryPolyline: "encoded-polyline",
                    detailFetchedAt: "2026-04-13T00:10:00Z",
                    hasStreams: true,
                    routeStreams: routeStreams,
                    source: AppleHealthExportSource(
                        bundleIdentifier: "com.example.runner",
                        name: "Runner",
                        deviceName: "Watch",
                        deviceModel: "Watch1,1"
                    )
                ),
            ],
            collections: [:],
            deletedActivityIds: []
        )

        let prepared = try RemoteSyncBuilder.prepareSync(
            snapshot: snapshot,
            state: .initial(),
            receiverStatus: makeReceiverStatus(),
            checkpointSequence: nil
        )

        let activityBlob = try XCTUnwrap(blob(forKind: "activity_summaries", in: prepared))
        let routeBlob = try XCTUnwrap(blob(forKind: "routes", in: prepared))

        XCTAssertLessThan(activityBlob.uncompressedBytes, routeBlob.uncompressedBytes)

        let activityLine = try XCTUnwrap(firstLine(from: activityBlob.data))
        let decoded = try decoder.decode(ActivitySummaryBlobLine.self, from: activityLine)
        XCTAssertEqual(decoded.activityId, "activity-1")
        XCTAssertEqual(decoded.source?.bundleIdentifier, "com.example.runner")
    }

    private func makeReceiverStatus() -> RemoteSyncStatusResponse {
        RemoteSyncStatusResponse(
            protocolVersion: RemoteSyncConstants.protocolVersion,
            schema: RemoteSyncConstants.schema,
            receiverId: "receiver-1",
            maxRequestBytes: 5 * 1024 * 1024,
            maxBlobBytes: 64 * 1024 * 1024,
            blobEncoding: "gzip",
            blobFormat: "ndjson",
            hashAlgorithm: "sha256"
        )
    }

    private func makeSnapshot(generatedAt: String, distanceMeters: Double) -> AppleHealthExportSnapshot {
        AppleHealthExportSnapshot(
            generatedAt: generatedAt,
            provider: "appleHealth",
            registryGeneratedAt: generatedAt,
            activities: [
                "activity-1": AppleHealthExportActivity(
                    activityId: "activity-1",
                    sportType: "run",
                    startDate: "2026-04-13T00:00:00Z",
                    distanceMeters: distanceMeters,
                    distanceKm: distanceMeters / 1000,
                    movingTimeSeconds: 1500,
                    elapsedTimeSeconds: 1510,
                    averageHeartrate: 145,
                    maxHeartrate: 170,
                    summaryPolyline: nil,
                    detailFetchedAt: generatedAt,
                    hasStreams: false,
                    routeStreams: nil,
                    source: nil
                )
            ],
            collections: [
                "heartRate": AppleHealthExportCollection(
                    key: "heartRate",
                    kind: "quantity",
                    displayName: "Heart Rate",
                    unit: "count/min",
                    objectTypeIdentifier: "HKQuantityTypeIdentifierHeartRate",
                    queryStrategy: "quantity",
                    requiresPerObjectAuthorization: false,
                    samples: [
                        AppleHealthExportSample(
                            sampleId: "sample-1",
                            startDate: "2026-04-13T00:00:00Z",
                            endDate: "2026-04-13T00:00:05Z",
                            numericValue: 145,
                            categoryValue: nil,
                            textValue: "145 bpm",
                            payload: ["trend": "steady"],
                            source: nil,
                            metadata: nil
                        ),
                    ]
                ),
            ],
            deletedActivityIds: []
        )
    }

    private func blob(
        forKind kind: String,
        in prepared: RemoteSyncPreparedSync
    ) throws -> RemoteSyncStagedBlob? {
        let blobHash = prepared.manifest.controlBlobs.first(where: { $0.kind == kind })?.blobHash
        guard let blobHash else {
            return nil
        }
        return try XCTUnwrap(prepared.stagedBlobs[blobHash])
    }

    private func firstLine(from gzipData: Data) throws -> Data? {
        let tempDirectory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: tempDirectory, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: tempDirectory)
        }

        let gzipURL = tempDirectory.appendingPathComponent("blob.gz")
        try gzipData.write(to: gzipURL)

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/gunzip")
        process.arguments = ["-c", gzipURL.path]
        let outputPipe = Pipe()
        let errorPipe = Pipe()
        process.standardOutput = outputPipe
        process.standardError = errorPipe
        try process.run()
        process.waitUntilExit()

        XCTAssertEqual(
            process.terminationStatus,
            0,
            String(data: errorPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "gunzip failed"
        )

        let output = outputPipe.fileHandleForReading.readDataToEndOfFile()
        return output.split(separator: 0x0A, maxSplits: 1, omittingEmptySubsequences: true).first.map(Data.init)
    }
}

private struct ActivitySummaryBlobLine: Decodable {
    let activityId: String
    let sportType: String?
    let startDate: String?
    let distanceMeters: Double?
    let distanceKm: Double?
    let movingTimeSeconds: Int?
    let elapsedTimeSeconds: Int?
    let averageHeartrate: Double?
    let maxHeartrate: Double?
    let detailFetchedAt: String?
    let source: AppleHealthExportSource?
}
