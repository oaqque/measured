import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  commitReceiverSession,
  createReceiverSession,
  getReceiverStatus,
  type AppleHealthSyncReceiverOptions,
  appendReceiverDeltaBatch,
} from "./apple-health-sync-receiver-lib"
import type {
  AppleHealthSyncCommitRequest,
  AppleHealthSyncDeltaBatch,
  AppleHealthSyncSessionCreateRequest,
} from "./apple-health-sync-protocol"

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map(async (targetPath) => fs.rm(targetPath, { recursive: true, force: true })),
  )
})

describe("apple health sync receiver", () => {
  it("creates, stages, and commits a delta session into the apple health cache", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-sync-"))
    tempDirectories.push(root)

    const options: AppleHealthSyncReceiverOptions = {
      outputRoot: path.join(root, "vault", "apple-health"),
      stateRoot: path.join(root, "vault", "apple-health-sync-server"),
    }

    const status = await getReceiverStatus(options)
    expect(status.lastAppliedCheckpoint).toBeNull()

    const session = await createReceiverSession(options, {
      senderId: "bridge-iphone",
      schema: "apple-health-cache.v1",
      baseCheckpoint: null,
      newCheckpoint: "ckpt-001",
    } satisfies AppleHealthSyncSessionCreateRequest)

    const batch = {
      sessionId: session.sessionId,
      sequence: 1,
      activitiesUpsert: [
        {
          activityId: "activity-1",
          hash: "sha256:activity-1",
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
            summaryPolyline: "abc",
            detailFetchedAt: "2026-04-10T08:10:00Z",
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
            source: {
              bundleIdentifier: "com.apple.Fitness",
              name: "Workout",
              deviceName: "Apple Watch",
              deviceModel: "Watch",
            },
          },
        },
      ],
      routesUpsert: [],
      collectionsUpsert: [
        {
          key: "heartRate",
          hash: "sha256:heartRate",
          data: {
            key: "heartRate",
            kind: "quantity",
            displayName: "Heart Rate",
            unit: "count/min",
            samples: [
              {
                sampleId: "sample-1",
                startDate: "2026-04-10T08:00:00Z",
                endDate: "2026-04-10T08:00:05Z",
                numericValue: 145,
                categoryValue: null,
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
            ],
          },
        },
      ],
      activitiesDelete: [],
      collectionsDelete: [],
      samplesDelete: [],
    } satisfies AppleHealthSyncDeltaBatch

    await appendReceiverDeltaBatch(options, batch, JSON.stringify(batch))
    await commitReceiverSession(options, {
      sessionId: session.sessionId,
      newCheckpoint: "ckpt-001",
      batchCount: 1,
    } satisfies AppleHealthSyncCommitRequest)

    const cacheExport = JSON.parse(
      await fs.readFile(path.join(options.outputRoot, "cache-export.json"), "utf8"),
    ) as {
      activities: Record<string, { distanceMeters: number | null }>
      collections: Record<string, { samples: Array<{ sampleId: string }> }>
      deletedActivityIds: string[]
    }

    expect(cacheExport.activities["activity-1"]?.distanceMeters).toBe(5000)
    expect(cacheExport.collections.heartRate?.samples).toHaveLength(1)
    expect(cacheExport.deletedActivityIds).toEqual([])

    const nextSession = await createReceiverSession(options, {
      senderId: "bridge-iphone",
      schema: "apple-health-cache.v1",
      baseCheckpoint: "ckpt-001",
      newCheckpoint: "ckpt-002",
    } satisfies AppleHealthSyncSessionCreateRequest)

    const deleteBatch = {
      sessionId: nextSession.sessionId,
      sequence: 1,
      activitiesUpsert: [],
      routesUpsert: [],
      collectionsUpsert: [],
      activitiesDelete: ["activity-1"],
      collectionsDelete: [],
      samplesDelete: [
        {
          collectionKey: "heartRate",
          sampleId: "sample-1",
        },
      ],
    } satisfies AppleHealthSyncDeltaBatch

    await appendReceiverDeltaBatch(options, deleteBatch, JSON.stringify(deleteBatch))
    await commitReceiverSession(options, {
      sessionId: nextSession.sessionId,
      newCheckpoint: "ckpt-002",
      batchCount: 1,
    } satisfies AppleHealthSyncCommitRequest)

    const updatedExport = JSON.parse(
      await fs.readFile(path.join(options.outputRoot, "cache-export.json"), "utf8"),
    ) as {
      activities: Record<string, unknown>
      collections: Record<string, { samples: Array<{ sampleId: string }> }>
      deletedActivityIds: string[]
    }

    expect(updatedExport.activities["activity-1"]).toBeUndefined()
    expect(updatedExport.collections.heartRate?.samples).toEqual([])
    expect(updatedExport.deletedActivityIds).toEqual(["activity-1"])
  })
})
