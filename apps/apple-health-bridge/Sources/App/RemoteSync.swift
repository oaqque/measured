import CryptoKit
import Foundation

enum RemoteSyncConstants {
    static let protocolVersion = 3
    static let schema = "apple-health-blobs.v3"
    static let endpointPath = "/health-sync"
    static let sampleChunkTargetBytes = 2_500_000
    static let minimumSampleChunkTargetBytes = 512_000
}

struct RemoteSyncStatusResponse: Decodable, Sendable {
    let protocolVersion: Int
    let schema: String
    let receiverId: String
    let maxRequestBytes: Int
    let maxBlobBytes: Int
    let blobEncoding: String
    let blobFormat: String
    let hashAlgorithm: String
}

struct RemoteSyncCheckpointResponse: Codable, Sendable {
    let replicationId: String
    let lastSequence: Int
    let updatedAt: String
}

struct RemoteSyncCheckpointRequest: Encodable, Sendable {
    let lastSequence: Int
    let updatedAt: String
}

struct RemoteSyncControlBlobReference: Codable, Sendable {
    let kind: String
    let blobHash: String
    let encoding: String
    let format: String
    let itemCount: Int
}

struct RemoteSyncSampleChunkReference: Codable, Sendable {
    let collectionKey: String
    let bucketId: String
    let blobHash: String
    let encoding: String
    let format: String
    let sampleCount: Int
    let minStartDate: String?
    let maxStartDate: String?
}

struct RemoteSyncSnapshotManifest: Codable, Sendable {
    let generatedAt: String
    let registryGeneratedAt: String?
    let controlBlobs: [RemoteSyncControlBlobReference]
    let sampleChunks: [RemoteSyncSampleChunkReference]
}

struct RemoteSyncPlanRequest: Encodable, Sendable {
    let replicationId: String
    let lastSequence: Int
    let snapshot: RemoteSyncSnapshotManifest
}

struct RemoteSyncPlanResponse: Decodable, Sendable {
    let missingBlobHashes: [String]
}

struct RemoteSyncCommitRequest: Encodable, Sendable {
    let replicationId: String
    let lastSequence: Int
    let snapshot: RemoteSyncSnapshotManifest
}

struct RemoteSyncCommitResponse: Decodable, Sendable {
    let replicationId: String
    let lastSequence: Int
    let snapshotId: String
    let committedAt: String
}

struct RemoteSyncLocalState: Codable, Sendable {
    var senderId: String
    var lastSequence: Int
    var currentManifestDigest: String?

    static func initial() -> RemoteSyncLocalState {
        RemoteSyncLocalState(
            senderId: "bridge-" + UUID().uuidString.lowercased(),
            lastSequence: 0,
            currentManifestDigest: nil
        )
    }

    static func migrated(from legacyState: RemoteSyncLegacyLocalState?) -> RemoteSyncLocalState {
        guard let legacyState else {
            return .initial()
        }

        return RemoteSyncLocalState(
            senderId: legacyState.senderId,
            lastSequence: legacyState.lastSequence,
            currentManifestDigest: nil
        )
    }
}

struct RemoteSyncLegacyLocalState: Codable, Sendable {
    let senderId: String
    let lastSequence: Int
}

struct RemoteSyncStagedBlob: Sendable {
    let hash: String
    let data: Data
    let uncompressedBytes: Int
    let compressedBytes: Int
}

struct RemoteSyncPreparedSync: Sendable {
    let replicationId: String
    let checkpointSequence: Int?
    let manifest: RemoteSyncSnapshotManifest
    let manifestDigest: String
    let sequence: Int
    let nextState: RemoteSyncLocalState
    let stagedBlobs: [String: RemoteSyncStagedBlob]
    let recoveredSenderState: Bool
    let changed: Bool

    var blobCount: Int {
        stagedBlobs.count
    }

    var totalBlobBytes: Int {
        stagedBlobs.values.reduce(0) { $0 + $1.compressedBytes }
    }
}

private struct RemoteSyncRouteBlobData: Codable, Sendable {
    let activityId: String
    let summaryPolyline: String?
    let hasStreams: Bool
    let routeStreams: AppleHealthExportRouteStreams?
}

private struct RemoteSyncCollectionMetadataBlobData: Codable, Sendable {
    let key: String
    let kind: String
    let displayName: String
    let unit: String?
    let objectTypeIdentifier: String?
    let queryStrategy: String?
    let requiresPerObjectAuthorization: Bool?
}

enum RemoteSyncBuilder {
    static func prepareSync(
        snapshot: AppleHealthExportSnapshot,
        state: RemoteSyncLocalState,
        receiverStatus: RemoteSyncStatusResponse,
        checkpointSequence: Int?
    ) throws -> RemoteSyncPreparedSync {
        let rebasedState = rebasedStateIfNeeded(state, minimumLastSequence: checkpointSequence ?? 0)
        let replicationId = replicationID(
            senderId: rebasedState.senderId,
            receiverId: receiverStatus.receiverId,
            schema: receiverStatus.schema
        )

        var stagedBlobs: [String: RemoteSyncStagedBlob] = [:]
        var controlBlobs: [RemoteSyncControlBlobReference] = []

        if !snapshot.activities.isEmpty {
            let activityBlob = try stageBlob(
                lines: snapshot.activities.values
                    .sorted(by: activitySort)
                    .map(canonicalJSONData),
                maxBlobBytes: receiverStatus.maxBlobBytes
            )
            stagedBlobs[activityBlob.hash] = activityBlob
            controlBlobs.append(
                RemoteSyncControlBlobReference(
                    kind: "activity_summaries",
                    blobHash: activityBlob.hash,
                    encoding: "gzip",
                    format: "ndjson",
                    itemCount: snapshot.activities.count
                )
            )
        }

        let routeLines = snapshot.activities.values
            .filter(hasRouteDocument)
            .sorted(by: activitySort)
            .map {
                RemoteSyncRouteBlobData(
                    activityId: $0.activityId,
                    summaryPolyline: $0.summaryPolyline,
                    hasStreams: $0.hasStreams,
                    routeStreams: $0.routeStreams
                )
            }

        if !routeLines.isEmpty {
            let routeBlob = try stageBlob(
                lines: routeLines.map(canonicalJSONData),
                maxBlobBytes: receiverStatus.maxBlobBytes
            )
            stagedBlobs[routeBlob.hash] = routeBlob
            controlBlobs.append(
                RemoteSyncControlBlobReference(
                    kind: "routes",
                    blobHash: routeBlob.hash,
                    encoding: "gzip",
                    format: "ndjson",
                    itemCount: routeLines.count
                )
            )
        }

        if !snapshot.collections.isEmpty {
            let collectionMetadataBlob = try stageBlob(
                lines: snapshot.collections.values
                    .sorted(by: collectionSort)
                    .map {
                        RemoteSyncCollectionMetadataBlobData(
                            key: $0.key,
                            kind: $0.kind,
                            displayName: $0.displayName,
                            unit: $0.unit,
                            objectTypeIdentifier: $0.objectTypeIdentifier,
                            queryStrategy: $0.queryStrategy,
                            requiresPerObjectAuthorization: $0.requiresPerObjectAuthorization
                        )
                    }
                    .map(canonicalJSONData),
                maxBlobBytes: receiverStatus.maxBlobBytes
            )
            stagedBlobs[collectionMetadataBlob.hash] = collectionMetadataBlob
            controlBlobs.append(
                RemoteSyncControlBlobReference(
                    kind: "collection_metadata",
                    blobHash: collectionMetadataBlob.hash,
                    encoding: "gzip",
                    format: "ndjson",
                    itemCount: snapshot.collections.count
                )
            )
        }

        let deletedActivityIds = snapshot.deletedActivityIds.sorted()
        if !deletedActivityIds.isEmpty {
            let deletedBlob = try stageBlob(
                lines: deletedActivityIds.map(canonicalJSONData),
                maxBlobBytes: receiverStatus.maxBlobBytes
            )
            stagedBlobs[deletedBlob.hash] = deletedBlob
            controlBlobs.append(
                RemoteSyncControlBlobReference(
                    kind: "deleted_activity_ids",
                    blobHash: deletedBlob.hash,
                    encoding: "gzip",
                    format: "ndjson",
                    itemCount: deletedActivityIds.count
                )
            )
        }

        let sampleChunks = try buildSampleChunks(
            from: snapshot,
            maxBlobBytes: receiverStatus.maxBlobBytes,
            stagedBlobs: &stagedBlobs
        )

        let manifest = RemoteSyncSnapshotManifest(
            generatedAt: snapshot.generatedAt,
            registryGeneratedAt: snapshot.registryGeneratedAt,
            controlBlobs: controlBlobs.sorted { ($0.kind, $0.blobHash) < ($1.kind, $1.blobHash) },
            sampleChunks: sampleChunks
        )
        let manifestDigest = try sha256Hex(for: canonicalJSONData(manifest))
        let changed = manifestDigest != rebasedState.currentManifestDigest
        let sequence = changed ? rebasedState.lastSequence + 1 : rebasedState.lastSequence
        let nextState = RemoteSyncLocalState(
            senderId: rebasedState.senderId,
            lastSequence: sequence,
            currentManifestDigest: manifestDigest
        )

        return RemoteSyncPreparedSync(
            replicationId: replicationId,
            checkpointSequence: checkpointSequence,
            manifest: manifest,
            manifestDigest: manifestDigest,
            sequence: sequence,
            nextState: nextState,
            stagedBlobs: stagedBlobs,
            recoveredSenderState: (checkpointSequence ?? 0) > state.lastSequence,
            changed: changed
        )
    }

    private static func buildSampleChunks(
        from snapshot: AppleHealthExportSnapshot,
        maxBlobBytes: Int,
        stagedBlobs: inout [String: RemoteSyncStagedBlob]
    ) throws -> [RemoteSyncSampleChunkReference] {
        let targetBytes = max(
            min(RemoteSyncConstants.sampleChunkTargetBytes, maxBlobBytes / 2),
            RemoteSyncConstants.minimumSampleChunkTargetBytes
        )

        var sampleChunks: [RemoteSyncSampleChunkReference] = []

        for collection in snapshot.collections.values.sorted(by: collectionSort) {
            let sortedSamples = collection.samples.sorted(by: sampleSort)
            var currentBucketId: String?
            var currentLines: [Data] = []
            var currentSampleCount = 0
            var currentMinStartDate: String?
            var currentMaxStartDate: String?
            var currentBytes = 0

            func flushChunk() throws {
                guard let currentBucketId, !currentLines.isEmpty else {
                    return
                }

                let stagedBlob = try stageBlob(lines: currentLines, maxBlobBytes: maxBlobBytes)
                stagedBlobs[stagedBlob.hash] = stagedBlob
                sampleChunks.append(
                    RemoteSyncSampleChunkReference(
                        collectionKey: collection.key,
                        bucketId: currentBucketId,
                        blobHash: stagedBlob.hash,
                        encoding: "gzip",
                        format: "ndjson",
                        sampleCount: currentSampleCount,
                        minStartDate: currentMinStartDate,
                        maxStartDate: currentMaxStartDate
                    )
                )

                currentLines = []
                currentSampleCount = 0
                currentMinStartDate = nil
                currentMaxStartDate = nil
                currentBytes = 0
            }

            for sample in sortedSamples {
                let bucketId = sampleBucketID(for: sample)
                let line = try canonicalJSONData(sample)
                let lineBytes = line.count + 1

                if let currentBucketId,
                   (bucketId != currentBucketId || (currentSampleCount > 0 && currentBytes + lineBytes > targetBytes)) {
                    try flushChunk()
                }

                currentBucketId = bucketId
                currentLines.append(line)
                currentSampleCount += 1
                currentBytes += lineBytes
                let sampleStartDate = preferredSampleDate(for: sample)
                currentMinStartDate = minimumISO8601(currentMinStartDate, sampleStartDate)
                currentMaxStartDate = maximumISO8601(currentMaxStartDate, sampleStartDate)
            }

            try flushChunk()
        }

        return sampleChunks.sorted {
            ($0.collectionKey, $0.bucketId, $0.blobHash) < ($1.collectionKey, $1.bucketId, $1.blobHash)
        }
    }
}

private func stageBlob(lines: [Data], maxBlobBytes: Int) throws -> RemoteSyncStagedBlob {
    var uncompressed = Data()
    for line in lines {
        uncompressed.append(line)
        uncompressed.append(0x0A)
    }

    let hash = try sha256Hex(for: uncompressed)
    let compressed = try GzipCompression.gzipData(uncompressed)

    if compressed.count > maxBlobBytes {
        throw NSError(domain: "RemoteSync", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "A sync blob exceeded the receiver's maximum blob size.",
        ])
    }

    return RemoteSyncStagedBlob(
        hash: hash,
        data: compressed,
        uncompressedBytes: uncompressed.count,
        compressedBytes: compressed.count
    )
}

private func rebasedStateIfNeeded(
    _ state: RemoteSyncLocalState,
    minimumLastSequence: Int
) -> RemoteSyncLocalState {
    guard minimumLastSequence > state.lastSequence else {
        return state
    }

    return RemoteSyncLocalState(
        senderId: state.senderId,
        lastSequence: minimumLastSequence,
        currentManifestDigest: state.currentManifestDigest
    )
}

private func sampleBucketID(for sample: AppleHealthExportSample) -> String {
    guard let sourceDate = preferredSampleDate(for: sample), sourceDate.count >= 7 else {
        return "undated"
    }

    let bucket = String(sourceDate.prefix(7))
    return bucket.contains("-") ? bucket : "undated"
}

private func preferredSampleDate(for sample: AppleHealthExportSample) -> String? {
    normalizedISO8601Date(sample.startDate) ?? normalizedISO8601Date(sample.endDate)
}

private func normalizedISO8601Date(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
        return nil
    }

    return trimmed
}

private func sampleSort(_ lhs: AppleHealthExportSample, _ rhs: AppleHealthExportSample) -> Bool {
    (
        lhs.startDate ?? lhs.endDate ?? "",
        lhs.sampleId
    ) < (
        rhs.startDate ?? rhs.endDate ?? "",
        rhs.sampleId
    )
}

private func activitySort(_ lhs: AppleHealthExportActivity, _ rhs: AppleHealthExportActivity) -> Bool {
    (lhs.startDate ?? "", lhs.activityId) < (rhs.startDate ?? "", rhs.activityId)
}

private func collectionSort(_ lhs: AppleHealthExportCollection, _ rhs: AppleHealthExportCollection) -> Bool {
    lhs.key < rhs.key
}

private func hasRouteDocument(_ activity: AppleHealthExportActivity) -> Bool {
    activity.hasStreams || activity.summaryPolyline != nil || activity.routeStreams != nil
}

private func minimumISO8601(_ lhs: String?, _ rhs: String?) -> String? {
    switch (lhs, rhs) {
    case let (lhs?, rhs?):
        return min(lhs, rhs)
    case let (lhs?, nil):
        return lhs
    case let (nil, rhs?):
        return rhs
    case (nil, nil):
        return nil
    }
}

private func maximumISO8601(_ lhs: String?, _ rhs: String?) -> String? {
    switch (lhs, rhs) {
    case let (lhs?, rhs?):
        return max(lhs, rhs)
    case let (lhs?, nil):
        return lhs
    case let (nil, rhs?):
        return rhs
    case (nil, nil):
        return nil
    }
}

private func canonicalJSONData<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(value)
}

private func sha256Hex(for data: Data) throws -> String {
    let digest = SHA256.hash(data: data)
    return digest.map { String(format: "%02x", $0) }.joined()
}

func replicationID(senderId: String, receiverId: String, schema: String) -> String {
    let digest = SHA256.hash(data: Data("\(senderId)\n\(receiverId)\n\(schema)".utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
}
