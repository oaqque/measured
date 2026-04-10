import type { AppleHealthActivityExport, AppleHealthCollectionExport } from "./apple-health-import-lib"

export const APPLE_HEALTH_SYNC_PROTOCOL_VERSION = 1 as const
export const APPLE_HEALTH_SYNC_SCHEMA = "apple-health-cache.v1" as const

export interface AppleHealthRouteExport {
  activityId: string
  summaryPolyline: string | null
  hasStreams: boolean
  routeStreams: AppleHealthActivityExport["routeStreams"]
}

export interface AppleHealthActivityUpsert {
  activityId: string
  hash: string
  data: AppleHealthActivityExport
}

export interface AppleHealthRouteUpsert {
  activityId: string
  hash: string
  data: AppleHealthRouteExport
}

export interface AppleHealthCollectionUpsert {
  key: string
  hash: string
  data: AppleHealthCollectionExport
}

export interface AppleHealthDeletedSample {
  collectionKey: string
  sampleId: string
}

export interface AppleHealthSyncStatusResponse {
  protocolVersion: typeof APPLE_HEALTH_SYNC_PROTOCOL_VERSION
  receiverId: string
  lastAppliedCheckpoint: string | null
  acceptedSchemas: [typeof APPLE_HEALTH_SYNC_SCHEMA]
  maxBatchBytes: number
}

export interface AppleHealthSyncSessionCreateRequest {
  senderId: string
  schema: typeof APPLE_HEALTH_SYNC_SCHEMA
  baseCheckpoint: string | null
  newCheckpoint: string
}

export interface AppleHealthSyncSessionCreateResponse {
  sessionId: string
  uploadUrl: string
  commitUrl: string
  maxBatchBytes: number
}

export interface AppleHealthSyncDeltaBatch {
  sessionId: string
  sequence: number
  activitiesUpsert: AppleHealthActivityUpsert[]
  routesUpsert: AppleHealthRouteUpsert[]
  collectionsUpsert: AppleHealthCollectionUpsert[]
  activitiesDelete: string[]
  collectionsDelete: string[]
  samplesDelete: AppleHealthDeletedSample[]
}

export interface AppleHealthSyncCommitRequest {
  sessionId: string
  newCheckpoint: string
  batchCount: number
  rootHash?: string
}

export interface AppleHealthSyncCommitResponse {
  applied: boolean
  appliedCheckpoint: string
}

export interface AppleHealthSyncSessionStatusResponse {
  sessionId: string
  state: "open" | "committed"
  receivedBatchCount: number
  expectedCheckpoint: string
  baseCheckpoint: string | null
  senderId: string
}
