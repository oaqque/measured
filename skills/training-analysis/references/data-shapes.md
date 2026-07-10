# Data Shapes

Use this file when creating or editing training source data under `data/training/`.

## Source Files

- `data/training/WELCOME.md`: welcome-page markdown
- `data/training/PLAN.md`: current training plan
- `data/training/GOALS.md`: current goal hierarchy and goal overview
- `data/training/goals/*.md`: one detailed goal note per goal
- `data/training/notes/*.json`: one workout note per file
- `data/training/routes/*.json`: curated public planned-course route streams for note map/elevation display
- `data/training/changelog/*.md`: one changelog entry per file

## Plan Analysis Timeline Shape

`data/training/PLAN.md` may end with a structured analysis timeline section:

````md
## Analysis Timeline

```json plan-analysis-timeline
{
  "schemaVersion": 1,
  "updatedAt": "2026-04-17",
  "sourceSummary": "Short source note.",
  "entries": [
    {
      "id": "2026-04-17-weekend-adjustment",
      "date": "2026-04-17",
      "period": {
        "start": "2026-04-13",
        "end": "2026-04-19"
      },
      "category": "current block",
      "title": "Weekend reopened, but basketball stayed out",
      "summary": "Short display summary.",
      "metrics": {
        "fridayRunKm": 10.03,
        "fridayAverageHeartRateBpm": 153.1
      },
      "analysis": "Markdown-capable analysis text."
    }
  ]
}
```
````

Rules:

- Keep this section at the bottom of `PLAN.md`.
- The fence info string must include `plan-analysis-timeline`.
- `schemaVersion` is `1`.
- `updatedAt`, `date`, and optional `period.start` / `period.end` are `YYYY-MM-DD` dates.
- `metrics` values must be scalar JSON values: string, number, boolean, or null.
- `analysis` may contain markdown syntax, but it must be valid JSON string content.
- The build strips this raw JSON from the main plan markdown and publishes it as `plan.analysisTimeline`.

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
- `plannedRoute`

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
- `plannedRoute.path` must be relative to `data/training` and point under `routes/`; use it only for publishable planned-course traces, not private provider caches.
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
