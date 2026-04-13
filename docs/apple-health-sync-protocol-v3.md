# Apple Health Sync Protocol V3

## Status

Draft receiver-first implementation.

V3 replaces per-sample document replication with a manifest-plus-blob protocol
that is shaped around the actual Apple Health payloads we have today:

- roughly 982k logical items in a full snapshot
- roughly 982k of those items are sample records
- per-sample V2 wrapper overhead is about 228 bytes per sample
- a 514 MB normalized snapshot compresses to about 57 MB with gzip

The design goal is to preserve V2 correctness properties while removing the
document-level tax that is dominating sync cost on iPhone.

## Design Summary

V3 is content-addressed push replication.

The sender:

1. Builds a snapshot manifest.
2. Asks the receiver which blob hashes are missing.
3. Uploads only missing blobs.
4. Atomically commits the manifest and checkpoint together.

The receiver:

1. Stores blobs by SHA-256 hash.
2. Stores the committed manifest in SQLite.
3. Rejects commits that reference missing blobs.
4. Advances the checkpoint only as part of a successful manifest commit.
5. Materializes `cache-export.json` from the committed manifest.

## Why V3

V2 is robust enough for correctness, but it is not shaped for the real payload:

- almost one million sample docs
- about 136 MB of `_revs_diff` traffic at full-sync scale
- about 121 `_bulk_docs` requests at 5 MiB in the worst case
- large CPU cost from per-document hashing and JSON wrapping

V3 moves the diff boundary from individual samples to compressed chunk blobs.

## Non-Goals

- general-purpose rsync compatibility
- peer-to-peer sync
- byte-range resume within a single blob
- replacing Tailnet transport assumptions

If we later need resumable blob upload, we can layer it under V3 without
changing the manifest model.

## Payload Model

V3 has two layers:

- control-plane JSON
- data-plane blobs

### Control-Plane JSON

The manifest itself stays JSON and is small enough to send directly.

It contains:

- snapshot timestamps
- checkpoint metadata
- control blob references
- sample chunk references

### Data-Plane Blobs

Blobs are content-addressed and uploaded separately.

Blob properties:

- hash algorithm: `sha256`
- transport encoding: raw bytes over HTTP
- blob content encoding: `gzip`
- logical format: newline-delimited JSON (`ndjson`)

### Control Blob Kinds

Control blobs are few and comparatively small.

Supported kinds:

- `activity_summaries`
- `routes`
- `collection_metadata`
- `deleted_activity_ids`

Each control blob is a gzipped NDJSON stream.

Line types:

- `activity_summaries`: one `AppleHealthActivityExport` without route deletion
  semantics
- `routes`: one object per activity route payload
- `collection_metadata`: one `AppleHealthCollectionExport` without `samples`
- `deleted_activity_ids`: one JSON string per line

### Sample Chunks

Sample chunks are the primary payload unit.

Each chunk:

- belongs to exactly one collection
- belongs to exactly one deterministic bucket id
- contains only `AppleHealthCollectionSampleExport` records
- is gzipped NDJSON
- is addressed by `sha256(uncompressed_canonical_bytes)`

Recommended sender chunking rules:

- bucket by calendar month using sample start date where present
- preserve deterministic ordering by `startDate`, then `sampleId`
- target about 2-4 MiB uncompressed per chunk

## Endpoints

### `GET /health-sync`

Returns:

- `protocolVersion`
- `schema`
- `receiverId`
- `maxRequestBytes`
- `maxBlobBytes`
- `blobEncoding`
- `blobFormat`
- `hashAlgorithm`

### `GET /health-sync/_local/{replicationId}`

Returns the last durable checkpoint committed for this replication stream.

### `POST /health-sync/_plan`

The sender posts the manifest it intends to commit.

The receiver responds with the blob hashes that are missing locally.

The request contains:

- `replicationId`
- `lastSequence`
- `snapshot`
  - `generatedAt`
  - `registryGeneratedAt`
  - `controlBlobs`
  - `sampleChunks`

The response contains:

- `missingBlobHashes`

### `PUT /health-sync/_blob/{hash}`

Uploads one blob by content hash.

Rules:

- receiver must verify the path hash matches the uploaded bytes
- replay of an already-present hash is a success
- blob upload alone does not change the active snapshot

### `POST /health-sync/_commit`

Atomically commits a manifest and advances the checkpoint.

Rules:

- all referenced blob hashes must already exist
- checkpoint must never regress
- commit must be transactional
- on success, the committed manifest becomes the receiver truth
- `cache-export.json` is materialized after commit

## Manifest Shape

```json
{
  "replicationId": "replication-1",
  "lastSequence": 42,
  "snapshot": {
    "generatedAt": "2026-04-13T00:00:00Z",
    "registryGeneratedAt": "2026-04-10T06:53:51.367Z",
    "controlBlobs": [
      {
        "kind": "activity_summaries",
        "blobHash": "sha256...",
        "encoding": "gzip",
        "format": "ndjson",
        "itemCount": 629
      }
    ],
    "sampleChunks": [
      {
        "collectionKey": "activeEnergyBurned",
        "bucketId": "2026-04",
        "blobHash": "sha256...",
        "encoding": "gzip",
        "format": "ndjson",
        "sampleCount": 12345,
        "minStartDate": "2026-04-01T00:00:00Z",
        "maxStartDate": "2026-04-30T23:59:59Z"
      }
    ]
  }
}
```

## Correctness Rules

V3 keeps the same fail-closed principles as V2:

- missing blobs must fail commit
- malformed blobs must fail materialization
- checkpoint only advances with a successful commit
- commits are idempotent by replication id, sequence, and manifest content
- a transient inability to read data must not be treated as deletion

## Receiver Storage Model

Receiver state is split into:

- blob store on disk keyed by hash
- SQLite manifest metadata
- SQLite checkpoints
- materialized snapshot artifacts

This keeps large immutable payloads out of hot row-update paths while retaining
transactional manifest commits.

## Migration

`/health-sync` is the canonical endpoint surface.

`/health-sync-v3` may exist temporarily as a compatibility alias during rollout,
but senders and discovery should target `/health-sync`.
