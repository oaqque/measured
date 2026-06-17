---
title: Analyze Race Week Runs
date: "2026-06-17"
scope: training-analysis
tags:
  - analysis
  - latest-runs
  - race-week
  - parramatta-half
  - load-management
affectedFiles:
  - PLAN.md
  - notes/2026-06-16 10 km Sharp Run.json
  - notes/2026-06-17 8 km Easy Aerobic Run.json
  - notes/2026-06-18 5 km Easy Shakeout Run.json
  - notes/2026-06-18 Strides.json
---

Analyzed the June 16 and June 17 race-week runs using the receiver-backed Apple
Health snapshot generated at `2026-06-17T03:54:42Z` and the refreshed Strava
cache generated at `2026-06-17T04:02:01Z`.

The planned June 16 `10 km` sharp run is now linked to Strava activity
`18940181088` and Apple Health workout
`1042108F-E970-4D63-9D16-313B35969FEE`. It was completed as `9.000 km` in
`50:11` moving time, with `156.8 bpm` average HR and `165 bpm` max HR. The
stream did not show a clear `6 x 400 m` structure; it is now interpreted as a
controlled aerobic-to-steady race-week run rather than a sharp-repetition
session.

The planned June 17 `8 km` easy aerobic run is now linked to Strava activity
`18950161740` and Apple Health workout
`8FD34AC8-3FA3-40F7-946B-AD8C62FDC66C`. It was completed as `10.170 km` in
`53:34` moving time, with `158.7 bpm` average HR and `181 bpm` max HR. The
middle-late `5-9 km` block averaged about `5:03 /km` at `169.1 bpm`, so the
session is treated as an over-distance progression rather than an easy support
run.

Because Monday through Wednesday already reached `26.955 km` against `24 km`
planned and Wednesday added hidden intensity four days before Parramatta, the
Thursday run was downgraded from a `10 km` steady run to a `5 km` easy
shakeout. Strides are now explicitly optional and should be skipped if race
freshness feels compromised.
