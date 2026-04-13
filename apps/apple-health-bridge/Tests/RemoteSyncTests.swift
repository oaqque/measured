import XCTest
@testable import AppleHealthBridge

final class RemoteSyncTests: XCTestCase {
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
}
