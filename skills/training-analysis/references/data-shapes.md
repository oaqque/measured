# Data Shapes

Use this file when creating or editing training markdown under `data/training/`.

## Source Files

- `data/training/WELCOME.md`: welcome-page markdown
- `data/training/README.md`: current training plan
- `data/training/notes/*.md`: one workout note per file
- `data/training/changelog/*.md`: one changelog entry per file

## Workout Note Shape

Required frontmatter:

- `title`
- `allDay`
- `type`
- `date`
- `completed`
- `eventType`

Optional frontmatter:

- `expectedDistance`
- `actualDistance`
- `stravaId`

Canonical example:

```md
---
title: 10 km Threshold Run
allDay: true
type: single
date: "2026-04-01"
completed: false
eventType: run
expectedDistance: 10 km
---
```

Rules:

- File name: `YYYY-MM-DD Title.md`
- `completed` is either `false` or an ISO timestamp.
- `eventType` must be one of `run`, `basketball`, `strength`, `mobility`, `race`.
- `expectedDistance` is planned intent.
- `actualDistance` is a manual override only.
- `stravaId` is the preferred Strava linkage.
- Keep the planned structure visible even after the session is completed.

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
  - README.md
  - notes/2026-03-31 3.7 km Evening Run.md
  - notes/2026-04-01 10 km Threshold Run.md
---
```

Rules:

- File name: `YYYY-MM-DD-short-description.md`
- `affectedFiles` paths are relative to `data/training`
- Use changelog entries for material planning or interpretation changes, not trivial prose edits

## Typical Commands

- `pnpm run sync:strava`
- `pnpm run build:data`
- `pnpm run typecheck`
