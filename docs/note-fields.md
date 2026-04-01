# Workout Note Fields

This document describes the frontmatter fields supported by workout notes in
`data/training/notes/*.md`.

The current build logic lives in `scripts/build-workouts-data.ts`. Notes are the
authored source of truth. Some Strava-backed values are derived at build time
from the local cache and do not need to be written into every note manually.

## Required Frontmatter

Every workout note should include:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `title` | string | yes | Human-readable workout title. |
| `allDay` | boolean | yes | Keeps workouts as all-day calendar items. Use `true`. |
| `type` | string | yes | Session shape. Current notes use `single`. |
| `date` | ISO date string | yes | Workout date in `YYYY-MM-DD` form. |
| `completed` | `false` or ISO timestamp | yes | `false` for planned sessions, or the completion timestamp once done. |
| `eventType` | string | yes | Session category. Allowed values: `run`, `basketball`, `strength`, `mobility`, `race`. |

## Optional Frontmatter

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `expectedDistance` | string | no | Planned distance, for example `10 km`. |
| `actualDistance` | string | no | Manual actual distance snapshot, for example `8.2 km`. Usually leave this to the Strava cache unless you need an override. |
| `stravaId` | positive integer | no | Stable link to the Strava activity for this note. |

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
- Prefer using it only when you want to pin a manual actual distance in the note
  itself.
- If a note has `stravaId`, the app can derive actual distance from the local
  Strava cache instead.

### `stravaId`

- Use the numeric Strava activity ID.
- This is the preferred way to connect a note to a Strava run.
- Once linked, the local sync/cache layer can refresh Strava-backed fields
  without changing the authored note body.

## Body Content

The markdown body is free-form. Common sections used in this repo:

- `## Program`
- `## Session Structure`
- `## Targets`
- `## Analysis`
- `## Imported from Strava`

For planned workouts, keep the body focused on prescription and execution.
For completed workouts, add analysis or observations below the planned session.

## Planned Note Example

```md
---
title: 10 km Threshold Run
allDay: true
type: single
date: '2026-03-31'
completed: false
eventType: run
expectedDistance: 10 km
---

## Program

- 2 km easy warm-up
- 3 x 8 minutes at threshold effort with 2 minutes easy jog between reps
- Cool down easy to 10 km total
```

## Strava-Linked Completed Note Example

```md
---
title: 6 km Easy Run
allDay: true
type: single
date: '2026-03-30'
completed: 2026-03-30T20:33:42+11:00
eventType: run
expectedDistance: 6 km
stravaId: 17909794797
---

## Program

- 6 km easy run

## Analysis

- Add workout observations here.
```

## Imported Strava Notes

Historically imported Strava-only notes may still contain `expectedDistance`
because that was the original import shape.

The current build layer treats those imported notes differently:

- if the note is clearly imported from Strava
- and it has `stravaId`
- and it does not have `actualDistance`

then the app treats that stored distance as actual distance and does not expose
it as planned distance in the generated data.

For new notes, prefer:

- `expectedDistance` for planned sessions
- `stravaId` for Strava linkage
- `actualDistance` only when you intentionally want a manual note-level override
