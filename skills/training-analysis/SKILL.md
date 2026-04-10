---
name: training-analysis
description: Analyze training data and maintain the repo's training source files. Use when Codex needs to fetch or sync Strava or Apple Health data, backfill or update workout notes in data/training/notes, revise the training plan in data/training/PLAN.md, create changelog entries in data/training/changelog, explain the relationship between planned sessions and completed runs, or package that work into a required git commit at the end.
---

# Training Analysis

Use this skill to keep the training data in this repo coherent across Strava sync, Apple Health sync, workout-note authorship, plan updates, and changelog history.

## Workflow Choice

- If the user asks to fetch new run data or refresh provider-backed fields, follow `Sync and Refresh`.
- If the user asks for analysis of a recent or historical run, follow `Sync and Refresh` first, then `Analyze and Update a Workout Note`.
- Any workflow that produces or materially revises run analysis must also follow `Create a Changelog Entry`.
- If the user asks to add or revise planned sessions, follow `Create or Revise a Workout File`.
- If the work changes the plan, schedule, or interpretation of existing files, follow `Create a Changelog Entry`.

Read [`references/data-shapes.md`](references/data-shapes.md) before creating or editing workout notes or changelog files.

## Sync and Refresh

1. Fetch the current local date and time first using Linux CLI utilities such as `date`. Do this at the start of every training-analysis run so any references to "today", "yesterday", or "this week" are grounded in the machine's current time.
2. Fetch the latest Apple Health export from the Taildrop inbox with `tailscale file get ~/Downloads` before analysis that depends on current device data. Do not assume the file is already present in `~/Downloads`.
3. Import the latest Apple Health cache export with `pnpm run import:apple-health -- --from /home/willye/Downloads/cache-export.json`.
4. Run `pnpm run sync:strava` from the repo root. This repo defaults that command to sync with streams.
5. If the user asked for new analysis, identify the relevant Strava and Apple Health activities from the refreshed caches and the corresponding note by `activityRefs`, `stravaId`, date, or schedule context.
6. If the target note does not yet link the Apple Health workout, assign it before analysis by updating `activityRefs.appleHealth` directly or by using `pnpm run link:workout-source -- --note <note-slug> --provider appleHealth --activity-id <apple-health-id>`.
7. Run `pnpm run build:data` after provider imports or note or plan changes so the app reflects them.
8. Run `pnpm run typecheck` after UI or data-model changes. For note-only edits, `pnpm run build:data` is usually enough.

## Analyze and Update a Workout Note

1. Fetch the current local date and time first using Linux CLI utilities such as `date` if you have not already done so in this run.
2. Make sure `Sync and Refresh` has been completed in this run first. New analysis should use freshly imported Apple Health data and freshly synced Strava data.
3. Read the plan first in `data/training/PLAN.md` before writing analysis for a run. Treat the scheduled intent as the baseline.
4. Open the target note in `data/training/notes/`.
5. If no note exists for the run, create one using the workout note shape in `references/data-shapes.md`.
6. Before writing analysis, make sure the target note is linked to the relevant Apple Health workout when one exists for that session.
7. Keep planned intent and actual outcome separate in the JSON note document:
   - `expectedDistance` is the plan.
   - `actualDistance` is only for manual overrides.
   - `activityRefs` is the preferred provider linkage map.
   - `stravaId` remains valid for legacy linkage and back-compat.
8. Use the canonical `sections` layout that matches the run status:
   - If the run is unfinished, the note should usually contain only one `program` section.
   - If the run is completed, keep the `program` section and add an `analysis` section with typed entries for `intention`, `shortTermGoal`, `longTermGoal`, and `personalNote`.
9. For a newly completed run note, explicitly ask the user: `Would you like to add a personal note for this run?`
   - Put the user's response under `### Personal Note`.
   - If the user declines or has nothing to add, write `- None provided.`
10. In completed-run analysis, make each subsection specific:
   - `### Intention`: whether the run matched the planned purpose of the session
   - `### Short-Term Goal`: what it implies for the next few days or the current week
   - `### Long-Term Goal`: how it supports or threatens the current training block and race goals
   - `### Personal Note`: the user's own subjective note, preserved clearly
11. If the run happened on a different day than planned, state that explicitly and update the surrounding notes or plan if needed.
12. After producing or materially revising run analysis, create a changelog entry in the same pass even if the only file change is the note itself.

### Analysis Guidance

#### Use Fused Data

When producing run analysis, use the fused view of the workout rather than a single source. At minimum, combine:

- planned intent from `data/training/PLAN.md`
- the target note in `data/training/notes/`
- Apple Health summary and linked provider data in `vault/apple-health/cache-export.json`
- Strava summary data in `vault/strava/cache-export.json`
- route stream data in `public/generated/workout-routes/<stravaId>.json` when `stravaId` exists and streams are available
- surrounding week context from adjacent notes and any relevant entries in `data/training/changelog/`

Treat this fused view as the analysis input. Do not write analysis from the note body alone when richer data exists.

#### Prefer Measured Claims

Reference real calculated metrics instead of generic claims. Prefer statements like:

- actual distance versus planned distance
- moving time and elapsed time
- derived moving pace from `distanceKm` and `movingTimeSeconds`
- total elevation gain
- average and max heart rate
- weekly volume before and after the run when that affects the coaching read
- schedule drift in exact dates when the run happened on a different day than planned

Bad:

- `The session looked solid and should help fitness.`

Good:

- `The run covered 10.194 km in 3663 seconds of moving time with 110.8 m of climbing, so total volume stayed close to the planned 10 km even though the workout slipped from Tuesday, 2026-03-31, to Wednesday, 2026-04-01.`

#### Use Real Data Segments

When route streams exist, identify real segments from the stream arrays instead of inventing structure from the workout title. Use `distance`, `velocitySmooth`, `heartrate`, `altitude`, and `moving` together to locate:

- warm-up and cool-down sections
- work reps and recovery segments
- stoppages or low-movement interruptions
- late-run fade, surges, or heart-rate drift
- climbing-heavy sections when elevation changes affect the read

If the program says `3 x 8 minutes at threshold`, the analysis should verify whether the stream data actually shows three work blocks with recoveries. Cite the observed pattern and the metrics that support it. For example, if activity `17932415058` shows `10.194 km`, `3663` seconds moving time, `168.4` average heart rate, `181` max heart rate, and three distinct faster blocks separated by slower jogging, say that directly rather than writing a generic threshold summary.

#### Use All Available Data

Before finalizing analysis, check whether the repo has more evidence you can use:

- note frontmatter and markdown program
- Apple Health-linked provider ids and imported Apple Health summaries
- actual Strava-linked summary metrics
- route stream arrays
- prior and next runs in the same week
- the weekly target in `PLAN.md`
- existing changelog history that explains schedule changes or reinterpretations

If a source is unavailable, say so briefly and base the analysis on the remaining sources. If streams are unavailable, explicitly fall back to summary metrics and note that segment-level verification was not possible.

#### Section-by-Section Expectations

- `### Intention`: compare the planned session to the observed execution using measured facts, including exact date drift when relevant.
- `### Short-Term Goal`: tie the workout's real cost to the next few days using metrics such as over-distance, elevated heart rate, extra climbing, or visible late fade.
- `### Long-Term Goal`: connect the measured outcome to the current training block and race goals, using weekly volume, repeatability, and execution quality rather than vague optimism.
- `### Personal Note`: preserve the user's own words; do not replace them with inferred commentary.

Default run-note examples:

Unfinished run note:

```json
{
  "schemaVersion": 1,
  "title": "6 km Easy Recovery Run",
  "allDay": true,
  "type": "single",
  "date": "2026-04-03",
  "completed": false,
  "eventType": "run",
  "expectedDistance": "6 km",
  "sections": [
    {
      "kind": "program",
      "markdown": "- 6 km easy recovery run\n- Keep this genuinely light and unambitious.\n- Effort stays controlled so the legs feel better by the end, not worse."
    }
  ]
}
```

Completed run note:

```json
{
  "schemaVersion": 1,
  "title": "10 km Threshold Run",
  "allDay": true,
  "type": "single",
  "date": "2026-04-01",
  "completed": "2026-04-01T00:04:07Z",
  "eventType": "run",
  "expectedDistance": "10 km",
  "stravaId": 17932415058,
  "sections": [
    {
      "kind": "program",
      "markdown": "- 2 km easy warm-up\n- 3 x 8 minutes at threshold effort with 2 minutes easy jog between reps\n- Cool down easy to 10 km total"
    },
    {
      "kind": "analysis",
      "sections": [
        {
          "kind": "intention",
          "markdown": "- This was meant to bank the week's primary threshold stimulus, and the completed workout did that even though it slipped by one day.\n- The session structure showed up clearly enough in the activity data that it should count as real threshold work rather than a compromised substitute."
        },
        {
          "kind": "shortTermGoal",
          "markdown": "- The immediate job after this run is absorption, not stacking another hard day on top.\n- The next sessions should protect recovery so the week still lands with useful aerobic volume and a solid long run."
        },
        {
          "kind": "longTermGoal",
          "markdown": "- This supports the near-term threshold build, but the pacing drift still matters because smoother control is what will carry forward into the half-marathon and marathon blocks.\n- The long-term win is not just finishing sessions, but finishing them in a way that keeps the broader progression durable."
        },
        {
          "kind": "personalNote",
          "markdown": "- None provided."
        }
      ]
    }
  ]
}
```

## Create or Revise a Workout File

1. Use one JSON file per workout in `data/training/notes/`.
2. Name the file `YYYY-MM-DD Title.json`.
3. Keep the top-level fields and section kinds canonical. Use the fields documented in `references/data-shapes.md`.
4. Prefer `activityRefs` for new provider linkage, including Apple Health.
5. For unfinished workouts, default the `sections` array to a single `program` section. Do not add extra default sections unless the user explicitly asks for them.
6. For completed run notes, keep the original `program` section visible and append an `analysis` section with the four required typed entries:
   - `intention`
   - `shortTermGoal`
   - `longTermGoal`
   - `personalNote`
7. When writing completed-run analysis, anchor it in the workout's intended purpose first, then connect it to the immediate week and the larger training block.
8. If changing the weekly structure, update both:
   - `data/training/PLAN.md`
   - the affected note files in `data/training/notes/`

## Create a Changelog Entry

Create a changelog entry when the repo’s training source of truth changes in a way that matters later. Producing or materially revising run analysis counts by default, even when the only changed source file is the workout note. Other examples include:

- a workout moves to a different day
- the weekly plan is rebalanced
- a note is reinterpreted because the actual run differed materially from the plan
- the set of planned sessions changes

Do not create a changelog entry for pure wording cleanup that does not add or change the substantive analysis.

When creating an entry:

1. Add one markdown file under `data/training/changelog/`.
2. Use the file name pattern `YYYY-MM-DD-short-description.md`.
3. Set `affectedFiles` relative to `data/training`, for example:
   - `PLAN.md`
   - `WELCOME.md`
   - `notes/2026-04-01 10 km Threshold Run.md`
4. In the body, explain what changed, why it changed, and what downstream impact it has.

## Quality Bar

- Keep note titles, dates, provider linkage, and JSON section order consistent.
- Before new analysis, fetch the latest Apple Health export from Taildrop, import it, and link the relevant Apple Health workout to the note when available.
- Never blur planned versus actual distance.
- Unfinished workout notes should read like a clean prescription, not a pre-written analysis.
- Completed run notes should read like coaching analysis tied to intention, short-term goals, and long-term goals.
- Ask for a personal note when creating or updating a newly completed run note, and include it under `### Personal Note`.
- Any pass that adds or materially changes the `analysis` section should also add a changelog entry in `data/training/changelog`.
- If a workout analysis implies plan changes, update the plan files in the same pass instead of leaving them inconsistent.
- After structural data changes, regenerate app data before finishing.
- End the workflow with a git commit once the requested training-analysis changes are complete and verified.
