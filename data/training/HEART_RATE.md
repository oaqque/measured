# Heart Rate

This page is the working reference for personalized heart-rate zones in this repo.

The app's route map still uses fixed color buckets for now.
Those fixed buckets are useful for visual consistency, but they are not personalized.
This note keeps the personalized zone methods separate so workout analysis can compare them instead of pretending there is one perfect answer.

## Inputs

### Observed max heart rate

- Working max HR: `200 bpm`
- Source: highest observed Strava max heart rate in the local cache
- Reference activities:
  - `2025-04-18` Morning Run, Strava `14217666541`
  - `2026-02-28` Morning Run, Strava `17558780600`

This is an observed ceiling, not an age-based estimate.
If a future workout records a clean value above `200 bpm`, this page should be updated.

### Resting heart rate

- Working resting HR: `55 bpm`
- Source: Apple Health resting-heart-rate collection
- Sample window: latest `30` samples through `2026-04-09`
- Summary: average `54.83`, median `53`, range `46-73`

The latest `73 bpm` reading looks elevated relative to the rest of the month, so the practical baseline here stays at `55 bpm` rather than using the most recent single-day value.

### Estimated lactate-threshold heart rate

- Working LTHR: `173 bpm`
- Source: sustained-work estimate from the `2026-04-01` [10 km Threshold Run](notes/2026-04-01%2010%20km%20Threshold%20Run.md)

This is the least certain input on the page.
It is good enough for a working running-zone model, but it should eventually be replaced by a dedicated threshold test rather than inferred from a normal training session.

## Method 1: Percent of Max HR

Formula: `zone boundary = max HR x percentage`

Using `max HR = 200 bpm`:

| Zone | Percent of max HR | Range |
| --- | --- | --- |
| Z1 | `50-59%` | `100-119 bpm` |
| Z2 | `60-69%` | `120-139 bpm` |
| Z3 | `70-79%` | `140-159 bpm` |
| Z4 | `80-89%` | `160-179 bpm` |
| Z5 | `90-100%` | `180+ bpm` |

Read: this is the simplest method, but it treats all athletes with the same max HR as if they share the same aerobic profile.

## Method 2: Heart Rate Reserve / Karvonen

Formula: `target HR = resting HR + (% x (max HR - resting HR))`

Using `max HR = 200 bpm` and `resting HR = 55 bpm`, the reserve is `145 bpm`.

| Zone | Percent of HR reserve | Range |
| --- | --- | --- |
| Z1 | `50-59%` | `128-141 bpm` |
| Z2 | `60-69%` | `142-156 bpm` |
| Z3 | `70-79%` | `157-170 bpm` |
| Z4 | `80-89%` | `171-185 bpm` |
| Z5 | `90-100%` | `186+ bpm` |

Read: this corrects for a relatively low resting HR and usually gives a more realistic easy-zone floor than `% max HR` alone.

## Method 3: LTHR / Friel-Style Running Zones

Formula: `zone boundary = LTHR x percentage`

Using `LTHR = 173 bpm`:

| Zone | Percent of LTHR | Range |
| --- | --- | --- |
| Z1 | `<85%` | `<147 bpm` |
| Z2 | `85-89%` | `147-154 bpm` |
| Z3 | `90-94%` | `156-163 bpm` |
| Z4 | `95-99%` | `164-171 bpm` |
| Z5a | `100-102%` | `173-176 bpm` |
| Z5b | `103-106%` | `178-183 bpm` |
| Z5c | `>106%` | `185+ bpm` |

Integer rounding leaves a few transition values between bands.
Treat the edges as fuzzy rather than physiologically exact.

Read: this is the most running-specific method here because it is anchored to sustained threshold work instead of only raw max HR.

## Comparison

| Zone | % Max HR | HR Reserve | LTHR / Friel |
| --- | --- | --- | --- |
| Z1 | `100-119 bpm` | `128-141 bpm` | `<147 bpm` |
| Z2 | `120-139 bpm` | `142-156 bpm` | `147-154 bpm` |
| Z3 | `140-159 bpm` | `157-170 bpm` | `156-163 bpm` |
| Z4 | `160-179 bpm` | `171-185 bpm` | `164-171 bpm` |
| Z5 | `180+ bpm` | `186+ bpm` | split into `Z5a-Z5c` |
| Z5a | not split | not split | `173-176 bpm` |
| Z5b | not split | not split | `178-183 bpm` |
| Z5c | not split | not split | `185+ bpm` |

- `% max HR` is the coarsest method. It is easy to compute, but it usually underspecifies easy running and oversimplifies threshold work.
- `HR reserve` is a better general-purpose method when you trust resting HR and want a full-range model that adjusts for your own baseline.
- `LTHR` is the most useful method for run-workout analysis because it tracks threshold and sub-threshold work more directly than the other two methods.

## Working Recommendation

- Use `LTHR` as the primary lens for running-session analysis.
- Use `HR reserve` as a secondary check for easy and aerobic days.
- Keep `% max HR` as a rough sanity check, not the main prescription system.

## Primary App Bands

The app now consumes the LTHR model as the primary heart-rate zone system for route-map coloring.

| App zone | LTHR range |
| --- | --- |
| Z1 | `<147 bpm` |
| Z2 | `147-155 bpm` |
| Z3 | `156-163 bpm` |
| Z4 | `164-172 bpm` |
| Z5 | `173-177 bpm` |
| Z6 | `178+ bpm` |

This is a pragmatic 6-band version of the running-specific LTHR model above.
It keeps the app's existing `Z1-Z6` presentation while making the underlying bands personalized instead of fixed absolute buckets.

## Next Update Trigger

Revise this page when any of these change:

- a clearly valid workout records `>200 bpm`
- a fresh resting-HR block materially shifts away from the current `55 bpm` baseline
- a dedicated threshold test replaces the current inferred `173 bpm` estimate
