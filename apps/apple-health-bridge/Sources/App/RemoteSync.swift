import CryptoKit
import Foundation

enum RemoteSyncConstants {
    static let protocolVersion = 3
    static let schema = "apple-health-blobs.v3"
    static let endpointPath = "/health-sync"
    static let sampleChunkTargetBytes = 2_500_000
    static let minimumSampleChunkTargetBytes = 512_000
}

typealias RemoteSyncLogHandler = (String) -> Void

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
    let fileURL: URL
    let uncompressedBytes: Int
    let compressedBytes: Int

    func loadData() throws -> Data {
        try Data(contentsOf: fileURL)
    }
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
    private let stagingDirectory: RemoteSyncStagingDirectory

    fileprivate init(
        replicationId: String,
        checkpointSequence: Int?,
        manifest: RemoteSyncSnapshotManifest,
        manifestDigest: String,
        sequence: Int,
        nextState: RemoteSyncLocalState,
        stagedBlobs: [String: RemoteSyncStagedBlob],
        recoveredSenderState: Bool,
        changed: Bool,
        stagingDirectory: RemoteSyncStagingDirectory
    ) {
        self.replicationId = replicationId
        self.checkpointSequence = checkpointSequence
        self.manifest = manifest
        self.manifestDigest = manifestDigest
        self.sequence = sequence
        self.nextState = nextState
        self.stagedBlobs = stagedBlobs
        self.recoveredSenderState = recoveredSenderState
        self.changed = changed
        self.stagingDirectory = stagingDirectory
    }

    var blobCount: Int {
        stagedBlobs.count
    }

    var totalBlobBytes: Int {
        stagedBlobs.values.reduce(0) { $0 + $1.compressedBytes }
    }

    func cleanupStagedBlobs() {
        stagingDirectory.remove()
    }
}

private final class RemoteSyncStagingDirectory: @unchecked Sendable {
    let url: URL

    init() throws {
        let baseURL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ??
            URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
        url = baseURL
            .appendingPathComponent("remote-sync-staging", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }

    func remove() {
        try? FileManager.default.removeItem(at: url)
    }

    deinit {
        remove()
    }
}

private struct RemoteSyncRouteBlobData: Codable, Sendable {
    let activityId: String
    let summaryPolyline: String?
    let hasStreams: Bool
    let routeStreams: AppleHealthExportRouteStreams?
}

private struct RemoteSyncActivitySummaryBlobData: Codable, Sendable {
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
        checkpointSequence: Int?,
        logger: RemoteSyncLogHandler? = nil
    ) throws -> RemoteSyncPreparedSync {
        let stagingDirectory = try RemoteSyncStagingDirectory()
        do {
            return try prepareSync(
                snapshot: snapshot,
                state: state,
                receiverStatus: receiverStatus,
                checkpointSequence: checkpointSequence,
                stagingDirectory: stagingDirectory,
                logger: logger
            )
        } catch {
            stagingDirectory.remove()
            throw error
        }
    }

    private static func prepareSync(
        snapshot: AppleHealthExportSnapshot,
        state: RemoteSyncLocalState,
        receiverStatus: RemoteSyncStatusResponse,
        checkpointSequence: Int?,
        stagingDirectory: RemoteSyncStagingDirectory,
        logger: RemoteSyncLogHandler?
    ) throws -> RemoteSyncPreparedSync {
        let rebasedState = rebasedStateIfNeeded(state, minimumLastSequence: checkpointSequence ?? 0)
        let replicationId = replicationID(
            senderId: rebasedState.senderId,
            receiverId: receiverStatus.receiverId,
            schema: receiverStatus.schema
        )
        let totalSamples = snapshot.collections.values.reduce(0) { $0 + $1.samples.count }
        logger?(
            "Manifest prep started totalSamples=\(totalSamples) activities=\(snapshot.activities.count) collections=\(snapshot.collections.count) staging=\(stagingDirectory.url.lastPathComponent)"
        )

        var stagedBlobs: [String: RemoteSyncStagedBlob] = [:]
        var controlBlobs: [RemoteSyncControlBlobReference] = []

        if !snapshot.activities.isEmpty {
            logger?("Manifest prep staging activity_summaries count=\(snapshot.activities.count)")
            let activityBlob = try stageBlob(
                lines: snapshot.activities.values
                    .sorted(by: activitySort)
                    .map(activitySummaryBlobData)
                    .map(canonicalJSONData),
                maxBlobBytes: receiverStatus.maxBlobBytes,
                stagingDirectory: stagingDirectory
            )
            stagedBlobs[activityBlob.hash] = activityBlob
            logger?(
                "Manifest prep staged activity_summaries hash=\(shortHash(activityBlob.hash)) uncompressedBytes=\(activityBlob.uncompressedBytes) compressedBytes=\(activityBlob.compressedBytes)"
            )
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
            logger?("Manifest prep staging routes count=\(routeLines.count)")
            let routeBlob = try stageBlob(
                lines: routeLines.map(canonicalJSONData),
                maxBlobBytes: receiverStatus.maxBlobBytes,
                stagingDirectory: stagingDirectory
            )
            stagedBlobs[routeBlob.hash] = routeBlob
            logger?(
                "Manifest prep staged routes hash=\(shortHash(routeBlob.hash)) uncompressedBytes=\(routeBlob.uncompressedBytes) compressedBytes=\(routeBlob.compressedBytes)"
            )
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
            logger?("Manifest prep staging collection_metadata count=\(snapshot.collections.count)")
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
                maxBlobBytes: receiverStatus.maxBlobBytes,
                stagingDirectory: stagingDirectory
            )
            stagedBlobs[collectionMetadataBlob.hash] = collectionMetadataBlob
            logger?(
                "Manifest prep staged collection_metadata hash=\(shortHash(collectionMetadataBlob.hash)) uncompressedBytes=\(collectionMetadataBlob.uncompressedBytes) compressedBytes=\(collectionMetadataBlob.compressedBytes)"
            )
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
            logger?("Manifest prep staging deleted_activity_ids count=\(deletedActivityIds.count)")
            let deletedBlob = try stageBlob(
                lines: deletedActivityIds.map(canonicalJSONData),
                maxBlobBytes: receiverStatus.maxBlobBytes,
                stagingDirectory: stagingDirectory
            )
            stagedBlobs[deletedBlob.hash] = deletedBlob
            logger?(
                "Manifest prep staged deleted_activity_ids hash=\(shortHash(deletedBlob.hash)) uncompressedBytes=\(deletedBlob.uncompressedBytes) compressedBytes=\(deletedBlob.compressedBytes)"
            )
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
            stagingDirectory: stagingDirectory,
            stagedBlobs: &stagedBlobs,
            logger: logger
        )

        logger?("Manifest prep encoding snapshot manifest sampleChunks=\(sampleChunks.count) controlBlobs=\(controlBlobs.count)")
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

        let prepared = RemoteSyncPreparedSync(
            replicationId: replicationId,
            checkpointSequence: checkpointSequence,
            manifest: manifest,
            manifestDigest: manifestDigest,
            sequence: sequence,
            nextState: nextState,
            stagedBlobs: stagedBlobs,
            recoveredSenderState: (checkpointSequence ?? 0) > state.lastSequence,
            changed: changed,
            stagingDirectory: stagingDirectory
        )
        logger?(
            "Manifest prep finished sequence=\(sequence) changed=\(changed) recoveredSenderState=\((checkpointSequence ?? 0) > state.lastSequence) blobCount=\(prepared.blobCount) totalBlobBytes=\(prepared.totalBlobBytes) manifestDigest=\(shortHash(manifestDigest))"
        )
        return prepared
    }

    private static func buildSampleChunks(
        from snapshot: AppleHealthExportSnapshot,
        maxBlobBytes: Int,
        stagingDirectory: RemoteSyncStagingDirectory,
        stagedBlobs: inout [String: RemoteSyncStagedBlob],
        logger: RemoteSyncLogHandler?
    ) throws -> [RemoteSyncSampleChunkReference] {
        let targetBytes = max(
            min(RemoteSyncConstants.sampleChunkTargetBytes, maxBlobBytes / 2),
            RemoteSyncConstants.minimumSampleChunkTargetBytes
        )

        var sampleChunks: [RemoteSyncSampleChunkReference] = []
        let sortedCollections = snapshot.collections.values.sorted(by: collectionSort)
        let totalSamples = sortedCollections.reduce(0) { $0 + $1.samples.count }
        logger?(
            "Manifest prep sample chunking begin collections=\(sortedCollections.count) totalSamples=\(totalSamples) targetBytes=\(targetBytes)"
        )

        for (collectionIndex, collection) in sortedCollections.enumerated() {
            let sortedSampleIndices = collection.samples.indices.sorted {
                sampleSort(collection.samples[$0], collection.samples[$1])
            }
            var currentBucketId: String?
            var currentLines: [Data] = []
            var currentSampleCount = 0
            var currentMinStartDate: String?
            var currentMaxStartDate: String?
            var currentBytes = 0
            var collectionChunkCount = 0
            var collectionCompressedBytes = 0
            var collectionUncompressedBytes = 0

            logger?(
                "Manifest prep sample collection begin index=\(collectionIndex + 1)/\(sortedCollections.count) key=\(collection.key) samples=\(collection.samples.count) sortIndexBytes=\(sortedSampleIndices.count * MemoryLayout<Int>.stride)"
            )

            func flushChunk() throws {
                guard let currentBucketId, !currentLines.isEmpty else {
                    return
                }

                let nextChunkNumber = collectionChunkCount + 1
                logger?(
                    "Manifest prep sample chunk stage begin key=\(collection.key) chunk=\(nextChunkNumber) bucket=\(currentBucketId) samples=\(currentSampleCount) uncompressedBytes=\(currentBytes)"
                )
                let stagedBlob = try stageBlob(
                    lines: currentLines,
                    maxBlobBytes: maxBlobBytes,
                    stagingDirectory: stagingDirectory
                )
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
                collectionChunkCount += 1
                collectionCompressedBytes += stagedBlob.compressedBytes
                collectionUncompressedBytes += stagedBlob.uncompressedBytes
                logger?(
                    "Manifest prep sample chunk staged key=\(collection.key) chunk=\(collectionChunkCount) bucket=\(currentBucketId) hash=\(shortHash(stagedBlob.hash)) compressedBytes=\(stagedBlob.compressedBytes) totalChunks=\(sampleChunks.count)"
                )

                currentLines.removeAll(keepingCapacity: false)
                currentSampleCount = 0
                currentMinStartDate = nil
                currentMaxStartDate = nil
                currentBytes = 0
            }

            for sampleIndex in sortedSampleIndices {
                let sample = collection.samples[sampleIndex]
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
            logger?(
                "Manifest prep sample collection finished key=\(collection.key) chunks=\(collectionChunkCount) uncompressedBytes=\(collectionUncompressedBytes) compressedBytes=\(collectionCompressedBytes)"
            )
        }

        let sortedSampleChunks = sampleChunks.sorted {
            ($0.collectionKey, $0.bucketId, $0.blobHash) < ($1.collectionKey, $1.bucketId, $1.blobHash)
        }
        logger?("Manifest prep sample chunking finished chunks=\(sortedSampleChunks.count)")
        return sortedSampleChunks
    }
}

private func activitySummaryBlobData(_ activity: AppleHealthExportActivity) -> RemoteSyncActivitySummaryBlobData {
    RemoteSyncActivitySummaryBlobData(
        activityId: activity.activityId,
        sportType: activity.sportType,
        startDate: activity.startDate,
        distanceMeters: activity.distanceMeters,
        distanceKm: activity.distanceKm,
        movingTimeSeconds: activity.movingTimeSeconds,
        elapsedTimeSeconds: activity.elapsedTimeSeconds,
        averageHeartrate: activity.averageHeartrate,
        maxHeartrate: activity.maxHeartrate,
        detailFetchedAt: activity.detailFetchedAt,
        source: activity.source
    )
}

private func stageBlob(
    lines: [Data],
    maxBlobBytes: Int,
    stagingDirectory: RemoteSyncStagingDirectory
) throws -> RemoteSyncStagedBlob {
    let fileManager = FileManager.default
    let uncompressedURL = stagingDirectory.url
        .appendingPathComponent("\(UUID().uuidString).ndjson")
    let compressedTemporaryURL = stagingDirectory.url
        .appendingPathComponent("\(UUID().uuidString).ndjson.gz.tmp")
    var didMoveCompressedFile = false

    defer {
        try? fileManager.removeItem(at: uncompressedURL)
        if !didMoveCompressedFile {
            try? fileManager.removeItem(at: compressedTemporaryURL)
        }
    }

    guard fileManager.createFile(atPath: uncompressedURL.path, contents: nil) else {
        throw NSError(domain: "RemoteSync", code: 10, userInfo: [
            NSLocalizedDescriptionKey: "Failed to create a temporary sync blob file.",
        ])
    }

    let newline = Data([0x0A])
    var hasher = SHA256()
    var uncompressedBytes = 0
    let handle = try FileHandle(forWritingTo: uncompressedURL)
    do {
        for line in lines {
            try handle.write(contentsOf: line)
            hasher.update(data: line)
            try handle.write(contentsOf: newline)
            hasher.update(data: newline)
            uncompressedBytes += line.count + newline.count
        }
        try handle.close()
    } catch {
        try? handle.close()
        throw error
    }

    let hash = hexString(for: hasher.finalize())
    try GzipCompression.gzipFile(at: uncompressedURL, to: compressedTemporaryURL)
    let compressedBytes = try fileSize(at: compressedTemporaryURL)

    if compressedBytes > maxBlobBytes {
        throw NSError(domain: "RemoteSync", code: 2, userInfo: [
            NSLocalizedDescriptionKey: "A sync blob exceeded the receiver's maximum blob size.",
        ])
    }

    let compressedURL = stagingDirectory.url
        .appendingPathComponent("\(hash).ndjson.gz")
    if fileManager.fileExists(atPath: compressedURL.path) {
        try fileManager.removeItem(at: compressedURL)
    }
    try fileManager.moveItem(at: compressedTemporaryURL, to: compressedURL)
    didMoveCompressedFile = true

    return RemoteSyncStagedBlob(
        hash: hash,
        fileURL: compressedURL,
        uncompressedBytes: uncompressedBytes,
        compressedBytes: compressedBytes
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
    return hexString(for: digest)
}

private func hexString<Digest: Sequence>(for digest: Digest) -> String where Digest.Element == UInt8 {
    digest.map { String(format: "%02x", $0) }.joined()
}

private func shortHash(_ hash: String) -> String {
    String(hash.prefix(12))
}

private func fileSize(at url: URL) throws -> Int {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard let fileSize = attributes[.size] as? NSNumber else {
        throw NSError(domain: "RemoteSync", code: 11, userInfo: [
            NSLocalizedDescriptionKey: "Failed to read staged sync blob size.",
        ])
    }
    return fileSize.intValue
}

func replicationID(senderId: String, receiverId: String, schema: String) -> String {
    let digest = SHA256.hash(data: Data("\(senderId)\n\(receiverId)\n\(schema)".utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
}
