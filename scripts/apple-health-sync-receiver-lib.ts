import fsSync from "node:fs"
import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import os from "node:os"
import path from "node:path"
import { gunzipSync } from "node:zlib"
import Database from "better-sqlite3"
import type {
  AppleHealthActivityExport,
  AppleHealthCacheExport,
  AppleHealthCollectionExport,
  AppleHealthCollectionSampleExport,
} from "./apple-health-import-lib"
import {
  APPLE_HEALTH_SYNC_LEGACY_PROTOCOL_VERSION,
  APPLE_HEALTH_SYNC_LEGACY_SCHEMA,
  APPLE_HEALTH_SYNC_PROTOCOL_VERSION,
  APPLE_HEALTH_SYNC_SCHEMA,
  type AppleHealthActivityDocumentData,
  type AppleHealthCollectionMetaDocumentData,
  type AppleHealthRouteDocumentData,
  type AppleHealthSampleDocumentData,
  type AppleHealthSnapshotMetaDocumentData,
  type AppleHealthSyncBulkDocsRequest,
  type AppleHealthSyncBulkDocsResponseRow,
  type AppleHealthSyncCheckpointRequest,
  type AppleHealthSyncCheckpointResponse,
  type AppleHealthSyncDocument,
  type AppleHealthSyncLegacyStatusResponse,
  type AppleHealthSyncRevsDiffRequest,
  type AppleHealthSyncRevsDiffResponse,
  type AppleHealthSyncV3CommitRequest,
  type AppleHealthSyncV3CommitResponse,
  type AppleHealthSyncV3ControlBlobKind,
  type AppleHealthSyncV3PlanRequest,
  type AppleHealthSyncV3PlanResponse,
  type AppleHealthSyncV3SampleChunkReference,
  type AppleHealthSyncV3SnapshotManifest,
  type AppleHealthSyncV3StatusResponse,
} from "./apple-health-sync-protocol"

export const DEFAULT_MAX_BATCH_BYTES = 5 * 1024 * 1024
export const DEFAULT_MAX_BLOB_BYTES = 64 * 1024 * 1024

export interface AppleHealthSyncReceiverOptions {
  outputRoot: string
  stateRoot: string
  receiverId?: string
  maxBatchBytes?: number
  maxBlobBytes?: number
}

interface ReceiverMetadata {
  receiverId: string
}

interface ReceiverCheckpoint {
  lastSequence: number
  updatedAt: string
}

interface ReceiverDocumentRow {
  id: string
  rev: string
  generation: number
  digest: string
  type: AppleHealthSyncDocument["type"]
  deleted: number
  updatedAt: string
  dataJson: string | null
}

interface ReceiverBulkApplyResult {
  didChange: boolean
  response: AppleHealthSyncBulkDocsResponseRow[]
}

interface ReceiverV3BlobRow {
  hash: string
  sizeBytes: number
}

interface ReceiverV3CurrentSnapshotRow {
  snapshotId: string
}

interface ReceiverV3ControlBlobRow {
  kind: AppleHealthSyncV3ControlBlobKind
  blobHash: string
  itemCount: number
}

interface ReceiverV3SampleChunkRow extends AppleHealthSyncV3SampleChunkReference {}

type SQLiteDatabase = import("better-sqlite3").Database

const materializationQueues = new Map<string, Promise<void>>()

export class ConflictError extends Error {}
export class ValidationError extends Error {}
export class NotFoundError extends Error {}

export async function getLegacyReceiverStatus(
  options: AppleHealthSyncReceiverOptions,
): Promise<AppleHealthSyncLegacyStatusResponse> {
  return withReceiverDatabase(options, (db) => {
    const metadata = ensureReceiverMetadata(db, options)
    return {
      protocolVersion: APPLE_HEALTH_SYNC_LEGACY_PROTOCOL_VERSION,
      schema: APPLE_HEALTH_SYNC_LEGACY_SCHEMA,
      receiverId: metadata.receiverId,
      maxRequestBytes: options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES,
    }
  })
}

export async function getReceiverStatus(
  options: AppleHealthSyncReceiverOptions,
): Promise<AppleHealthSyncV3StatusResponse> {
  return withReceiverDatabase(options, (db) => {
    const metadata = ensureReceiverMetadata(db, options)
    return {
      protocolVersion: APPLE_HEALTH_SYNC_PROTOCOL_VERSION,
      schema: APPLE_HEALTH_SYNC_SCHEMA,
      receiverId: metadata.receiverId,
      maxRequestBytes: options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES,
      maxBlobBytes: options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES,
      blobEncoding: "gzip",
      blobFormat: "ndjson",
      hashAlgorithm: "sha256",
    }
  })
}

export const getReceiverV3Status = getReceiverStatus

export async function getReceiverCheckpoint(
  options: AppleHealthSyncReceiverOptions,
  replicationId: string,
): Promise<AppleHealthSyncCheckpointResponse> {
  return withReceiverDatabase(options, (db) => {
    ensureReceiverMetadata(db, options)
    const checkpoint = db.prepare(`
      SELECT last_sequence AS lastSequence, updated_at AS updatedAt
      FROM checkpoints
      WHERE replication_id = ?
    `).get(replicationId) as ReceiverCheckpoint | undefined

    if (!checkpoint) {
      throw new NotFoundError(`Unknown replication checkpoint ${replicationId}.`)
    }

    return {
      replicationId,
      lastSequence: checkpoint.lastSequence,
      updatedAt: checkpoint.updatedAt,
    }
  })
}

export async function putReceiverCheckpoint(
  options: AppleHealthSyncReceiverOptions,
  replicationId: string,
  request: AppleHealthSyncCheckpointRequest,
): Promise<AppleHealthSyncCheckpointResponse> {
  validateCheckpointRequest(request)

  return withReceiverDatabase(options, (db) => {
    ensureReceiverMetadata(db, options)

    const applyCheckpoint = db.transaction(() => {
      const existing = db.prepare(`
        SELECT last_sequence AS lastSequence
        FROM checkpoints
        WHERE replication_id = ?
      `).get(replicationId) as Pick<ReceiverCheckpoint, "lastSequence"> | undefined

      if (existing && request.lastSequence < existing.lastSequence) {
        throw new ConflictError(
          `Checkpoint regression for ${replicationId}. Existing sequence ${existing.lastSequence}, received ${request.lastSequence}.`,
        )
      }

      db.prepare(`
        INSERT INTO checkpoints (replication_id, last_sequence, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(replication_id) DO UPDATE SET
          last_sequence = excluded.last_sequence,
          updated_at = excluded.updated_at
      `).run(replicationId, request.lastSequence, request.updatedAt)
    })

    applyCheckpoint()

    return {
      replicationId,
      lastSequence: request.lastSequence,
      updatedAt: request.updatedAt,
    }
  })
}

export async function getReceiverRevsDiff(
  options: AppleHealthSyncReceiverOptions,
  request: AppleHealthSyncRevsDiffRequest,
): Promise<AppleHealthSyncRevsDiffResponse> {
  return withReceiverDatabase(options, (db) => {
    ensureReceiverMetadata(db, options)
    const selectDocument = db.prepare(`
      SELECT
        id,
        rev,
        generation,
        digest,
        type,
        deleted,
        updated_at AS updatedAt,
        data_json AS dataJson
      FROM documents
      WHERE id = ?
    `)

    const response: AppleHealthSyncRevsDiffResponse = {}

    for (const [documentId, revisions] of Object.entries(request)) {
      if (!Array.isArray(revisions) || revisions.length === 0) {
        throw new ValidationError(`Revision diff for ${documentId} must be a non-empty array.`)
      }

      const currentDocument = selectDocument.get(documentId) as ReceiverDocumentRow | undefined
      const missing = revisions.filter((revision) => isRevisionMissing(currentDocument, revision))
      if (missing.length > 0) {
        response[documentId] = { missing }
      }
    }

    return response
  })
}

export async function bulkApplyReceiverDocuments(
  options: AppleHealthSyncReceiverOptions,
  request: AppleHealthSyncBulkDocsRequest,
  rawBody: string,
): Promise<AppleHealthSyncBulkDocsResponseRow[]> {
  if (Buffer.byteLength(rawBody, "utf8") > (options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)) {
    throw new ValidationError(`Request body exceeded ${(options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)} bytes.`)
  }

  if (request.new_edits !== false) {
    throw new ValidationError("bulk docs requests must set new_edits to false.")
  }

  if (!Array.isArray(request.docs)) {
    throw new ValidationError("bulk docs requests must contain a docs array.")
  }

  for (const document of request.docs) {
    validateReplicatedDocument(document)
  }

  const result = await withReceiverDatabase(options, (db) => {
    ensureReceiverMetadata(db, options)
    return applyDocuments(db, request.docs)
  })

  if (result.didChange) {
    await enqueueSnapshotMaterialization(options)
  }

  return result.response
}

export async function planReceiverManifest(
  options: AppleHealthSyncReceiverOptions,
  request: AppleHealthSyncV3PlanRequest,
): Promise<AppleHealthSyncV3PlanResponse> {
  validateV3ManifestRequest(request)

  return withReceiverDatabase(options, (db) => {
    ensureReceiverMetadata(db, options)

    const selectBlob = db.prepare(`
      SELECT hash, size_bytes AS sizeBytes
      FROM v3_blobs
      WHERE hash = ?
    `)

    const missingBlobHashes = Array.from(new Set(referencedBlobHashes(request.snapshot))).filter((hash) => {
      const row = selectBlob.get(hash) as ReceiverV3BlobRow | undefined
      return !row || !blobExistsOnDisk(options.stateRoot, hash)
    })

    return { missingBlobHashes }
  })
}

export async function putReceiverBlob(
  options: AppleHealthSyncReceiverOptions,
  blobHash: string,
  body: Buffer,
): Promise<void> {
  validateBlobHash(blobHash)

  if (body.byteLength > (options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES)) {
    throw new ValidationError(`Blob body exceeded ${(options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES)} bytes.`)
  }

  let inflatedBody: Buffer
  try {
    inflatedBody = gunzipSync(body)
  } catch {
    throw new ValidationError(`Blob ${blobHash} is not valid gzip content.`)
  }

  const actualHash = createHash("sha256").update(inflatedBody).digest("hex")
  if (actualHash !== blobHash) {
    throw new ValidationError(`Blob hash mismatch for ${blobHash}.`)
  }

  const targetPath = blobPath(options.stateRoot, blobHash)
  await fs.mkdir(path.dirname(targetPath), { recursive: true })

  if (!blobExistsOnDisk(options.stateRoot, blobHash)) {
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
    await fs.writeFile(tempPath, body)
    try {
      await fs.rename(tempPath, targetPath)
    } catch (error) {
      await fs.rm(tempPath, { force: true })
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
        throw error
      }
    }
  }

  await withReceiverDatabase(options, (db) => {
    ensureReceiverMetadata(db, options)
    db.prepare(`
      INSERT INTO v3_blobs (hash, size_bytes, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(hash) DO NOTHING
    `).run(blobHash, body.byteLength, new Date().toISOString())
  })
}

export async function commitReceiverManifest(
  options: AppleHealthSyncReceiverOptions,
  request: AppleHealthSyncV3CommitRequest,
): Promise<AppleHealthSyncV3CommitResponse> {
  validateV3ManifestRequest(request)

  const snapshotId = createHash("sha256")
    .update(JSON.stringify({
      replicationId: request.replicationId,
      lastSequence: request.lastSequence,
      snapshot: request.snapshot,
    }))
    .digest("hex")

  const committedAt = new Date().toISOString()

  await withReceiverDatabase(options, (db) => {
    ensureReceiverMetadata(db, options)

    const commit = db.transaction(() => {
      const referencedHashes = referencedBlobHashes(request.snapshot)
      const selectBlob = db.prepare(`
        SELECT hash, size_bytes AS sizeBytes
        FROM v3_blobs
        WHERE hash = ?
      `)

      for (const hash of referencedHashes) {
        const row = selectBlob.get(hash) as ReceiverV3BlobRow | undefined
        if (!row || !blobExistsOnDisk(options.stateRoot, hash)) {
          throw new ValidationError(`V3 commit referenced missing blob ${hash}.`)
        }
      }

      const existingCheckpoint = db.prepare(`
        SELECT last_sequence AS lastSequence
        FROM checkpoints
        WHERE replication_id = ?
      `).get(request.replicationId) as Pick<ReceiverCheckpoint, "lastSequence"> | undefined

      if (existingCheckpoint && request.lastSequence < existingCheckpoint.lastSequence) {
        throw new ConflictError(
          `Checkpoint regression for ${request.replicationId}. Existing sequence ${existingCheckpoint.lastSequence}, received ${request.lastSequence}.`,
        )
      }

      db.prepare(`
        INSERT INTO v3_snapshots (
          snapshot_id,
          replication_id,
          last_sequence,
          generated_at,
          registry_generated_at,
          committed_at,
          manifest_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(snapshot_id) DO UPDATE SET
          replication_id = excluded.replication_id,
          last_sequence = excluded.last_sequence,
          generated_at = excluded.generated_at,
          registry_generated_at = excluded.registry_generated_at,
          committed_at = excluded.committed_at,
          manifest_json = excluded.manifest_json
      `).run(
        snapshotId,
        request.replicationId,
        request.lastSequence,
        request.snapshot.generatedAt,
        request.snapshot.registryGeneratedAt,
        committedAt,
        JSON.stringify(request.snapshot),
      )

      db.prepare(`DELETE FROM v3_snapshot_control_blobs WHERE snapshot_id = ?`).run(snapshotId)
      db.prepare(`DELETE FROM v3_snapshot_sample_chunks WHERE snapshot_id = ?`).run(snapshotId)

      const insertControlBlob = db.prepare(`
        INSERT INTO v3_snapshot_control_blobs (
          snapshot_id,
          kind,
          blob_hash,
          item_count
        )
        VALUES (?, ?, ?, ?)
      `)

      for (const controlBlob of request.snapshot.controlBlobs) {
        insertControlBlob.run(
          snapshotId,
          controlBlob.kind,
          controlBlob.blobHash,
          controlBlob.itemCount,
        )
      }

      const insertSampleChunk = db.prepare(`
        INSERT INTO v3_snapshot_sample_chunks (
          snapshot_id,
          collection_key,
          bucket_id,
          blob_hash,
          encoding,
          format,
          sample_count,
          min_start_date,
          max_start_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      for (const sampleChunk of request.snapshot.sampleChunks) {
        insertSampleChunk.run(
          snapshotId,
          sampleChunk.collectionKey,
          sampleChunk.bucketId,
          sampleChunk.blobHash,
          sampleChunk.encoding,
          sampleChunk.format,
          sampleChunk.sampleCount,
          sampleChunk.minStartDate,
          sampleChunk.maxStartDate,
        )
      }

      db.prepare(`
        INSERT INTO v3_current_snapshot (singleton, snapshot_id)
        VALUES (1, ?)
        ON CONFLICT(singleton) DO UPDATE SET snapshot_id = excluded.snapshot_id
      `).run(snapshotId)

      db.prepare(`
        INSERT INTO checkpoints (replication_id, last_sequence, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(replication_id) DO UPDATE SET
          last_sequence = excluded.last_sequence,
          updated_at = excluded.updated_at
      `).run(request.replicationId, request.lastSequence, request.snapshot.generatedAt)
    })

    commit()
  })

  await enqueueSnapshotMaterializationV3(options)

  return {
    replicationId: request.replicationId,
    lastSequence: request.lastSequence,
    snapshotId,
    committedAt,
  }
}

export const planReceiverV3Manifest = planReceiverManifest
export const putReceiverV3Blob = putReceiverBlob
export const commitReceiverV3Manifest = commitReceiverManifest

function applyDocuments(db: SQLiteDatabase, documents: AppleHealthSyncDocument[]): ReceiverBulkApplyResult {
  const selectDocument = db.prepare(`
    SELECT
      id,
      rev,
      generation,
      digest,
      type,
      deleted,
      updated_at AS updatedAt,
      data_json AS dataJson
    FROM documents
    WHERE id = ?
  `)

  const upsertDocument = db.prepare(`
    INSERT INTO documents (id, rev, generation, digest, type, deleted, updated_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      rev = excluded.rev,
      generation = excluded.generation,
      digest = excluded.digest,
      type = excluded.type,
      deleted = excluded.deleted,
      updated_at = excluded.updated_at,
      data_json = excluded.data_json
  `)

  const transaction = db.transaction((nextDocuments: AppleHealthSyncDocument[]) => {
    let didChange = false
    const response: AppleHealthSyncBulkDocsResponseRow[] = []

    for (const document of nextDocuments) {
      const existing = selectDocument.get(document._id) as ReceiverDocumentRow | undefined
      const incomingDigest = revisionDigest(document._rev)

      if (existing?.rev === document._rev) {
        response.push({ id: document._id, rev: document._rev, ok: true })
        continue
      }

      if (existing && incomingDigest === existing.digest && existing.deleted === (document.deleted ? 1 : 0) && existing.type === document.type) {
        response.push({ id: document._id, rev: existing.rev, ok: true })
        continue
      }

      if (existing && !shouldApplyIncomingRevision(existing, document)) {
        response.push({ id: document._id, rev: existing.rev, ok: true })
        continue
      }

      upsertDocument.run(
        document._id,
        document._rev,
        parseRevisionGeneration(document._rev),
        incomingDigest,
        document.type,
        document.deleted ? 1 : 0,
        document.updatedAt,
        document.deleted ? null : JSON.stringify(document.data ?? null),
      )
      didChange = true
      response.push({ id: document._id, rev: document._rev, ok: true })
    }

    return { didChange, response }
  })

  return transaction(documents)
}

function validateCheckpointRequest(request: AppleHealthSyncCheckpointRequest) {
  if (!Number.isInteger(request.lastSequence) || request.lastSequence < 0) {
    throw new ValidationError("Checkpoint lastSequence must be a non-negative integer.")
  }

  if (!isValidISODateTime(request.updatedAt)) {
    throw new ValidationError("Checkpoint updatedAt must be a valid ISO-8601 timestamp.")
  }
}

function validateReplicatedDocument(document: AppleHealthSyncDocument) {
  if (!document._id) {
    throw new ValidationError("Replicated documents must include an _id.")
  }

  if (!document._rev || !/^\d+-[0-9a-f]{64}$/u.test(document._rev)) {
    throw new ValidationError(`Replicated document ${document._id} must include a valid _rev.`)
  }

  if (!["snapshotMeta", "activity", "route", "collectionMeta", "sample"].includes(document.type)) {
    throw new ValidationError(`Replicated document ${document._id} has unsupported type ${document.type}.`)
  }

  if (typeof document.deleted !== "boolean") {
    throw new ValidationError(`Replicated document ${document._id} must include a deleted flag.`)
  }

  if (!isValidISODateTime(document.updatedAt)) {
    throw new ValidationError(`Replicated document ${document._id} must include a valid updatedAt timestamp.`)
  }

  if (document.deleted) {
    return
  }

  switch (document.type) {
    case "snapshotMeta":
      validateSnapshotMetaDocument(document)
      return
    case "activity":
      validateActivityDocument(document)
      return
    case "route":
      validateRouteDocument(document)
      return
    case "collectionMeta":
      validateCollectionMetaDocument(document)
      return
    case "sample":
      validateSampleDocument(document)
      return
  }
}

function validateSnapshotMetaDocument(document: AppleHealthSyncDocument) {
  const data = document.data as AppleHealthSnapshotMetaDocumentData | undefined
  if (!data) {
    throw new ValidationError(`Snapshot metadata document ${document._id} is missing data.`)
  }
}

function validateActivityDocument(document: AppleHealthSyncDocument) {
  const data = document.data as AppleHealthActivityDocumentData | undefined
  if (!data || data.activityId !== document._id.slice("activity:".length)) {
    throw new ValidationError(`Activity document ${document._id} is invalid.`)
  }
}

function validateRouteDocument(document: AppleHealthSyncDocument) {
  const data = document.data as AppleHealthRouteDocumentData | undefined
  if (!data || data.activityId !== document._id.slice("route:".length)) {
    throw new ValidationError(`Route document ${document._id} is invalid.`)
  }
}

function validateCollectionMetaDocument(document: AppleHealthSyncDocument) {
  const data = document.data as AppleHealthCollectionMetaDocumentData | undefined
  if (!data || data.key !== document._id.slice("collectionMeta:".length)) {
    throw new ValidationError(`Collection metadata document ${document._id} is invalid.`)
  }
}

function validateSampleDocument(document: AppleHealthSyncDocument) {
  const data = document.data as AppleHealthSampleDocumentData | undefined
  if (!data?.collectionKey || !data.sample?.sampleId) {
    throw new ValidationError(`Sample document ${document._id} is invalid.`)
  }
}

function isValidISODateTime(value: string) {
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime())
}

function isRevisionMissing(currentDocument: ReceiverDocumentRow | undefined, offeredRevision: string) {
  if (!currentDocument) {
    return true
  }

  if (currentDocument.rev === offeredRevision) {
    return false
  }

  return currentDocument.digest !== revisionDigest(offeredRevision)
}

function shouldApplyIncomingRevision(existing: ReceiverDocumentRow, incoming: AppleHealthSyncDocument) {
  const existingTimestamp = Date.parse(existing.updatedAt)
  const incomingTimestamp = Date.parse(incoming.updatedAt)

  if (incomingTimestamp > existingTimestamp) {
    return true
  }

  if (incomingTimestamp < existingTimestamp) {
    return false
  }

  const incomingGeneration = parseRevisionGeneration(incoming._rev)
  if (incomingGeneration > existing.generation) {
    return true
  }

  if (incomingGeneration < existing.generation) {
    return false
  }

  return incoming._rev > existing.rev
}

function parseRevisionGeneration(revision: string) {
  const generation = Number.parseInt(revision.split("-", 1)[0] ?? "", 10)
  return Number.isFinite(generation) ? generation : 0
}

function revisionDigest(revision: string) {
  const components = revision.split("-", 2)
  return components[1] ?? ""
}

async function withReceiverDatabase<T>(
  options: AppleHealthSyncReceiverOptions,
  fn: (db: SQLiteDatabase) => T,
): Promise<T> {
  await fs.mkdir(options.stateRoot, { recursive: true })
  let db: SQLiteDatabase | null = null

  try {
    db = new Database(databasePath(options.stateRoot))
    initializeSchema(db)
    return fn(db)
  } catch (error) {
    if (error instanceof ValidationError || error instanceof ConflictError || error instanceof NotFoundError) {
      throw error
    }

    throw new ValidationError("Receiver database is unreadable.")
  } finally {
    db?.close()
  }
}

function initializeSchema(db: SQLiteDatabase) {
  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = FULL")
  db.pragma("busy_timeout = 5000")
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS checkpoints (
      replication_id TEXT PRIMARY KEY,
      last_sequence INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      rev TEXT NOT NULL,
      generation INTEGER NOT NULL,
      digest TEXT NOT NULL,
      type TEXT NOT NULL,
      deleted INTEGER NOT NULL CHECK (deleted IN (0, 1)),
      updated_at TEXT NOT NULL,
      data_json TEXT
    );

    CREATE TABLE IF NOT EXISTS v3_blobs (
      hash TEXT PRIMARY KEY,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v3_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      replication_id TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      generated_at TEXT NOT NULL,
      registry_generated_at TEXT,
      committed_at TEXT NOT NULL,
      manifest_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v3_current_snapshot (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      snapshot_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v3_snapshot_control_blobs (
      snapshot_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      blob_hash TEXT NOT NULL,
      item_count INTEGER NOT NULL,
      PRIMARY KEY (snapshot_id, kind)
    );

    CREATE TABLE IF NOT EXISTS v3_snapshot_sample_chunks (
      snapshot_id TEXT NOT NULL,
      collection_key TEXT NOT NULL,
      bucket_id TEXT NOT NULL,
      blob_hash TEXT NOT NULL,
      encoding TEXT NOT NULL,
      format TEXT NOT NULL,
      sample_count INTEGER NOT NULL,
      min_start_date TEXT,
      max_start_date TEXT,
      PRIMARY KEY (snapshot_id, collection_key, bucket_id, blob_hash)
    );
  `)
}

function ensureReceiverMetadata(db: SQLiteDatabase, options: AppleHealthSyncReceiverOptions): ReceiverMetadata {
  const fallbackReceiverId = options.receiverId ?? os.hostname()
  db.prepare(`
    INSERT INTO metadata (key, value)
    VALUES ('receiver_id', ?)
    ON CONFLICT(key) DO NOTHING
  `).run(fallbackReceiverId)

  const row = db.prepare(`
    SELECT value
    FROM metadata
    WHERE key = 'receiver_id'
  `).get() as { value: string } | undefined

  return {
    receiverId: row?.value ?? fallbackReceiverId,
  }
}

async function enqueueSnapshotMaterialization(options: AppleHealthSyncReceiverOptions) {
  const queueKey = databasePath(options.stateRoot)
  const previous = materializationQueues.get(queueKey) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(() => materializeSnapshotArtifacts(options))

  materializationQueues.set(queueKey, next)

  try {
    await next
  } finally {
    if (materializationQueues.get(queueKey) === next) {
      materializationQueues.delete(queueKey)
    }
  }
}

async function materializeSnapshotArtifacts(options: AppleHealthSyncReceiverOptions) {
  const snapshot = await withReceiverDatabase(options, (db) => {
    ensureReceiverMetadata(db, options)
    return materializeSnapshotFromDatabase(db)
  })

  await fs.mkdir(options.outputRoot, { recursive: true })
  await writeJsonAtomic(path.join(options.outputRoot, "cache-export.json"), snapshot)
  await writeJsonAtomic(path.join(options.outputRoot, "export-manifest.json"), buildManifest(snapshot))
}

async function enqueueSnapshotMaterializationV3(options: AppleHealthSyncReceiverOptions) {
  const queueKey = `${databasePath(options.stateRoot)}::v3`
  const previous = materializationQueues.get(queueKey) ?? Promise.resolve()
  const next = previous
    .catch(() => {})
    .then(() => materializeV3SnapshotArtifacts(options))

  materializationQueues.set(queueKey, next)

  try {
    await next
  } finally {
    if (materializationQueues.get(queueKey) === next) {
      materializationQueues.delete(queueKey)
    }
  }
}

async function materializeV3SnapshotArtifacts(options: AppleHealthSyncReceiverOptions) {
  const snapshot = await withReceiverDatabase(options, (db) => {
    ensureReceiverMetadata(db, options)
    return materializeV3SnapshotFromDatabase(db, options)
  })

  await fs.mkdir(options.outputRoot, { recursive: true })
  await writeJsonAtomic(path.join(options.outputRoot, "cache-export.json"), snapshot)
  await writeJsonAtomic(path.join(options.outputRoot, "export-manifest.json"), buildManifest(snapshot))
}

function materializeV3SnapshotFromDatabase(
  db: SQLiteDatabase,
  options: AppleHealthSyncReceiverOptions,
): AppleHealthCacheExport {
  const current = db.prepare(`
    SELECT snapshot_id AS snapshotId
    FROM v3_current_snapshot
    WHERE singleton = 1
  `).get() as ReceiverV3CurrentSnapshotRow | undefined

  if (!current) {
    throw new NotFoundError("No committed V3 snapshot is available.")
  }

  const snapshotRow = db.prepare(`
    SELECT manifest_json AS manifestJson
    FROM v3_snapshots
    WHERE snapshot_id = ?
  `).get(current.snapshotId) as { manifestJson: string } | undefined

  if (!snapshotRow) {
    throw new ValidationError(`Current V3 snapshot ${current.snapshotId} is missing.`)
  }

  let manifest: AppleHealthSyncV3SnapshotManifest
  try {
    manifest = JSON.parse(snapshotRow.manifestJson) as AppleHealthSyncV3SnapshotManifest
  } catch {
    throw new ValidationError(`V3 snapshot manifest ${current.snapshotId} is unreadable.`)
  }

  const controlBlobs = db.prepare(`
    SELECT
      kind,
      blob_hash AS blobHash,
      item_count AS itemCount
    FROM v3_snapshot_control_blobs
    WHERE snapshot_id = ?
    ORDER BY kind
  `).all(current.snapshotId) as ReceiverV3ControlBlobRow[]

  const sampleChunks = db.prepare(`
    SELECT
      collection_key AS collectionKey,
      bucket_id AS bucketId,
      blob_hash AS blobHash,
      encoding,
      format,
      sample_count AS sampleCount,
      min_start_date AS minStartDate,
      max_start_date AS maxStartDate
    FROM v3_snapshot_sample_chunks
    WHERE snapshot_id = ?
    ORDER BY collection_key, bucket_id, blob_hash
  `).all(current.snapshotId) as ReceiverV3SampleChunkRow[]

  const activities: Record<string, AppleHealthActivityExport> = {}
  const routesByActivityId: Record<string, AppleHealthRouteDocumentData> = {}
  const collectionMetadata: Record<string, Omit<AppleHealthCollectionExport, "samples">> = {}
  const collectionSamples: Record<string, AppleHealthCollectionSampleExport[]> = {}
  const deletedActivityIds = new Set<string>()

  for (const blob of controlBlobs) {
    for (const line of readGzippedNdjsonBlob(options.stateRoot, blob.blobHash)) {
      switch (blob.kind) {
        case "activity_summaries": {
          const activity = line as AppleHealthActivityExport
          activities[activity.activityId] = {
            ...activity,
            summaryPolyline: null,
            hasStreams: false,
            routeStreams: null,
          }
          deletedActivityIds.delete(activity.activityId)
          break
        }
        case "routes": {
          const route = line as AppleHealthRouteDocumentData
          routesByActivityId[route.activityId] = route
          break
        }
        case "collection_metadata": {
          const metadata = line as Omit<AppleHealthCollectionExport, "samples">
          collectionMetadata[metadata.key] = metadata
          break
        }
        case "deleted_activity_ids": {
          if (typeof line !== "string") {
            throw new ValidationError(`Deleted activity blob ${blob.blobHash} contained a non-string line.`)
          }
          deletedActivityIds.add(line)
          delete activities[line]
          delete routesByActivityId[line]
          break
        }
      }
    }
  }

  for (const chunk of sampleChunks) {
    const samples = collectionSamples[chunk.collectionKey] ?? []
    for (const line of readGzippedNdjsonBlob(options.stateRoot, chunk.blobHash)) {
      samples.push(line as AppleHealthCollectionSampleExport)
    }
    collectionSamples[chunk.collectionKey] = samples
  }

  for (const [activityId, route] of Object.entries(routesByActivityId)) {
    const activity = activities[activityId]
    if (!activity) {
      continue
    }
    activities[activityId] = {
      ...activity,
      summaryPolyline: route.summaryPolyline,
      hasStreams: route.hasStreams,
      routeStreams: route.routeStreams,
    }
  }

  const collections: Record<string, AppleHealthCollectionExport> = {}
  const collectionKeys = new Set([
    ...Object.keys(collectionMetadata),
    ...Object.keys(collectionSamples),
  ])
  for (const key of Array.from(collectionKeys).sort()) {
    const metadata = collectionMetadata[key]
    const samples = (collectionSamples[key] ?? []).slice().sort((left, right) => {
      const startComparison = (left.startDate ?? "").localeCompare(right.startDate ?? "")
      if (startComparison !== 0) {
        return startComparison
      }
      return left.sampleId.localeCompare(right.sampleId)
    })

    collections[key] = {
      key,
      kind: metadata?.kind ?? "unknown",
      displayName: metadata?.displayName ?? key,
      unit: metadata?.unit ?? null,
      objectTypeIdentifier: metadata?.objectTypeIdentifier ?? null,
      queryStrategy: metadata?.queryStrategy ?? null,
      requiresPerObjectAuthorization: metadata?.requiresPerObjectAuthorization ?? null,
      samples,
    }
  }

  return {
    generatedAt: manifest.generatedAt,
    provider: "appleHealth",
    registryGeneratedAt: manifest.registryGeneratedAt,
    activities,
    collections,
    deletedActivityIds: Array.from(deletedActivityIds).sort(),
  }
}

function materializeSnapshotFromDatabase(db: SQLiteDatabase): AppleHealthCacheExport {
  let registryGeneratedAt: string | null = null
  const activities: Record<string, AppleHealthActivityExport> = {}
  const routesByActivityId: Record<string, AppleHealthRouteDocumentData> = {}
  const collectionMetaByKey: Record<string, AppleHealthCollectionMetaDocumentData> = {}
  const collectionSamplesByKey: Record<string, AppleHealthCollectionSampleExport[]> = {}
  const deletedActivityIds = new Set<string>()

  const rows = db.prepare(`
    SELECT
      id,
      rev,
      generation,
      digest,
      type,
      deleted,
      updated_at AS updatedAt,
      data_json AS dataJson
    FROM documents
    ORDER BY id
  `).all() as ReceiverDocumentRow[]

  for (const row of rows) {
    if (row.deleted) {
      if (row.type === "activity") {
        const activityId = row.id.slice("activity:".length)
        delete activities[activityId]
        deletedActivityIds.add(activityId)
      }
      continue
    }

    const data = parseDocumentData(row)
    switch (row.type) {
      case "snapshotMeta": {
        const snapshotData = data as AppleHealthSnapshotMetaDocumentData | undefined
        registryGeneratedAt = snapshotData?.registryGeneratedAt ?? null
        break
      }
      case "activity": {
        const activityData = data as AppleHealthActivityDocumentData
        activities[activityData.activityId] = {
          activityId: activityData.activityId,
          sportType: activityData.sportType,
          startDate: activityData.startDate,
          distanceMeters: activityData.distanceMeters,
          distanceKm: activityData.distanceKm,
          movingTimeSeconds: activityData.movingTimeSeconds,
          elapsedTimeSeconds: activityData.elapsedTimeSeconds,
          averageHeartrate: activityData.averageHeartrate,
          maxHeartrate: activityData.maxHeartrate,
          summaryPolyline: null,
          detailFetchedAt: row.updatedAt,
          hasStreams: false,
          routeStreams: null,
          source: activityData.source,
        }
        deletedActivityIds.delete(activityData.activityId)
        break
      }
      case "route": {
        const routeData = data as AppleHealthRouteDocumentData
        routesByActivityId[routeData.activityId] = routeData
        break
      }
      case "collectionMeta": {
        const collectionData = data as AppleHealthCollectionMetaDocumentData
        collectionMetaByKey[collectionData.key] = collectionData
        break
      }
      case "sample": {
        const sampleData = data as AppleHealthSampleDocumentData
        const samples = collectionSamplesByKey[sampleData.collectionKey] ?? []
        samples.push(sampleData.sample)
        collectionSamplesByKey[sampleData.collectionKey] = samples
        break
      }
    }
  }

  for (const [activityId, route] of Object.entries(routesByActivityId)) {
    const activity = activities[activityId]
    if (!activity) {
      continue
    }

    activities[activityId] = {
      ...activity,
      summaryPolyline: route.summaryPolyline,
      hasStreams: route.hasStreams,
      routeStreams: route.routeStreams,
    }
  }

  const collectionKeys = new Set([
    ...Object.keys(collectionMetaByKey),
    ...Object.keys(collectionSamplesByKey),
  ])

  const collections: Record<string, AppleHealthCollectionExport> = {}
  for (const key of Array.from(collectionKeys).sort()) {
    const metadata = collectionMetaByKey[key]
    const samples = (collectionSamplesByKey[key] ?? [])
      .slice()
      .sort((left, right) => {
        const startComparison = (left.startDate ?? "").localeCompare(right.startDate ?? "")
        if (startComparison !== 0) {
          return startComparison
        }
        return left.sampleId.localeCompare(right.sampleId)
      })

    collections[key] = {
      key,
      kind: metadata?.kind ?? "unknown",
      displayName: metadata?.displayName ?? key,
      unit: metadata?.unit ?? null,
      objectTypeIdentifier: metadata?.objectTypeIdentifier ?? null,
      queryStrategy: metadata?.queryStrategy ?? null,
      requiresPerObjectAuthorization: metadata?.requiresPerObjectAuthorization ?? null,
      samples,
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    provider: "appleHealth",
    registryGeneratedAt,
    activities,
    collections,
    deletedActivityIds: Array.from(deletedActivityIds).sort(),
  }
}

function parseDocumentData(row: ReceiverDocumentRow) {
  if (row.dataJson == null) {
    return undefined
  }

  try {
    return JSON.parse(row.dataJson) as AppleHealthSyncDocument["data"]
  } catch {
    throw new ValidationError(`Receiver document ${row.id} is unreadable.`)
  }
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

function validateV3ManifestRequest(
  request: AppleHealthSyncV3PlanRequest | AppleHealthSyncV3CommitRequest,
) {
  if (!request.replicationId.trim()) {
    throw new ValidationError("V3 manifest requests must include a replicationId.")
  }

  if (!Number.isInteger(request.lastSequence) || request.lastSequence < 0) {
    throw new ValidationError("V3 manifest requests must include a non-negative lastSequence.")
  }

  validateV3SnapshotManifest(request.snapshot)
}

function validateV3SnapshotManifest(snapshot: AppleHealthSyncV3SnapshotManifest) {
  if (!isValidISODateTime(snapshot.generatedAt)) {
    throw new ValidationError("V3 snapshot generatedAt must be a valid ISO-8601 timestamp.")
  }

  if (snapshot.registryGeneratedAt !== null && snapshot.registryGeneratedAt !== undefined && !isValidISODateTime(snapshot.registryGeneratedAt)) {
    throw new ValidationError("V3 snapshot registryGeneratedAt must be null or a valid ISO-8601 timestamp.")
  }

  if (!Array.isArray(snapshot.controlBlobs) || !Array.isArray(snapshot.sampleChunks)) {
    throw new ValidationError("V3 snapshot manifest must include controlBlobs and sampleChunks arrays.")
  }

  const seenControlKinds = new Set<string>()
  for (const controlBlob of snapshot.controlBlobs) {
    if (seenControlKinds.has(controlBlob.kind)) {
      throw new ValidationError(`Duplicate V3 control blob kind ${controlBlob.kind}.`)
    }
    seenControlKinds.add(controlBlob.kind)
    validateBlobHash(controlBlob.blobHash)
    if (controlBlob.encoding !== "gzip" || controlBlob.format !== "ndjson") {
      throw new ValidationError(`Unsupported control blob encoding for ${controlBlob.kind}.`)
    }
    if (!Number.isInteger(controlBlob.itemCount) || controlBlob.itemCount < 0) {
      throw new ValidationError(`Invalid itemCount for control blob ${controlBlob.kind}.`)
    }
  }

  const seenSampleChunks = new Set<string>()
  for (const sampleChunk of snapshot.sampleChunks) {
    validateBlobHash(sampleChunk.blobHash)
    if (!sampleChunk.collectionKey.trim() || !sampleChunk.bucketId.trim()) {
      throw new ValidationError("Sample chunk references must include collectionKey and bucketId.")
    }
    if (sampleChunk.encoding !== "gzip" || sampleChunk.format !== "ndjson") {
      throw new ValidationError(`Unsupported sample chunk encoding for ${sampleChunk.collectionKey}/${sampleChunk.bucketId}.`)
    }
    if (!Number.isInteger(sampleChunk.sampleCount) || sampleChunk.sampleCount < 0) {
      throw new ValidationError(`Invalid sampleCount for ${sampleChunk.collectionKey}/${sampleChunk.bucketId}.`)
    }
    if (sampleChunk.minStartDate !== null && sampleChunk.minStartDate !== undefined && !isValidISODateTime(sampleChunk.minStartDate)) {
      throw new ValidationError(`Invalid minStartDate for ${sampleChunk.collectionKey}/${sampleChunk.bucketId}.`)
    }
    if (sampleChunk.maxStartDate !== null && sampleChunk.maxStartDate !== undefined && !isValidISODateTime(sampleChunk.maxStartDate)) {
      throw new ValidationError(`Invalid maxStartDate for ${sampleChunk.collectionKey}/${sampleChunk.bucketId}.`)
    }

    const key = `${sampleChunk.collectionKey}\n${sampleChunk.bucketId}\n${sampleChunk.blobHash}`
    if (seenSampleChunks.has(key)) {
      throw new ValidationError(`Duplicate sample chunk reference for ${sampleChunk.collectionKey}/${sampleChunk.bucketId}.`)
    }
    seenSampleChunks.add(key)
  }
}

function referencedBlobHashes(snapshot: AppleHealthSyncV3SnapshotManifest) {
  return [
    ...snapshot.controlBlobs.map((blob) => blob.blobHash),
    ...snapshot.sampleChunks.map((chunk) => chunk.blobHash),
  ]
}

function validateBlobHash(blobHash: string) {
  if (!/^[0-9a-f]{64}$/u.test(blobHash)) {
    throw new ValidationError(`Blob hash ${blobHash} must be a 64-character lowercase hex sha256.`)
  }
}

function blobDirectory(stateRoot: string) {
  return path.join(stateRoot, "blob-store")
}

function blobPath(stateRoot: string, blobHash: string) {
  return path.join(blobDirectory(stateRoot), blobHash.slice(0, 2), blobHash)
}

function blobExistsOnDisk(stateRoot: string, blobHash: string) {
  return fsSync.existsSync(blobPath(stateRoot, blobHash))
}

function readGzippedNdjsonBlob(stateRoot: string, blobHash: string) {
  const targetPath = blobPath(stateRoot, blobHash)
  let contents: Buffer
  try {
    contents = fsSync.readFileSync(targetPath)
  } catch {
    throw new ValidationError(`Blob ${blobHash} is missing from disk.`)
  }

  let inflated: Buffer
  try {
    inflated = gunzipSync(contents)
  } catch {
    throw new ValidationError(`Blob ${blobHash} is not valid gzip content.`)
  }

  const trimmed = inflated.toString("utf8").trim()
  if (!trimmed) {
    return []
  }

  return trimmed.split("\n").map((line) => {
    try {
      return JSON.parse(line) as unknown
    } catch {
      throw new ValidationError(`Blob ${blobHash} contains invalid NDJSON.`)
    }
  })
}

async function writeJsonAtomic(targetPath: string, payload: unknown) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true })
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  await writeJsonStreamAtomic(tempPath, payload)
  await fs.rename(tempPath, targetPath)
}

async function writeJsonStreamAtomic(targetPath: string, payload: unknown) {
  await new Promise<void>((resolve, reject) => {
    const stream = fsSync.createWriteStream(targetPath, { encoding: "utf8" })
    stream.on("error", reject)
    stream.on("finish", resolve)

    void (async () => {
      try {
        await writeJsonValue(stream, payload)
        if (!stream.write("\n")) {
          await onceWritable(stream)
        }
        stream.end()
      } catch (error) {
        stream.destroy(error instanceof Error ? error : new Error(String(error)))
      }
    })()
  })
}

async function writeJsonValue(stream: fsSync.WriteStream, value: unknown): Promise<void> {
  if (value === null || typeof value !== "object") {
    await writeChunk(stream, JSON.stringify(value))
    return
  }

  if (Array.isArray(value)) {
    await writeChunk(stream, "[")
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) {
        await writeChunk(stream, ",")
      }
      await writeJsonValue(stream, value[index])
    }
    await writeChunk(stream, "]")
    return
  }

  await writeChunk(stream, "{")
  const entries = Object.entries(value)
  for (let index = 0; index < entries.length; index += 1) {
    const [key, entryValue] = entries[index]
    if (index > 0) {
      await writeChunk(stream, ",")
    }
    await writeChunk(stream, `${JSON.stringify(key)}:`)
    await writeJsonValue(stream, entryValue)
  }
  await writeChunk(stream, "}")
}

async function writeChunk(stream: fsSync.WriteStream, chunk: string) {
  if (!stream.write(chunk)) {
    await onceWritable(stream)
  }
}

async function onceWritable(stream: fsSync.WriteStream) {
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", onDrain)
      stream.off("error", onError)
    }
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    stream.on("drain", onDrain)
    stream.on("error", onError)
  })
}

function databasePath(stateRoot: string) {
  return path.join(stateRoot, "receiver.sqlite3")
}
