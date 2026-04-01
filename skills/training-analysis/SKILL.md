---
name: training-analysis
description: Analyze training data and maintain the repo's training source files. Use when Codex needs to fetch or sync Strava data, backfill or update workout notes in data/training/notes, revise the training plan in data/training/README.md, create changelog entries in data/training/changelog, or explain the relationship between planned sessions and completed runs.
---

# Training Analysis

Use this skill to keep the training data in this repo coherent across Strava sync, workout-note authorship, plan updates, and changelog history.

## Workflow Choice

- If the user asks to fetch new run data or refresh Strava-backed fields, follow `Sync and Refresh`.
- If the user asks for analysis of a recent or historical run, follow `Analyze and Update a Workout Note`.
- If the user asks to add or revise planned sessions, follow `Create or Revise a Workout File`.
- If the work changes the plan, schedule, or interpretation of existing files, follow `Create a Changelog Entry`.

Read [`references/data-shapes.md`](references/data-shapes.md) before creating or editing workout notes or changelog files.

## Sync and Refresh

1. Run `pnpm run sync:strava` from the repo root. This repo defaults that command to sync with streams.
2. If the user asked for new analysis, identify the relevant Strava activity from the refreshed cache and the corresponding note by `stravaId`, date, or schedule context.
3. Run `pnpm run build:data` after note or plan changes so the app reflects them.
4. Run `pnpm run typecheck` after UI or data-model changes. For note-only edits, `pnpm run build:data` is usually enough.

## Analyze and Update a Workout Note

1. Read the plan first in `data/training/README.md` before writing analysis for a run. Treat the scheduled intent as the baseline.
2. Open the target note in `data/training/notes/`.
3. If no note exists for the run, create one using the workout note shape in `references/data-shapes.md`.
4. Keep planned intent and actual outcome separate:
   - `expectedDistance` is the plan.
   - `actualDistance` is only for manual overrides.
   - `stravaId` is the stable Strava linkage.
5. In the note body, preserve or add the planned workout structure, then add analysis below it. Make the analysis specific:
   - what happened
   - how it differed from the plan
   - what stream or summary data shows
   - what it implies for the next sessions
6. If the run happened on a different day than planned, state that explicitly and update the surrounding notes or plan if needed.

## Create or Revise a Workout File

1. Use one markdown file per workout in `data/training/notes/`.
2. Name the file `YYYY-MM-DD Title.md`.
3. Keep the frontmatter canonical and minimal. Use the fields documented in `references/data-shapes.md`.
4. For planned sessions, focus the body on prescription and execution details.
5. For completed sessions, keep the original prescription visible and append analysis rather than overwriting the note into a pure diary entry.
6. If changing the weekly structure, update both:
   - `data/training/README.md`
   - the affected note files in `data/training/notes/`

## Create a Changelog Entry

Create a changelog entry when the repo’s training source of truth changes in a way that matters later, for example:

- a workout moves to a different day
- the weekly plan is rebalanced
- a note is reinterpreted because the actual run differed materially from the plan
- the set of planned sessions changes

Do not create a changelog entry for every wording tweak or minor analysis edit.

When creating an entry:

1. Add one markdown file under `data/training/changelog/`.
2. Use the file name pattern `YYYY-MM-DD-short-description.md`.
3. Set `affectedFiles` relative to `data/training`, for example:
   - `README.md`
   - `WELCOME.md`
   - `notes/2026-04-01 10 km Threshold Run.md`
4. In the body, explain what changed, why it changed, and what downstream impact it has.

## Quality Bar

- Keep note titles, dates, and Strava linkage consistent.
- Never blur planned versus actual distance.
- If a workout analysis implies plan changes, update the plan files in the same pass instead of leaving them inconsistent.
- After structural data changes, regenerate app data before finishing.
