# Apple Health Sync Protocol V2

## Status

Proposed replacement for the current custom session/delta/commit protocol.

This design intentionally copies the shape of the Apache CouchDB replication
protocol for one-way push replication of JSON documents over HTTP.

Why this protocol:

- it is explicitly specified, not just implied by code
- it is designed for unreliable networks and resumable replication
- it uses checkpoints and idempotent bulk writes
- it matches our data better than file/block sync protocols

## Non-Goals

- Full CouchDB compatibility
- Peer-to-peer file sync
- Byte-range upload resumability for large opaque files

If we later need resumable attachment uploads for very large route payloads, we
can layer `tus` underneath attachments without changing the sync model.

## Choice

V2 should copy CouchDB's replication model:

1. The bridge is the push replicator.
2. The bridge stores local documents plus a local monotonic change sequence.
3. The receiver stores documents plus per-replicator checkpoints.
4. The bridge asks the receiver which revisions are missing.
5. The bridge sends only missing documents in bulk.
6. The checkpoint advances only after durable application.

This replaces:

- custom session ids
- staged batch directories
- collection chunk assembly
- commit-time snapshot reconstruction from bespoke batch types

## Data Model

Everything synced over the wire is a document.

Required fields on every document:

- `_id`: globally unique document id
- `_rev`: source-generated revision token
- `type`: one of `activity`, `route`, `collectionMeta`, `sample`, `tombstone`
- `deleted`: boolean tombstone flag
- `updatedAt`: ISO-8601 timestamp

Recommended `_id` layout:

- `activity:<activityId>`
- `route:<activityId>`
- `collectionMeta:<collectionKey>`
- `sample:<collectionKey>:<sampleId>`

Recommended revision format:

- `<generation>-<sha256>`

Examples:

- `1-4c8c...`
- `2-a912...`

The source bridge is responsible for incrementing generation when a document's
logical content changes.

## Canonical Mapping

Current export entities should map to V2 documents like this:

- Activity summary: one `activity:*` doc
- Route streams: one `route:*` doc
- Collection metadata: one `collectionMeta:*` doc
- Each HealthKit sample: one `sample:*` doc
- Deletion: same `_id` with `deleted: true` and a newer `_rev`

Critical change from V1:

- collections are no longer transmitted as giant mutable arrays
- samples are replicated independently

This removes the current correctness and batching problems around:

- partially clearing a collection on descriptor failure
- chunk-count sizing bugs
- huge collection payloads for small incremental changes

## Transport

HTTP with JSON bodies.

Compression:

- clients SHOULD send `Accept-Encoding: gzip`
- servers SHOULD support `Content-Encoding: gzip`

Authentication:

- unchanged from current deployment assumptions
- Tailnet transport remains acceptable for v1 rollout
- bearer or mutual-auth can be added separately from protocol semantics

## Endpoints

Receiver-side endpoints should mirror the minimal subset needed for push
replication.

### `GET /health-sync-v2`

Returns server metadata:

- protocol version
- schema
- receiver id
- max request bytes
- supported encodings

### `GET /health-sync-v2/_local/{replicationId}`

Returns the last durable checkpoint known by the receiver for this replication
stream.

Response:

- `lastSequence`
- `updatedAt`

### `PUT /health-sync-v2/_local/{replicationId}`

Writes the new durable checkpoint after the corresponding documents have been
applied successfully.

Request:

- `lastSequence`
- `updatedAt`

### `POST /health-sync-v2/_revs_diff`

Client sends document ids and revisions it can provide.

Receiver responds with the subset it does not already have.

Request shape:

```json
{
  "activity:abc": ["3-deadbeef"],
  "sample:heartRate:123": ["7-cafebabe"]
}
```

Response shape:

```json
{
  "activity:abc": { "missing": ["3-deadbeef"] },
  "sample:heartRate:123": { "missing": ["7-cafebabe"] }
}
```

### `POST /health-sync-v2/_bulk_docs`

Applies missing documents idempotently.

Request shape:

```json
{
  "docs": [
    {
      "_id": "activity:abc",
      "_rev": "3-deadbeef",
      "type": "activity",
      "deleted": false,
      "updatedAt": "2026-04-11T10:00:00Z",
      "data": {}
    }
  ],
  "new_edits": false
}
```

Rules:

- receiver MUST treat replay of the same `_id` + `_rev` as success
- receiver MUST reject malformed docs without mutating checkpoint state
- receiver MUST durably write accepted docs before acknowledging success

## Replication ID

Replication checkpoint state must be keyed by a stable replication id derived
from:

- sender id
- receiver id
- schema

Recommended format:

- `sha256(senderId + "\n" + receiverId + "\n" + schema)`

## Source Algorithm

For each sync run:

1. Read receiver metadata.
2. Compute replication id.
3. Read receiver checkpoint.
4. Read local source changes where `sequence > lastSequence`.
5. Batch changed docs by count and byte size.
6. For each batch:
   - call `_revs_diff`
   - send only missing docs to `_bulk_docs`
7. After all batches are durable on the receiver, write the new checkpoint with
   the highest fully-applied local sequence.

This is push replication. The receiver never guesses what changed.

## Receiver Rules

The receiver must fail closed.

Required behaviors:

- if current persisted state is unreadable, reject replication instead of
  pretending the cache is empty
- if a request exceeds limits, return an error without advancing checkpoint
- if some docs in a batch are invalid, return a structured failure and do not
  advance checkpoint
- if the same batch is replayed, accept already-known revisions as no-ops

## Local Storage

Receiver storage should move from "single snapshot JSON file as source of truth"
to a document store with materialized export output.

Recommended layout:

- `vault/apple-health-sync-server/docs.sqlite3`
- `vault/apple-health-sync-server/checkpoints.sqlite3`
- `vault/apple-health/cache-export.json`
- `vault/apple-health/export-manifest.json`

SQLite tables:

- `docs(id text, rev text, sequence integer, deleted integer, type text, body json, primary key(id, rev))`
- `current_docs(id text primary key, rev text, deleted integer, type text, body json)`
- `checkpoints(replication_id text primary key, last_sequence integer, updated_at text)`

`cache-export.json` becomes a projection generated from `current_docs`, not the
authoritative store.

## Materialization

The receiver should rebuild the exported snapshot from current documents:

- `activity:*` docs become `activities`
- `route:*` docs enrich matching activities
- `collectionMeta:*` docs describe collections
- `sample:*` docs are grouped by collection key
- deleted docs are excluded from live sections

This projection can run:

- on every successful `_bulk_docs`
- or after each sync transaction

## Error Model

Suggested status codes:

- `400` invalid payload
- `401` or `403` auth failure
- `404` unknown endpoint or checkpoint doc
- `409` conflicting checkpoint write or unsupported replication state
- `413` request too large
- `422` semantically invalid document
- `500` internal receiver error
- `503` temporary receiver unavailability

Responses should be structured JSON with:

- `error`
- `code`
- `retryable`

## Why V2 Is More Efficient

- no giant mutable collection documents
- no collection chunk bookkeeping
- no session staging directories
- no commit-time replay of bespoke batch semantics
- no retransmission of unchanged samples inside a changed collection

In steady state, the bridge sends only the changed sample/activity/route docs
since the last checkpoint.

## Why V2 Is More Correct

- checkpoints are explicit and durable
- replay is idempotent by `_id` + `_rev`
- corrupted receiver state does not silently degrade to empty state
- partial authorization does not require synthesizing empty collections
- transient descriptor failures can leave prior docs untouched

## Migration

### Phase 1

Write this protocol spec and keep V1 running.

### Phase 2

Implement receiver-side document store and V2 endpoints.

### Phase 3

Teach the bridge to maintain per-document revisions and local sequence numbers.

### Phase 4

Run dual-write or shadow verification:

- V1 snapshot path
- V2 document replication path

### Phase 5

Remove:

- `/health-sync/session`
- `/health-sync/delta`
- `/health-sync/commit`
- collection chunk upserts

## Rejected Alternatives

### Syncthing BEP

Excellent for file/block replication, wrong abstraction for HealthKit-derived
 structured JSON entities and per-sample tombstones.

### rsync

Excellent for binary/file delta transfer, weak fit for object-level merge,
checkpoint, and tombstone semantics.

### tus alone

Excellent for resumable uploads, but it is an upload protocol rather than a
replication model. It can complement V2 for large attachments, but should not
define our sync semantics.
