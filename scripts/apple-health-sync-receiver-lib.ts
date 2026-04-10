import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import type {
  AppleHealthActivityExport,
  AppleHealthCacheExport,
  AppleHealthCollectionExport,
} from "./apple-health-import-lib"
import {
  APPLE_HEALTH_SYNC_PROTOCOL_VERSION,
  APPLE_HEALTH_SYNC_SCHEMA,
  type AppleHealthRouteExport,
  type AppleHealthSyncCommitRequest,
  type AppleHealthSyncCommitResponse,
  type AppleHealthSyncDeltaBatch,
  type AppleHealthSyncSessionCreateRequest,
  type AppleHealthSyncSessionCreateResponse,
  type AppleHealthSyncSessionStatusResponse,
  type AppleHealthSyncStatusResponse,
} from "./apple-health-sync-protocol"

export const DEFAULT_MAX_BATCH_BYTES = 5 * 1024 * 1024

export interface AppleHealthSyncReceiverOptions {
  outputRoot: string
  stateRoot: string
  receiverId?: string
  maxBatchBytes?: number
}

interface ReceiverMetadata {
  receiverId: string
  lastAppliedCheckpoint: string | null
}

interface StoredSession {
  sessionId: string
  senderId: string
  baseCheckpoint: string | null
  newCheckpoint: string
  state: "open" | "committed"
}

export class ConflictError extends Error {}
export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export async function getReceiverStatus(
  options: AppleHealthSyncReceiverOptions,
): Promise<AppleHealthSyncStatusResponse> {
  const metadata = await loadReceiverMetadata(options)
  return {
    protocolVersion: APPLE_HEALTH_SYNC_PROTOCOL_VERSION,
    receiverId: metadata.receiverId,
    lastAppliedCheckpoint: metadata.lastAppliedCheckpoint,
    acceptedSchemas: [APPLE_HEALTH_SYNC_SCHEMA],
    maxBatchBytes: options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES,
  }
}

export async function createReceiverSession(
  options: AppleHealthSyncReceiverOptions,
  request: AppleHealthSyncSessionCreateRequest,
): Promise<AppleHealthSyncSessionCreateResponse> {
  if (request.schema !== APPLE_HEALTH_SYNC_SCHEMA) {
    throw new ValidationError(`Unsupported schema: ${request.schema}`)
  }

  const metadata = await loadReceiverMetadata(options)
  if (request.baseCheckpoint !== metadata.lastAppliedCheckpoint) {
    throw new ConflictError(
      `Base checkpoint mismatch. Receiver is at ${metadata.lastAppliedCheckpoint ?? "null"}, request expected ${request.baseCheckpoint ?? "null"}.`,
    )
  }

  const sessionId = `sync_${randomUUID()}`
  const sessionDirectory = sessionDirectoryPath(options.stateRoot, sessionId)
  const session: StoredSession = {
    sessionId,
    senderId: request.senderId,
    baseCheckpoint: request.baseCheckpoint,
    newCheckpoint: request.newCheckpoint,
    state: "open",
  }

  await fs.mkdir(sessionDirectory, { recursive: true })
  await fs.writeFile(sessionMetadataPath(options.stateRoot, sessionId), `${JSON.stringify(session, null, 2)}\n`, "utf8")

  return {
    sessionId,
    uploadUrl: "/health-sync/delta",
    commitUrl: "/health-sync/commit",
    maxBatchBytes: options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES,
  }
}

export async function appendReceiverDeltaBatch(
  options: AppleHealthSyncReceiverOptions,
  batch: AppleHealthSyncDeltaBatch,
  rawBody: string,
): Promise<AppleHealthSyncSessionStatusResponse> {
  if (Buffer.byteLength(rawBody, "utf8") > (options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)) {
    throw new ValidationError("Batch exceeds maxBatchBytes.")
  }

  validateDeltaBatch(batch)
  const session = await loadSession(options.stateRoot, batch.sessionId)
  if (session.state !== "open") {
    throw new ConflictError(`Session ${batch.sessionId} is already committed.`)
  }

  const expectedSequence = (await countStoredBatches(options.stateRoot, batch.sessionId)) + 1
  if (batch.sequence !== expectedSequence) {
    throw new ConflictError(`Expected sequence ${expectedSequence}, received ${batch.sequence}.`)
  }

  await fs.writeFile(sessionBatchPath(options.stateRoot, batch.sessionId, batch.sequence), rawBody, "utf8")
  return getReceiverSessionStatus(options, batch.sessionId)
}

export async function getReceiverSessionStatus(
  options: AppleHealthSyncReceiverOptions,
  sessionId: string,
): Promise<AppleHealthSyncSessionStatusResponse> {
  const session = await loadSession(options.stateRoot, sessionId)
  return {
    sessionId: session.sessionId,
    state: session.state,
    receivedBatchCount: await countStoredBatches(options.stateRoot, sessionId),
    expectedCheckpoint: session.newCheckpoint,
    baseCheckpoint: session.baseCheckpoint,
    senderId: session.senderId,
  }
}

export async function commitReceiverSession(
  options: AppleHealthSyncReceiverOptions,
  request: AppleHealthSyncCommitRequest,
): Promise<AppleHealthSyncCommitResponse> {
  const session = await loadSession(options.stateRoot, request.sessionId)
  if (session.state !== "open") {
    throw new ConflictError(`Session ${request.sessionId} is already committed.`)
  }

  if (request.newCheckpoint !== session.newCheckpoint) {
    throw new ConflictError(
      `Commit checkpoint ${request.newCheckpoint} does not match session checkpoint ${session.newCheckpoint}.`,
    )
  }

  const metadata = await loadReceiverMetadata(options)
  if (metadata.lastAppliedCheckpoint !== session.baseCheckpoint) {
    throw new ConflictError(
      `Receiver checkpoint changed during session. Receiver is at ${metadata.lastAppliedCheckpoint ?? "null"}, session expected ${session.baseCheckpoint ?? "null"}.`,
    )
  }

  const batches = await loadSessionBatches(options.stateRoot, request.sessionId)
  if (batches.length !== request.batchCount) {
    throw new ConflictError(`Commit expected ${request.batchCount} batches, receiver has ${batches.length}.`)
  }

  if (request.rootHash) {
    const computedRootHash = createBatchRootHash(batches.map((batch) => batch.raw))
    if (computedRootHash !== request.rootHash) {
      throw new ConflictError(`Commit root hash mismatch. Receiver computed ${computedRootHash}.`)
    }
  }

  let snapshot = await loadCurrentSnapshot(options.outputRoot)
  for (const batch of batches) {
    snapshot = applyDeltaBatch(snapshot, batch.parsed)
  }

  snapshot.generatedAt = new Date().toISOString()
  await writeSnapshotArtifacts(options.outputRoot, snapshot)
  await writeReceiverMetadata(options, {
    receiverId: metadata.receiverId,
    lastAppliedCheckpoint: request.newCheckpoint,
  })

  const committedSession: StoredSession = { ...session, state: "committed" }
  await fs.writeFile(
    sessionMetadataPath(options.stateRoot, request.sessionId),
    `${JSON.stringify(committedSession, null, 2)}\n`,
    "utf8",
  )

  return {
    applied: true,
    appliedCheckpoint: request.newCheckpoint,
  }
}

export function applyDeltaBatch(
  snapshot: AppleHealthCacheExport,
  batch: AppleHealthSyncDeltaBatch,
): AppleHealthCacheExport {
  const nextActivities: Record<string, AppleHealthActivityExport> = { ...snapshot.activities }
  const nextCollections: Record<string, AppleHealthCollectionExport> = { ...snapshot.collections }
  const deletedActivityIds = new Set(snapshot.deletedActivityIds)

  for (const activityId of batch.activitiesDelete) {
    delete nextActivities[activityId]
    deletedActivityIds.add(activityId)
  }

  for (const upsert of batch.activitiesUpsert) {
    nextActivities[upsert.activityId] = upsert.data
    deletedActivityIds.delete(upsert.activityId)
  }

  for (const upsert of batch.routesUpsert) {
    const existingActivity = nextActivities[upsert.activityId]
    if (!existingActivity) {
      throw new ValidationError(`Cannot apply route for unknown activity ${upsert.activityId}.`)
    }

    nextActivities[upsert.activityId] = mergeRouteIntoActivity(existingActivity, upsert.data)
  }

  for (const collectionKey of batch.collectionsDelete) {
    delete nextCollections[collectionKey]
  }

  for (const upsert of batch.collectionsUpsert) {
    nextCollections[upsert.key] = upsert.data
  }

  for (const deletedSample of batch.samplesDelete) {
    const existingCollection = nextCollections[deletedSample.collectionKey]
    if (!existingCollection) {
      continue
    }

    nextCollections[deletedSample.collectionKey] = {
      ...existingCollection,
      samples: existingCollection.samples.filter((sample) => sample.sampleId !== deletedSample.sampleId),
    }
  }

  return {
    ...snapshot,
    activities: nextActivities,
    collections: nextCollections,
    deletedActivityIds: Array.from(deletedActivityIds).sort(),
  }
}

function mergeRouteIntoActivity(
  activity: AppleHealthActivityExport,
  route: AppleHealthRouteExport,
): AppleHealthActivityExport {
  return {
    ...activity,
    hasStreams: route.hasStreams,
    summaryPolyline: route.summaryPolyline,
    routeStreams: route.routeStreams,
  }
}

async function loadReceiverMetadata(options: AppleHealthSyncReceiverOptions): Promise<ReceiverMetadata> {
  const targetPath = metadataPath(options.stateRoot)

  try {
    const fileContent = await fs.readFile(targetPath, "utf8")
    return JSON.parse(fileContent) as ReceiverMetadata
  } catch {
    return {
      receiverId: options.receiverId ?? os.hostname(),
      lastAppliedCheckpoint: null,
    }
  }
}

async function writeReceiverMetadata(options: AppleHealthSyncReceiverOptions, metadata: ReceiverMetadata) {
  await fs.mkdir(options.stateRoot, { recursive: true })
  await fs.writeFile(metadataPath(options.stateRoot), `${JSON.stringify(metadata, null, 2)}\n`, "utf8")
}

async function loadCurrentSnapshot(outputRoot: string): Promise<AppleHealthCacheExport> {
  const snapshotPath = path.join(outputRoot, "cache-export.json")

  try {
    const fileContent = await fs.readFile(snapshotPath, "utf8")
    return JSON.parse(fileContent) as AppleHealthCacheExport
  } catch {
    return {
      generatedAt: new Date().toISOString(),
      provider: "appleHealth",
      activities: {},
      collections: {},
      deletedActivityIds: [],
    }
  }
}

async function writeSnapshotArtifacts(outputRoot: string, snapshot: AppleHealthCacheExport) {
  await fs.mkdir(outputRoot, { recursive: true })
  await fs.writeFile(path.join(outputRoot, "cache-export.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")
  await fs.writeFile(
    path.join(outputRoot, "export-manifest.json"),
    `${JSON.stringify(buildManifest(snapshot), null, 2)}\n`,
    "utf8",
  )
}

function buildManifest(snapshot: AppleHealthCacheExport) {
  return {
    exportedAt: snapshot.generatedAt,
    workoutCount: Object.keys(snapshot.activities).length,
    routeCount: Object.values(snapshot.activities).filter((activity) => activity.hasStreams).length,
    collectionCount: Object.keys(snapshot.collections).length,
    sampleCount: Object.values(snapshot.collections).reduce((count, collection) => count + collection.samples.length, 0),
  }
}

function validateDeltaBatch(batch: AppleHealthSyncDeltaBatch) {
  if (!batch.sessionId) {
    throw new ValidationError("Missing sessionId.")
  }

  if (!Number.isInteger(batch.sequence) || batch.sequence < 1) {
    throw new ValidationError("Batch sequence must be a positive integer.")
  }
}

function createBatchRootHash(rawBatches: string[]) {
  const hash = createHash("sha256")
  for (const rawBatch of rawBatches) {
    hash.update(rawBatch, "utf8")
  }
  return `sha256:${hash.digest("hex")}`
}

async function loadSession(stateRoot: string, sessionId: string): Promise<StoredSession> {
  try {
    const fileContent = await fs.readFile(sessionMetadataPath(stateRoot, sessionId), "utf8")
    return JSON.parse(fileContent) as StoredSession
  } catch {
    throw new NotFoundError(`Unknown session ${sessionId}.`)
  }
}

async function loadSessionBatches(stateRoot: string, sessionId: string) {
  const batchDirectory = sessionDirectoryPath(stateRoot, sessionId)
  let entries: string[]

  try {
    entries = await fs.readdir(batchDirectory)
  } catch {
    throw new NotFoundError(`Unknown session ${sessionId}.`)
  }

  const batchPaths = entries
    .filter((entry) => /^batch-\d+\.json$/u.test(entry))
    .sort((left, right) => extractBatchSequence(left) - extractBatchSequence(right))
    .map((entry) => path.join(batchDirectory, entry))

  return Promise.all(
    batchPaths.map(async (batchPath) => {
      const raw = await fs.readFile(batchPath, "utf8")
      return {
        raw,
        parsed: JSON.parse(raw) as AppleHealthSyncDeltaBatch,
      }
    }),
  )
}

async function countStoredBatches(stateRoot: string, sessionId: string) {
  const sessionDirectory = sessionDirectoryPath(stateRoot, sessionId)

  try {
    const entries = await fs.readdir(sessionDirectory)
    return entries.filter((entry) => /^batch-\d+\.json$/u.test(entry)).length
  } catch {
    return 0
  }
}

function metadataPath(stateRoot: string) {
  return path.join(stateRoot, "receiver-metadata.json")
}

function sessionDirectoryPath(stateRoot: string, sessionId: string) {
  return path.join(stateRoot, "sessions", sessionId)
}

function sessionMetadataPath(stateRoot: string, sessionId: string) {
  return path.join(sessionDirectoryPath(stateRoot, sessionId), "session.json")
}

function sessionBatchPath(stateRoot: string, sessionId: string, sequence: number) {
  return path.join(sessionDirectoryPath(stateRoot, sessionId), `batch-${sequence}.json`)
}

function extractBatchSequence(fileName: string) {
  const match = fileName.match(/^batch-(\d+)\.json$/u)
  if (!match) {
    return Number.POSITIVE_INFINITY
  }

  return Number.parseInt(match[1] ?? "", 10)
}
