# Workout Note Fields

This document describes the canonical JSON shape for workout notes in
`data/training/notes/*.json`.

The current build logic lives in [`scripts/build-workouts-data.ts`](/home/willye/Workspace/measured/scripts/build-workouts-data.ts).
Workout notes are the authored source of truth. Imported provider data should
stay in provider caches under `vault/` and should be linked from notes rather
than copied into note fields unless there is a deliberate manual override.

## Top-Level Fields

Every workout note JSON document should include:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schemaVersion` | `1` | yes | Canonical workout-note schema version. |
| `title` | string | yes | Human-readable workout title. |
| `allDay` | boolean | yes | Keeps workouts as all-day calendar items. Use `true`. |
| `type` | string | yes | Session shape. Current notes use `single`. |
| `date` | ISO date string | yes | Workout date in `YYYY-MM-DD` form. |
| `completed` | `false` or ISO timestamp | yes | `false` for planned sessions, or the completion timestamp once done. |
| `eventType` | string | yes | Session category. Allowed values: `run`, `basketball`, `strength`, `mobility`, `race`. |
| `sections` | array | yes | Ordered authored note sections. |

Optional top-level fields:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `expectedDistance` | string | no | Planned distance, for example `10 km`. |
| `actualDistance` | string | no | Manual actual distance snapshot, for example `8.2 km`. Use only when you want a note-level override instead of provider-derived data. |
| `activityRefs` | object | no | Map of provider ids linked to this note, for example Strava and Apple Health. |
| `stravaId` | positive integer | no | Legacy Strava link field. Keep reading it for back-compat, but prefer `activityRefs.strava` for new multi-provider notes. |

## Section Model

The `sections` array preserves note order. Supported top-level section kinds:

- `program`
- `analysis`
- `importedFromStrava`
- `markdown`

### `program`

- Canonical replacement for the old `## Program` markdown section.
- `markdown` contains the section body only, not the heading.

Example:

```json
{
  "kind": "program",
  "markdown": "- 8 km easy aerobic run\n- Keep this fully conversational."
}
```

### `importedFromStrava`

- Canonical replacement for the old `## Imported from Strava` markdown section.
- Use this for legacy or imported Strava summaries that should remain visible as authored text.

### `markdown`

- Generic top-level markdown section for headings that do not map to a first-class kind.
- Use when the note needs a preserved section such as `Session Structure`, `Targets`, or `Rationale`.

Example:

```json
{
  "kind": "markdown",
  "heading": "Targets",
  "markdown": "- Keep the first rep patient."
}
```

### `analysis`

- Structured analysis container.
- `summaryMarkdown` is optional free markdown before any typed analysis subsections.
- `sections` is an ordered array of typed analysis-section entries.

Supported analysis section kinds:

- `intention`
- `shortTermGoal`
- `longTermGoal`
- `personalNote`
- `appleHealthMeasurement`
- `stravaMeasurement`
- `markdown`

Measurement analysis sections use markdown too:

- `appleHealthMeasurement.measurement`
  - `heartRate`
  - `cadence`
- `stravaMeasurement.measurement`
  - `pace`
  - `heartRate`
  - `moving`
  - `elevation`

The build step renders these back to markdown headings:

- `### Intention`
- `### Short-Term Goal`
- `### Long-Term Goal`
- `### Personal Note`
- `### Apple Health Heart Rate`
- `### Apple Health Cadence`
- `### Strava Pace`
- `### Strava Heart Rate`
- `### Strava Moving`
- `### Strava Elevation`

## Field Semantics

### `completed`

- Use `false` for planned notes.
- Use an ISO timestamp for completed notes.
- Example: `2026-03-30T20:33:42+11:00`

### `expectedDistance`

- This is the planned target for the session.
- It should describe intent, not what happened.
- For gym, basketball, mobility, or rest-style sessions, `0 km` is acceptable if
  you want the weekly distance table to stay explicit.

### `actualDistance`

- This is optional.
- Prefer using it only when you want to pin a manual actual distance in the note itself.
- If a note links provider data, the app can derive actual distance from the provider cache instead.

### `activityRefs`

- Use this to link one note to one or more provider records.
- Current providers are expected to include:
  - `strava`
  - `appleHealth`
- Provider ids should be stored as strings in this map.
- One note may include both providers at the same time.
- Linking both providers does not mean their data should be merged into one stored record.

Example:

```json
{
  "activityRefs": {
    "strava": "17909794797",
    "appleHealth": "2E5A1E76-6C98-4B89-8D3B-4B0A45D8C9E1"
  }
}
```

### `stravaId`

- Use the numeric Strava activity ID only for legacy notes that still rely on the older field.
- Prefer `activityRefs.strava` for new linkage.
- The build layer treats `stravaId` as a migration alias for `activityRefs.strava`.

## Planned Note Example

```json
{
  "schemaVersion": 1,
  "title": "10 km Threshold Run",
  "allDay": true,
  "type": "single",
  "date": "2026-03-31",
  "completed": false,
  "eventType": "run",
  "expectedDistance": "10 km",
  "sections": [
    {
      "kind": "program",
      "markdown": "- 2 km easy warm-up\n- 3 x 8 minutes at threshold effort with 2 minutes easy jog between reps\n- Cool down easy to 10 km total"
    }
  ]
}
```

## Multi-Provider Completed Note Example

```json
{
  "schemaVersion": 1,
  "title": "6 km Easy Run",
  "allDay": true,
  "type": "single",
  "date": "2026-03-30",
  "completed": "2026-03-30T20:33:42+11:00",
  "eventType": "run",
  "expectedDistance": "6 km",
  "activityRefs": {
    "strava": "17909794797",
    "appleHealth": "2E5A1E76-6C98-4B89-8D3B-4B0A45D8C9E1"
  },
  "sections": [
    {
      "kind": "program",
      "markdown": "- 6 km easy run"
    },
    {
      "kind": "analysis",
      "sections": [
        {
          "kind": "intention",
          "markdown": "- Add workout observations here."
        },
        {
          "kind": "appleHealthMeasurement",
          "measurement": "heartRate",
          "markdown": "- Add Apple Health heart-rate analysis here."
        },
        {
          "kind": "stravaMeasurement",
          "measurement": "pace",
          "markdown": "- Add Strava pace analysis here."
        }
      ]
    }
  ]
}
```

## Imported Strava Notes

Historically imported Strava-only notes may still contain `expectedDistance`
because that was the original import shape.

The current build layer treats those imported notes differently:

- if the note links a Strava activity
- and it contains an `importedFromStrava` section
- and it does not have `actualDistance`

then the app treats that stored distance as actual distance and does not expose
it as planned distance in the generated data.

For new notes, prefer:

- `expectedDistance` for planned sessions
- `activityRefs` for provider linkage
- `actualDistance` only when you intentionally want a manual note-level override
