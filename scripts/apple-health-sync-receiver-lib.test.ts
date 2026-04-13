import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { afterEach, describe, expect, it } from "vitest"
import {
  ConflictError,
  DEFAULT_MAX_BLOB_BYTES,
  NotFoundError,
  ValidationError,
  bulkApplyReceiverDocuments,
  commitReceiverManifest,
  getLegacyReceiverStatus,
  getReceiverCheckpoint,
  getReceiverRevsDiff,
  getReceiverStatus,
  planReceiverManifest,
  putReceiverBlob,
  putReceiverCheckpoint,
  type AppleHealthSyncReceiverOptions,
} from "./apple-health-sync-receiver-lib"
import type {
  AppleHealthSyncBulkDocsRequest,
  AppleHealthSyncCheckpointRequest,
  AppleHealthSyncCommitRequest,
  AppleHealthSyncControlBlobKind,
  AppleHealthSyncDocument,
  AppleHealthSyncRevsDiffRequest,
  AppleHealthSyncSnapshotManifest,
} from "./apple-health-sync-protocol"

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map(async (targetPath) => fs.rm(targetPath, { recursive: true, force: true })),
  )
})

describe("apple health sync receiver v2", () => {
  it("applies documents, materializes the snapshot, and persists checkpoints", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-sync-v2-"))
    tempDirectories.push(root)

    const options: AppleHealthSyncReceiverOptions = {
      outputRoot: path.join(root, "vault", "apple-health"),
      stateRoot: path.join(root, "vault", "apple-health-sync-server"),
    }

    const status = await getLegacyReceiverStatus(options)
    expect(status.protocolVersion).toBe(2)
    expect(status.schema).toBe("apple-health-docs.v2")

    await expect(getReceiverCheckpoint(options, "replication-1")).rejects.toBeInstanceOf(NotFoundError)

    const documents = [
      createDocument("meta:snapshot", 1, "snapshotMeta", false, {
        registryGeneratedAt: "2026-04-10T06:53:51.367Z",
      }),
      createDocument("activity:activity-1", 1, "activity", false, {
        activityId: "activity-1",
        sportType: "run",
        startDate: "2026-04-10T08:00:00Z",
        distanceMeters: 5000,
        distanceKm: 5,
        movingTimeSeconds: 1500,
        elapsedTimeSeconds: 1510,
        averageHeartrate: 145,
        maxHeartrate: 170,
        source: {
          bundleIdentifier: "com.apple.Fitness",
          name: "Workout",
          deviceName: "Apple Watch",
          deviceModel: "Watch",
        },
      }),
      createDocument("route:activity-1", 1, "route", false, {
        activityId: "activity-1",
        summaryPolyline: "abc",
        hasStreams: true,
        routeStreams: {
          latlng: [
            [-33.8, 151.2],
            [-33.81, 151.21],
          ],
          altitude: [12, 13],
          distance: [0, 5000],
          heartrate: null,
          velocitySmooth: [0, 3.2],
          moving: null,
        },
      }),
      createDocument("collectionMeta:heartRate", 1, "collectionMeta", false, {
        key: "heartRate",
        kind: "quantity",
        displayName: "Heart Rate",
        unit: "count/min",
        objectTypeIdentifier: "HKQuantityTypeIdentifierHeartRate",
        queryStrategy: "quantity",
        requiresPerObjectAuthorization: false,
      }),
      createDocument("sample:heartRate:sample-1", 1, "sample", false, {
        collectionKey: "heartRate",
        sample: {
          sampleId: "sample-1",
          startDate: "2026-04-10T08:00:00Z",
          endDate: "2026-04-10T08:00:05Z",
          numericValue: 145,
          categoryValue: null,
          textValue: "145 bpm",
          payload: {
            trend: "steady",
          },
          source: {
            bundleIdentifier: "com.apple.Fitness",
            name: "Workout",
            deviceName: "Apple Watch",
            deviceModel: "Watch",
          },
          metadata: {
            HKMetadataKeySyncIdentifier: "sample-1",
          },
        },
      }),
    ] satisfies AppleHealthSyncDocument[]

    const revsDiff = await getReceiverRevsDiff(
      options,
      Object.fromEntries(documents.map((document) => [document._id, [document._rev]])) satisfies AppleHealthSyncRevsDiffRequest,
    )
    expect(Object.keys(revsDiff)).toHaveLength(documents.length)

    const request = {
      docs: documents,
      new_edits: false,
    } satisfies AppleHealthSyncBulkDocsRequest
    const rawBody = JSON.stringify(request)

    const bulkResponse = await bulkApplyReceiverDocuments(options, request, rawBody)
    expect(bulkResponse).toHaveLength(documents.length)
    expect(bulkResponse.every((row) => row.ok === true)).toBe(true)

    const checkpointRequest = {
      lastSequence: 5,
      updatedAt: "2026-04-10T08:10:00Z",
    } satisfies AppleHealthSyncCheckpointRequest
    const checkpoint = await putReceiverCheckpoint(options, "replication-1", checkpointRequest)
    expect(checkpoint.lastSequence).toBe(5)

    const restoredCheckpoint = await getReceiverCheckpoint(options, "replication-1")
    expect(restoredCheckpoint.lastSequence).toBe(5)

    const snapshot = JSON.parse(
      await fs.readFile(path.join(options.outputRoot, "cache-export.json"), "utf8"),
    ) as {
      registryGeneratedAt?: string | null
      activities: Record<string, { distanceMeters: number | null; hasStreams: boolean; detailFetchedAt: string | null }>
      collections: Record<string, { samples: Array<{ sampleId: string; textValue?: string | null }> }>
      deletedActivityIds: string[]
    }

    expect(snapshot.registryGeneratedAt).toBe("2026-04-10T06:53:51.367Z")
    expect(snapshot.activities["activity-1"]?.distanceMeters).toBe(5000)
    expect(snapshot.activities["activity-1"]?.hasStreams).toBe(true)
    expect(snapshot.activities["activity-1"]?.detailFetchedAt).toBe("2026-04-10T00:00:00.000Z")
    expect(snapshot.collections.heartRate?.samples.map((sample) => sample.sampleId)).toEqual(["sample-1"])
    expect(snapshot.deletedActivityIds).toEqual([])
  })

  it("treats replayed revisions as no-ops and exposes stale lower generations as missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-sync-v2-"))
    tempDirectories.push(root)

    const options: AppleHealthSyncReceiverOptions = {
      outputRoot: path.join(root, "vault", "apple-health"),
      stateRoot: path.join(root, "vault", "apple-health-sync-server"),
    }

    const activity = createDocument("activity:activity-1", 2, "activity", false, {
      activityId: "activity-1",
      sportType: "run",
      startDate: "2026-04-10T08:00:00Z",
      distanceMeters: 5000,
      distanceKm: 5,
      movingTimeSeconds: 1500,
      elapsedTimeSeconds: 1510,
      averageHeartrate: 145,
      maxHeartrate: 170,
      source: null,
    })
    const replayRequest = { docs: [activity], new_edits: false } satisfies AppleHealthSyncBulkDocsRequest
    await bulkApplyReceiverDocuments(options, replayRequest, JSON.stringify(replayRequest))
    await bulkApplyReceiverDocuments(options, replayRequest, JSON.stringify(replayRequest))

    const staleRevision = {
      ...activity,
      _rev: createRevision(1, { stale: true }),
    }
    const staleRequest = { docs: [staleRevision], new_edits: false } satisfies AppleHealthSyncBulkDocsRequest
    await bulkApplyReceiverDocuments(options, staleRequest, JSON.stringify(staleRequest))

    const snapshot = JSON.parse(
      await fs.readFile(path.join(options.outputRoot, "cache-export.json"), "utf8"),
    ) as { activities: Record<string, { distanceMeters: number | null }> }
    expect(snapshot.activities["activity-1"]?.distanceMeters).toBe(5000)

    const revsDiff = await getReceiverRevsDiff(options, {
      "activity:activity-1": [activity._rev, staleRevision._rev],
    })
    expect(revsDiff["activity:activity-1"]?.missing).toEqual([staleRevision._rev])
  })

  it("treats lower-generation revisions with different content as missing and applies them when newer", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-sync-v2-"))
    tempDirectories.push(root)

    const options: AppleHealthSyncReceiverOptions = {
      outputRoot: path.join(root, "vault", "apple-health"),
      stateRoot: path.join(root, "vault", "apple-health-sync-server"),
    }

    const originalActivity = {
      _id: "activity:activity-1",
      _rev: createRevision(5, { distanceMeters: 5000 }),
      type: "activity",
      deleted: false,
      updatedAt: "2026-04-10T08:00:00Z",
      data: {
        activityId: "activity-1",
        sportType: "run",
        startDate: "2026-04-10T08:00:00Z",
        distanceMeters: 5000,
        distanceKm: 5,
        movingTimeSeconds: 1500,
        elapsedTimeSeconds: 1510,
        averageHeartrate: 145,
        maxHeartrate: 170,
        source: null,
      },
    } satisfies AppleHealthSyncDocument

    const initialRequest = { docs: [originalActivity], new_edits: false } satisfies AppleHealthSyncBulkDocsRequest
    await bulkApplyReceiverDocuments(options, initialRequest, JSON.stringify(initialRequest))

    const rebuiltActivity = {
      ...originalActivity,
      _rev: createRevision(1, { distanceMeters: 5200 }),
      updatedAt: "2026-04-10T08:05:00Z",
      data: {
        ...originalActivity.data,
        distanceMeters: 5200,
        distanceKm: 5.2,
      },
    } satisfies AppleHealthSyncDocument

    const revsDiff = await getReceiverRevsDiff(options, {
      "activity:activity-1": [rebuiltActivity._rev],
    })
    expect(revsDiff["activity:activity-1"]?.missing).toEqual([rebuiltActivity._rev])

    const rebuiltRequest = { docs: [rebuiltActivity], new_edits: false } satisfies AppleHealthSyncBulkDocsRequest
    await bulkApplyReceiverDocuments(options, rebuiltRequest, JSON.stringify(rebuiltRequest))

    const snapshot = JSON.parse(
      await fs.readFile(path.join(options.outputRoot, "cache-export.json"), "utf8"),
    ) as { activities: Record<string, { distanceMeters: number | null }> }
    expect(snapshot.activities["activity-1"]?.distanceMeters).toBe(5200)
  })

  it("materializes deletions from tombstones", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-sync-v2-"))
    tempDirectories.push(root)

    const options: AppleHealthSyncReceiverOptions = {
      outputRoot: path.join(root, "vault", "apple-health"),
      stateRoot: path.join(root, "vault", "apple-health-sync-server"),
    }

    const initialDocuments = [
      createDocument("activity:activity-1", 1, "activity", false, {
        activityId: "activity-1",
        sportType: "run",
        startDate: "2026-04-10T08:00:00Z",
        distanceMeters: 5000,
        distanceKm: 5,
        movingTimeSeconds: 1500,
        elapsedTimeSeconds: 1510,
        averageHeartrate: 145,
        maxHeartrate: 170,
        source: null,
      }),
      createDocument("collectionMeta:heartRate", 1, "collectionMeta", false, {
        key: "heartRate",
        kind: "quantity",
        displayName: "Heart Rate",
        unit: "count/min",
        objectTypeIdentifier: null,
        queryStrategy: null,
        requiresPerObjectAuthorization: null,
      }),
      createDocument("sample:heartRate:sample-1", 1, "sample", false, {
        collectionKey: "heartRate",
        sample: {
          sampleId: "sample-1",
          startDate: "2026-04-10T08:00:00Z",
          endDate: "2026-04-10T08:00:05Z",
          numericValue: 145,
          categoryValue: null,
          textValue: null,
          payload: null,
          source: null,
          metadata: null,
        },
      }),
    ] satisfies AppleHealthSyncDocument[]

    const initialRequest = { docs: initialDocuments, new_edits: false } satisfies AppleHealthSyncBulkDocsRequest
    await bulkApplyReceiverDocuments(options, initialRequest, JSON.stringify(initialRequest))

    const tombstones = [
      createDocument("activity:activity-1", 2, "activity", true),
      createDocument("sample:heartRate:sample-1", 2, "sample", true),
    ] satisfies AppleHealthSyncDocument[]
    const tombstoneRequest = { docs: tombstones, new_edits: false } satisfies AppleHealthSyncBulkDocsRequest
    await bulkApplyReceiverDocuments(options, tombstoneRequest, JSON.stringify(tombstoneRequest))

    const snapshot = JSON.parse(
      await fs.readFile(path.join(options.outputRoot, "cache-export.json"), "utf8"),
    ) as {
      activities: Record<string, unknown>
      collections: Record<string, { samples: Array<{ sampleId: string }> }>
      deletedActivityIds: string[]
    }

    expect(snapshot.activities["activity-1"]).toBeUndefined()
    expect(snapshot.collections.heartRate?.samples).toEqual([])
    expect(snapshot.deletedActivityIds).toEqual(["activity-1"])
  })

  it("fails closed when existing receiver state is unreadable", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-sync-v2-"))
    tempDirectories.push(root)

    const options: AppleHealthSyncReceiverOptions = {
      outputRoot: path.join(root, "vault", "apple-health"),
      stateRoot: path.join(root, "vault", "apple-health-sync-server"),
    }

    await fs.mkdir(options.stateRoot, { recursive: true })
    await fs.writeFile(path.join(options.stateRoot, "receiver.sqlite3"), "not a sqlite database", "utf8")

    await expect(
      getReceiverRevsDiff(options, {
        "activity:activity-1": [createRevision(1, { anything: true })],
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("rejects checkpoint regressions", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-sync-v2-"))
    tempDirectories.push(root)

    const options: AppleHealthSyncReceiverOptions = {
      outputRoot: path.join(root, "vault", "apple-health"),
      stateRoot: path.join(root, "vault", "apple-health-sync-server"),
    }

    await putReceiverCheckpoint(options, "replication-1", {
      lastSequence: 10,
      updatedAt: "2026-04-10T08:10:00Z",
    })

    await expect(
      putReceiverCheckpoint(options, "replication-1", {
        lastSequence: 9,
        updatedAt: "2026-04-10T08:11:00Z",
      }),
    ).rejects.toBeInstanceOf(ConflictError)
  })
})

describe("apple health sync receiver v3", () => {
  it("plans missing blobs, commits a snapshot, and materializes artifacts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-sync-v3-"))
    tempDirectories.push(root)

    const options: AppleHealthSyncReceiverOptions = {
      outputRoot: path.join(root, "vault", "apple-health"),
      stateRoot: path.join(root, "vault", "apple-health-sync-server"),
      maxBlobBytes: DEFAULT_MAX_BLOB_BYTES,
    }

    const status = await getReceiverStatus(options)
    expect(status.protocolVersion).toBe(3)
    expect(status.schema).toBe("apple-health-blobs.v3")

    const activityBlob = createNdjsonGzipBlob([
      {
        activityId: "activity-1",
        sportType: "run",
        startDate: "2026-04-10T08:00:00Z",
        distanceMeters: 5000,
        distanceKm: 5,
        movingTimeSeconds: 1500,
        elapsedTimeSeconds: 1510,
        averageHeartrate: 145,
        maxHeartrate: 170,
        summaryPolyline: null,
        detailFetchedAt: "2026-04-10T08:10:00Z",
        hasStreams: false,
        routeStreams: null,
        source: null,
      },
    ])

    const routeBlob = createNdjsonGzipBlob([
      {
        activityId: "activity-1",
        summaryPolyline: "abc",
        hasStreams: true,
        routeStreams: {
          latlng: [[-33.8, 151.2], [-33.81, 151.21]],
          altitude: [12, 13],
          distance: [0, 5000],
          heartrate: null,
          velocitySmooth: [0, 3.2],
          moving: null,
        },
      },
    ])

    const collectionMetadataBlob = createNdjsonGzipBlob([
      {
        key: "heartRate",
        kind: "quantity",
        displayName: "Heart Rate",
        unit: "count/min",
        objectTypeIdentifier: "HKQuantityTypeIdentifierHeartRate",
        queryStrategy: "quantity",
        requiresPerObjectAuthorization: false,
      },
    ])

    const sampleChunkBlob = createNdjsonGzipBlob([
      {
        sampleId: "sample-1",
        startDate: "2026-04-10T08:00:00Z",
        endDate: "2026-04-10T08:00:05Z",
        numericValue: 145,
        categoryValue: null,
        textValue: "145 bpm",
        payload: { trend: "steady" },
        source: null,
        metadata: { HKMetadataKeySyncIdentifier: "sample-1" },
      },
    ])

    const snapshot = createV3SnapshotManifest({
      generatedAt: "2026-04-10T08:10:00Z",
      registryGeneratedAt: "2026-04-10T06:53:51.367Z",
      controlBlobs: [
        controlBlobRef("activity_summaries", activityBlob.hash, 1),
        controlBlobRef("routes", routeBlob.hash, 1),
        controlBlobRef("collection_metadata", collectionMetadataBlob.hash, 1),
      ],
      sampleChunks: [
        {
          collectionKey: "heartRate",
          bucketId: "2026-04",
          blobHash: sampleChunkBlob.hash,
          encoding: "gzip",
          format: "ndjson",
          sampleCount: 1,
          minStartDate: "2026-04-10T08:00:00Z",
          maxStartDate: "2026-04-10T08:00:00Z",
        },
      ],
    })

    const planBeforeUpload = await planReceiverManifest(options, {
      replicationId: "replication-v3-1",
      lastSequence: 4,
      snapshot,
    })
    expect(new Set(planBeforeUpload.missingBlobHashes)).toEqual(new Set([
      activityBlob.hash,
      routeBlob.hash,
      collectionMetadataBlob.hash,
      sampleChunkBlob.hash,
    ]))

    await putReceiverBlob(options, activityBlob.hash, activityBlob.bytes)
    await putReceiverBlob(options, routeBlob.hash, routeBlob.bytes)
    await putReceiverBlob(options, collectionMetadataBlob.hash, collectionMetadataBlob.bytes)
    await putReceiverBlob(options, sampleChunkBlob.hash, sampleChunkBlob.bytes)

    const planAfterUpload = await planReceiverManifest(options, {
      replicationId: "replication-v3-1",
      lastSequence: 4,
      snapshot,
    })
    expect(planAfterUpload.missingBlobHashes).toEqual([])

    const commit = await commitReceiverManifest(options, {
      replicationId: "replication-v3-1",
      lastSequence: 4,
      snapshot,
    } satisfies AppleHealthSyncCommitRequest)
    expect(commit.lastSequence).toBe(4)

    const checkpoint = await getReceiverCheckpoint(options, "replication-v3-1")
    expect(checkpoint.lastSequence).toBe(4)

    const materialized = JSON.parse(
      await fs.readFile(path.join(options.outputRoot, "cache-export.json"), "utf8"),
    ) as {
      generatedAt: string
      registryGeneratedAt: string | null
      activities: Record<string, { hasStreams: boolean; summaryPolyline: string | null }>
      collections: Record<string, { samples: Array<{ sampleId: string }> }>
    }

    expect(materialized.generatedAt).toBe("2026-04-10T08:10:00Z")
    expect(materialized.registryGeneratedAt).toBe("2026-04-10T06:53:51.367Z")
    expect(materialized.activities["activity-1"]?.hasStreams).toBe(true)
    expect(materialized.activities["activity-1"]?.summaryPolyline).toBe("abc")
    expect(materialized.collections.heartRate?.samples.map((sample) => sample.sampleId)).toEqual(["sample-1"])
  })

  it("rejects commits that reference missing blobs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-sync-v3-"))
    tempDirectories.push(root)

    const options: AppleHealthSyncReceiverOptions = {
      outputRoot: path.join(root, "vault", "apple-health"),
      stateRoot: path.join(root, "vault", "apple-health-sync-server"),
      maxBlobBytes: DEFAULT_MAX_BLOB_BYTES,
    }

    const snapshot = createV3SnapshotManifest({
      generatedAt: "2026-04-10T08:10:00Z",
      registryGeneratedAt: null,
      controlBlobs: [controlBlobRef("deleted_activity_ids", "a".repeat(64), 0)],
      sampleChunks: [],
    })

    await expect(
      commitReceiverManifest(options, {
        replicationId: "replication-v3-1",
        lastSequence: 1,
        snapshot,
      }),
    ).rejects.toBeInstanceOf(ValidationError)
  })

  it("accepts omitted undated sample chunk bounds", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-sync-v3-"))
    tempDirectories.push(root)

    const options: AppleHealthSyncReceiverOptions = {
      outputRoot: path.join(root, "vault", "apple-health"),
      stateRoot: path.join(root, "vault", "apple-health-sync-server"),
      maxBlobBytes: DEFAULT_MAX_BLOB_BYTES,
    }

    const sampleChunkBlob = createNdjsonGzipBlob([
      {
        sampleId: "activityMoveMode",
        textValue: "HKActivityMoveMode(rawValue: 1)",
      },
    ])

    const snapshot = createV3SnapshotManifest({
      generatedAt: "2026-04-13T00:00:00Z",
      registryGeneratedAt: null,
      controlBlobs: [],
      sampleChunks: [
        {
          collectionKey: "activityMoveMode",
          bucketId: "undated",
          blobHash: sampleChunkBlob.hash,
          encoding: "gzip",
          format: "ndjson",
          sampleCount: 1,
        } as AppleHealthSyncSnapshotManifest["sampleChunks"][number],
      ],
    })

    await putReceiverBlob(options, sampleChunkBlob.hash, sampleChunkBlob.bytes)
    const commit = await commitReceiverManifest(options, {
      replicationId: "replication-v3-undated",
      lastSequence: 1,
      snapshot,
    } satisfies AppleHealthSyncCommitRequest)

    expect(commit.lastSequence).toBe(1)
  })
})

function createDocument(
  id: string,
  generation: number,
  type: AppleHealthSyncDocument["type"],
  deleted: boolean,
  data?: AppleHealthSyncDocument["data"],
): AppleHealthSyncDocument {
  return {
    _id: id,
    _rev: createRevision(generation, { id, type, deleted, data }),
    type,
    deleted,
    updatedAt: "2026-04-10T00:00:00.000Z",
    data,
  }
}

function createRevision(generation: number, value: unknown) {
  const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex")
  return `${generation}-${hash}`
}

function createNdjsonGzipBlob(lines: unknown[]) {
  const uncompressed = Buffer.from(lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8")
  const bytes = gzipSync(uncompressed)
  const hash = createHash("sha256").update(uncompressed).digest("hex")
  return { bytes, hash }
}

function controlBlobRef(kind: AppleHealthSyncControlBlobKind, blobHash: string, itemCount: number) {
  return {
    kind,
    blobHash,
    encoding: "gzip" as const,
    format: "ndjson" as const,
    itemCount,
  }
}

function createV3SnapshotManifest(
  overrides: AppleHealthSyncSnapshotManifest,
): AppleHealthSyncSnapshotManifest {
  return overrides
}
