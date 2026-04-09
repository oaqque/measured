# Apple Health Sync Architecture

## Context

This repo already has a clear ingestion pattern:

1. A provider-specific sync step writes a local cache export under `vault/`.
2. `scripts/build-workouts-data.ts` reads workout notes plus those cache exports.
3. The build emits `src/generated/workouts.json` and route JSON files under `public/generated/workout-routes/`.

Today that path is Strava-specific:

- `scripts/build-workouts-data.ts` reads only `vault/strava/cache-export.json`
- note linkage is `stravaId`
- generated workout fields include `stravaId` and `hasStravaStreams`
- route loading assumes a numeric activity id in `/generated/workout-routes/<id>.json`

Apple Health should not replace Strava in that model.

The repo should support multiple provider caches side by side, allow a note to
link more than one provider record, and keep each provider's data separate all
the way through import, build, and generated output.

## Key Constraint

Treat Apple Health as the integration target, not the Apple Watch directly.

Reason:

- Apple Watch workout data is normally persisted into HealthKit on the paired iPhone
- HealthKit access is app-based and local to Apple platforms
- this repo does not have a server-side or desktop API path that can query Apple Health directly

In practice that means:

- the realistic sync product is an iPhone app, optionally with a watchOS companion later
- the repo should ingest exported HealthKit data from that app
- "direct Apple Watch sync" only makes sense if we also want a custom watch app that records workouts itself

## Options

### Option 1: Manual Apple Health XML import

Flow:

1. Export all Health data from the Health app.
2. Import the XML into a repo-local parser.
3. Normalize workouts and routes into `vault/apple-health/cache-export.json`.

Pros:

- fastest proof of concept
- no native app required
- good for one-time backfill

Cons:

- export is coarse and user-driven, not incremental
- parsing the full XML export is heavy
- route handling is less ergonomic than native HealthKit queries
- bad day-to-day sync UX

Verdict:

- useful only as a backfill/bootstrap path
- not the long-term architecture

### Option 2: iPhone HealthKit bridge app

Flow:

1. A small iPhone app requests HealthKit read permission.
2. It reads HealthKit data into a private local cache, including workouts first
   and additional health domains as the bridge expands.
3. It stores a local normalized cache and an incremental anchor.
4. It exports a local cache snapshot into a shared location.
5. The repo copies or imports that snapshot into `vault/apple-health/`.
6. Repo build steps project only the subsets needed for publication.

Pros:

- incremental sync
- route access through native APIs
- can identify Apple Watch sourced workouts
- best fit for the repo's existing local-cache model

Cons:

- requires an Xcode project and Apple-platform code
- needs explicit permission handling and local export UX

Verdict:

- recommended architecture

### Option 3: watchOS app plus iPhone bridge

Flow:

1. A custom watch app records workouts or receives planned workouts.
2. The iPhone companion syncs them through HealthKit and exports to the repo.

Pros:

- strongest long-term Apple ecosystem integration
- opens the door to planned workouts on-watch

Cons:

- significantly larger product surface
- not required just to read workouts already written by Apple Workout / Health

Verdict:

- defer unless the goal expands beyond sync into workout execution on the watch

## Recommended Architecture

Build this in two layers:

1. A provider-aware repo ingestion layer.
2. An iPhone HealthKit bridge that exports a private Apple Health cache.

### Layer 1: Repo-side provider separation

Before adding Apple Health, generalize the current Strava-only data model.

The important design rule is this:

- authored workout notes stay separate from imported provider data
- Strava data stays separate from Apple Health data
- duplicate provider records remain duplicate provider records unless a user explicitly links them to the same note
- the build layer can project provider-specific summaries for UI use, but it should not erase provider boundaries

Recommended note frontmatter evolution:

```md
---
title: 8 km Easy Aerobic Run
allDay: true
type: single
date: '2026-04-02'
completed: 2026-04-02T18:22:00+11:00
eventType: run
expectedDistance: 8 km
activityRefs:
  strava: '17909794797'
  appleHealth: '2E5A1E76-6C98-4B89-8D3B-4B0A45D8C9E1'
---
```

Back-compat rules:

- keep reading `stravaId` during migration
- populate `activityRefs.strava` from `stravaId` when only the legacy field exists
- add `activityRefs.appleHealth` without disturbing existing Strava linkage
- do not require a canonical provider field

Recommended generated workout shape changes:

```ts
type WorkoutProvider = "strava" | "appleHealth";

interface WorkoutActivityRefMap {
  strava?: string;
  appleHealth?: string;
}

interface WorkoutProviderSummary {
  provider: WorkoutProvider;
  activityId: string;
  sportType: string | null;
  startDate: string | null;
  distanceMeters: number | null;
  movingTimeSeconds: number | null;
  elapsedTimeSeconds: number | null;
  hasRouteStreams: boolean;
  routePath: string | null;
}

interface WorkoutNote {
  // existing fields...
  activityRefs: WorkoutActivityRefMap;
  sources: Partial<Record<WorkoutProvider, WorkoutProviderSummary>>;
}
```

Why this matters:

- `src/lib/workouts/schema.ts` currently hard-codes `stravaId` and `hasStravaStreams`
- `src/lib/workouts/routes.ts` currently assumes `/generated/workout-routes/<numeric-id>.json`
- `scripts/build-workouts-data.ts` currently reads a single Strava cache export

Without this refactor, Apple Health support will turn into conditionals scattered across the app.

### Layer 2: iPhone HealthKit bridge app

Create a small native app, ideally in a separate Xcode project such as:

- `apps/apple-health-bridge/`

The app should have four responsibilities:

1. Request HealthKit authorization for the Apple Health data domains we choose to
   cache privately on-device.
2. Perform initial backfill and incremental sync using HealthKit queries.
3. Normalize data into a bridge-owned cache schema that can hold more data than
   the public site will ever publish.
4. Export the cache snapshot into a user-controlled local destination.

Suggested native modules:

- `HealthAuthorizationManager`
- `WorkoutSyncEngine`
- `RouteSyncEngine`
- `ExportWriter`
- `ExportShareController`

## HealthKit Sync Model

### Initial sync

Workouts are still the first implementation target, but the bridge cache should
be designed as a superset, not as a public-site-shaped export.

Design rule:

- the bridge cache may contain substantially more Apple Health data than the web
  app consumes
- `vault/` is the private local cache boundary
- publication is a later projection step, not the shape of the bridge cache
- we choose what is published during repo build, not during HealthKit export

Read all workouts first.

Suggested filters:

- do not restrict the private cache to runs only
- do not discard workouts just because a similar Strava activity exists elsewhere in the repo
- keep the bridge schema open to non-workout Apple Health domains later

Store per-workout:

- `workoutUuid`
- `activityType`
- `startDate`
- `endDate`
- `durationSeconds`
- `distanceMeters`
- `totalEnergyBurned`
- `averageHeartRate`
- `maxHeartRate`
- `sourceBundleIdentifier`
- `sourceName`
- `deviceName`
- `deviceModel`
- `metadata`
- `hasRoute`
- `lastModifiedAt`

### Incremental sync

Use anchored queries and persist the anchor locally in the app container.

For each sync run:

1. fetch newly added or updated workouts
2. detect deleted workouts
3. refresh route payloads for workouts whose route is missing or stale
4. write a new normalized export snapshot

This avoids repeated full exports and matches the existing provider-cache pattern.

### Route sync

For outdoor workouts, sync route points separately from workout summaries.

Repo-side shape can stay close to the current route stream payload:

```json
{
  "latlng": [[-33.87, 151.21], [-33.871, 151.212]],
  "altitude": [14.2, 14.6],
  "distance": [0.0, 23.7],
  "heartrate": [138, 141],
  "velocitySmooth": [2.8, 2.9],
  "moving": null
}
```

Apple Health may not provide every series in exactly the same shape as Strava.
The build layer should tolerate partial route payloads rather than assuming parity.

## Repo-Side Cache Layout

Add a second provider cache beside Strava:

```text
vault/
  apple-health/
    cache.sqlite3
    cache-export.json
    export-manifest.json
```

Suggested `cache-export.json` shape for the workout projection:

```json
{
  "generatedAt": "2026-04-02T09:30:00Z",
  "provider": "appleHealth",
  "activities": {
    "2E5A1E76-6C98-4B89-8D3B-4B0A45D8C9E1": {
      "activityId": "2E5A1E76-6C98-4B89-8D3B-4B0A45D8C9E1",
      "sportType": "run",
      "startDate": "2026-04-02T07:22:00+11:00",
      "distanceMeters": 8043.2,
      "distanceKm": 8.043,
      "movingTimeSeconds": 2621,
      "elapsedTimeSeconds": 2688,
      "averageHeartrate": 149,
      "maxHeartrate": 171,
      "summaryPolyline": null,
      "detailFetchedAt": "2026-04-02T09:30:00Z",
      "hasStreams": true,
      "routeStreams": {
        "latlng": [],
        "altitude": [],
        "distance": [],
        "heartrate": [],
        "velocitySmooth": []
      },
      "source": {
        "bundleIdentifier": "com.apple.workout",
        "name": "Workout",
        "deviceModel": "Watch"
      }
    }
  },
  "deletedActivityIds": []
}
```

Important points:

- use string ids for Apple Health workouts
- do not force numeric ids into the shared model
- keep each provider's export self-contained rather than mixing provider payloads in one cache file
- the long-term Apple Health bridge cache may include additional top-level
  sections beyond `activities`

## Build Integration

`scripts/build-workouts-data.ts` should become a multi-provider assembly layer
that projects from the private Apple Health cache into publishable workout data.

Suggested build steps:

1. read notes
2. read Strava cache if present
3. read Apple Health cache if present
4. collect all explicit note-to-provider links
5. attach provider-specific summaries to each note
6. emit provider-qualified route files
7. optionally emit diagnostics for unlinked or duplicate-looking activities

The Apple Health cache can contain more than the build consumes. That is
intentional.

Recommended route output path:

```text
public/generated/workout-routes/strava/17909794797.json
public/generated/workout-routes/apple-health/2E5A1E76-6C98-4B89-8D3B-4B0A45D8C9E1.json
```

That avoids id collisions and removes the numeric-id assumption.

## Matching And Dedupe

There are two different matching problems here.

### 1. Explicit note linkage

This is the clean path.

If a note declares:

- `activityRefs.appleHealth`
- `activityRefs.strava`

then the build should trust those links.

One note may point to both providers.

### 2. Duplicate-looking provider activities

The same Apple Watch run may appear in both Apple Health and Strava.

Do not auto-merge those provider records into one synthetic activity.
Do not discard one provider because another one exists.

Instead:

- keep both provider records in their own caches
- allow both to be linked to the same note
- preserve provider-specific metrics, metadata, and routes separately
- if the UI needs a default route or metric display, treat that as a presentation preference, not a data-model collapse

If needed later, add a diagnostics command that proposes duplicate pairings based on:

- start time proximity
- distance delta
- duration delta

That command should suggest links. It should not rewrite the underlying provider data into a merged record.

## Export UX

The bridge app should not write into the repo directly.

Use a user-driven export boundary:

- export a snapshot into iCloud Drive, Files, or a share sheet
- then run a repo-side import command such as `pnpm run import:apple-health`

That keeps the repo local-first and avoids forcing brittle desktop-to-phone connectivity into v1.

Suggested repo commands:

- `pnpm run import:apple-health -- --from ~/Downloads/apple-health-export`
- `pnpm run sync:apple-health` only after a stable direct import path exists

## Security And Privacy

Apple Health data is more sensitive than Strava sync data.

Minimum rules:

- keep raw or expanded bridge exports under `vault/apple-health/`
- add `vault/apple-health/*.json` and `vault/apple-health/*.sqlite3` to `.gitignore`
- avoid checking raw health exports into git
- decide what to publish during repo build, not by trimming the bridge cache to
  public-site needs

## Suggested Delivery Plan

### Phase 1: repo refactor

- make workout linkage provider-aware instead of Strava-only
- make route loading provider-qualified
- keep full back-compat with current Strava notes

### Phase 2: bootstrap importer

- support manual Apple Health XML import for backfill
- normalize into `vault/apple-health/cache-export.json`

### Phase 3: native bridge

- build iPhone HealthKit export app
- support anchored incremental sync
- export repo-friendly snapshots

### Phase 4: ergonomics

- add note-linking helpers
- add duplicate diagnostics between Strava and Apple Health
- add UI-level source preferences only if needed, without collapsing provider data
- optionally add a watchOS companion or WorkoutKit integration

## Concrete Repo Impact

These are the files that would need to change first:

- `scripts/build-workouts-data.ts`
- `src/lib/workouts/schema.ts`
- `src/lib/workouts/routes.ts`
- `docs/note-fields.md`
- `.gitignore`

And these are likely new additions:

- `scripts/import-apple-health-export.ts` or `scripts/import-apple-health-export.py`
- `apps/apple-health-bridge/` for the native exporter

## Bottom Line

The right architecture is not "sync the watch straight into the repo."

The right architecture is:

1. read Apple Watch workout data through HealthKit on iPhone
2. export a normalized local Apple Health cache that can exceed the public app's needs
3. read Strava and Apple Health caches side by side in the repo
4. project publishable workout data from that cache during build
5. let notes link one or more provider records
6. keep provider data separate in storage and generated output

That preserves the repo's current local-cache pattern without forcing the app
to choose between Strava and Apple Health as a single source of truth.
