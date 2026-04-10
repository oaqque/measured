# Data Shapes

Use this file when creating or editing training source data under `data/training/`.

## Source Files

- `data/training/WELCOME.md`: welcome-page markdown
- `data/training/PLAN.md`: current training plan
- `data/training/notes/*.json`: one workout note per file
- `data/training/changelog/*.md`: one changelog entry per file

## Workout Note Shape

Workout notes now use canonical JSON documents rather than markdown frontmatter files.

Required top-level fields:

- `schemaVersion` with value `1`
- `title`
- `allDay`
- `type`
- `date`
- `completed`
- `eventType`
- `sections`

Optional top-level fields:

- `expectedDistance`
- `actualDistance`
- `activityRefs`
- `stravaId`

Canonical example:

```json
{
  "schemaVersion": 1,
  "title": "10 km Threshold Run",
  "allDay": true,
  "type": "single",
  "date": "2026-04-01",
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

Multi-provider linkage example:

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
        }
      ]
    }
  ]
}
```

Rules:

- File name: `YYYY-MM-DD Title.json`
- `completed` is either `false` or an ISO timestamp.
- `eventType` must be one of `run`, `basketball`, `strength`, `mobility`, `race`.
- `expectedDistance` is planned intent.
- `actualDistance` is a manual override only.
- `activityRefs` is the preferred provider linkage map.
- `stravaId` is the legacy Strava linkage field.
- `sections` preserves note order.
- Use `{"kind":"program","markdown":"..."}` for the workout prescription.
- Use `{"kind":"analysis","sections":[...]}` for structured analysis.

Supported analysis section kinds:

- `intention`
- `shortTermGoal`
- `longTermGoal`
- `personalNote`
- `appleHealthMeasurement` with `measurement: "heartRate" | "cadence"`
- `stravaMeasurement` with `measurement: "pace" | "heartRate" | "moving" | "elevation"`
- `markdown` for any other analysis subsection heading

See also [`/home/willye/Workspace/measured/docs/note-fields.md`](/home/willye/Workspace/measured/docs/note-fields.md) for the fuller note-field explanation.

## Changelog Entry Shape

Supported frontmatter:

- `title` required
- `date` required
- `scope` optional
- `tags` optional string array
- `affectedFiles` optional string array

Canonical example:

```md
---
title: Threshold Session Deferred to Wednesday
date: "2026-04-01"
scope: training-plan
tags:
  - threshold
  - scheduling
affectedFiles:
  - PLAN.md
  - notes/2026-03-31 3.7 km Evening Run.json
  - notes/2026-04-01 10 km Threshold Run.json
---
```

Rules:

- File name: `YYYY-MM-DD-short-description.md`
- `affectedFiles` paths are relative to `data/training`
- Use changelog entries for material planning or interpretation changes, not trivial prose edits

## Typical Commands

- `tailscale file get ~/Downloads`
- `pnpm run import:apple-health -- --from /home/willye/Downloads/cache-export.json`
- `pnpm run link:workout-source -- --note <note-slug> --provider appleHealth --activity-id <apple-health-id>`
- `pnpm run sync:strava`
- `pnpm run migrate:workout-notes:json`
- `pnpm run build:data`
- `pnpm run typecheck`
