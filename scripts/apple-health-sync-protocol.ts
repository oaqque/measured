import type {
  AppleHealthActivityExport,
  AppleHealthCollectionExport,
  AppleHealthCollectionSampleExport,
} from "./apple-health-import-lib"

export const APPLE_HEALTH_SYNC_PROTOCOL_VERSION = 3 as const
export const APPLE_HEALTH_SYNC_SCHEMA = "apple-health-blobs.v3" as const
export const APPLE_HEALTH_SYNC_LEGACY_PROTOCOL_VERSION = 2 as const
export const APPLE_HEALTH_SYNC_LEGACY_SCHEMA = "apple-health-docs.v2" as const
export const APPLE_HEALTH_SYNC_V3_PROTOCOL_VERSION = APPLE_HEALTH_SYNC_PROTOCOL_VERSION
export const APPLE_HEALTH_SYNC_V3_SCHEMA = APPLE_HEALTH_SYNC_SCHEMA

export type AppleHealthSyncDocumentType =
  | "snapshotMeta"
  | "activity"
  | "route"
  | "collectionMeta"
  | "sample"

export interface AppleHealthSnapshotMetaDocumentData {
  registryGeneratedAt: string | null
}

export interface AppleHealthActivityDocumentData {
  activityId: string
  sportType: AppleHealthActivityExport["sportType"]
  startDate: AppleHealthActivityExport["startDate"]
  distanceMeters: AppleHealthActivityExport["distanceMeters"]
  distanceKm: AppleHealthActivityExport["distanceKm"]
  movingTimeSeconds: AppleHealthActivityExport["movingTimeSeconds"]
  elapsedTimeSeconds: AppleHealthActivityExport["elapsedTimeSeconds"]
  averageHeartrate: AppleHealthActivityExport["averageHeartrate"]
  maxHeartrate: AppleHealthActivityExport["maxHeartrate"]
  source: AppleHealthActivityExport["source"]
}

export interface AppleHealthRouteDocumentData {
  activityId: string
  summaryPolyline: AppleHealthActivityExport["summaryPolyline"]
  hasStreams: AppleHealthActivityExport["hasStreams"]
  routeStreams: AppleHealthActivityExport["routeStreams"]
}

export interface AppleHealthCollectionMetaDocumentData {
  key: AppleHealthCollectionExport["key"]
  kind: AppleHealthCollectionExport["kind"]
  displayName: AppleHealthCollectionExport["displayName"]
  unit: AppleHealthCollectionExport["unit"]
  objectTypeIdentifier: AppleHealthCollectionExport["objectTypeIdentifier"]
  queryStrategy: AppleHealthCollectionExport["queryStrategy"]
  requiresPerObjectAuthorization: AppleHealthCollectionExport["requiresPerObjectAuthorization"]
}

export interface AppleHealthSampleDocumentData {
  collectionKey: string
  sample: AppleHealthCollectionSampleExport
}

export type AppleHealthSyncDocumentData =
  | AppleHealthSnapshotMetaDocumentData
  | AppleHealthActivityDocumentData
  | AppleHealthRouteDocumentData
  | AppleHealthCollectionMetaDocumentData
  | AppleHealthSampleDocumentData

export interface AppleHealthSyncDocument {
  _id: string
  _rev: string
  type: AppleHealthSyncDocumentType
  deleted: boolean
  updatedAt: string
  data?: AppleHealthSyncDocumentData
}

export interface AppleHealthSyncStatusResponse {
  protocolVersion: typeof APPLE_HEALTH_SYNC_PROTOCOL_VERSION
  schema: typeof APPLE_HEALTH_SYNC_SCHEMA
  receiverId: string
  maxRequestBytes: number
  maxBlobBytes: number
  blobEncoding: "gzip"
  blobFormat: "ndjson"
  hashAlgorithm: "sha256"
}

export interface AppleHealthSyncLegacyStatusResponse {
  protocolVersion: typeof APPLE_HEALTH_SYNC_LEGACY_PROTOCOL_VERSION
  schema: typeof APPLE_HEALTH_SYNC_LEGACY_SCHEMA
  receiverId: string
  maxRequestBytes: number
}

export interface AppleHealthSyncCheckpointResponse {
  replicationId: string
  lastSequence: number
  updatedAt: string
}

export interface AppleHealthSyncCheckpointRequest {
  lastSequence: number
  updatedAt: string
}

export type AppleHealthSyncRevsDiffRequest = Record<string, string[]>

export interface AppleHealthSyncRevsDiffEntry {
  missing: string[]
}

export type AppleHealthSyncRevsDiffResponse = Record<string, AppleHealthSyncRevsDiffEntry>

export interface AppleHealthSyncBulkDocsRequest {
  docs: AppleHealthSyncDocument[]
  new_edits: false
}

export interface AppleHealthSyncBulkDocsResponseRow {
  id: string
  rev: string
  ok?: true
  error?: string
  reason?: string
}

export type AppleHealthSyncV3ControlBlobKind =
  | "activity_summaries"
  | "routes"
  | "collection_metadata"
  | "deleted_activity_ids"

export type AppleHealthSyncControlBlobKind = AppleHealthSyncV3ControlBlobKind

export interface AppleHealthSyncV3ControlBlobReference {
  kind: AppleHealthSyncV3ControlBlobKind
  blobHash: string
  encoding: "gzip"
  format: "ndjson"
  itemCount: number
}

export type AppleHealthSyncControlBlobReference = AppleHealthSyncV3ControlBlobReference

export interface AppleHealthSyncV3SampleChunkReference {
  collectionKey: string
  bucketId: string
  blobHash: string
  encoding: "gzip"
  format: "ndjson"
  sampleCount: number
  minStartDate: string | null
  maxStartDate: string | null
}

export type AppleHealthSyncSampleChunkReference = AppleHealthSyncV3SampleChunkReference

export interface AppleHealthSyncV3SnapshotManifest {
  generatedAt: string
  registryGeneratedAt: string | null
  controlBlobs: AppleHealthSyncV3ControlBlobReference[]
  sampleChunks: AppleHealthSyncV3SampleChunkReference[]
}

export type AppleHealthSyncSnapshotManifest = AppleHealthSyncV3SnapshotManifest

export interface AppleHealthSyncV3PlanRequest {
  replicationId: string
  lastSequence: number
  snapshot: AppleHealthSyncV3SnapshotManifest
}

export type AppleHealthSyncPlanRequest = AppleHealthSyncV3PlanRequest

export interface AppleHealthSyncV3PlanResponse {
  missingBlobHashes: string[]
}

export type AppleHealthSyncPlanResponse = AppleHealthSyncV3PlanResponse

export interface AppleHealthSyncV3CommitRequest {
  replicationId: string
  lastSequence: number
  snapshot: AppleHealthSyncV3SnapshotManifest
}

export type AppleHealthSyncCommitRequest = AppleHealthSyncV3CommitRequest

export interface AppleHealthSyncV3CommitResponse {
  replicationId: string
  lastSequence: number
  snapshotId: string
  committedAt: string
}

export type AppleHealthSyncCommitResponse = AppleHealthSyncV3CommitResponse

export type AppleHealthSyncV3StatusResponse = AppleHealthSyncStatusResponse
