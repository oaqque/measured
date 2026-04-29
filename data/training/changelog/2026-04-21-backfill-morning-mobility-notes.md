---
title: Backfill Recent Morning Mobility Notes
date: "2026-04-21"
scope: workout-notes
tags:
  - workout-notes
  - mobility
  - apple-health
affectedFiles:
  - notes/2026-04-18 Morning Mobility.json
  - notes/2026-04-19 Morning Mobility.json
  - notes/2026-04-20 Morning Mobility.json
---

Backfilled the recent morning mobility sessions as authored workout notes using the current receiver-backed Apple Health snapshot from `2026-04-21T01:53:29Z`. These sessions were previously missing from `data/training/notes/` even though the watch had already recorded them.

The added notes cover local dates `2026-04-18`, `2026-04-19`, and `2026-04-20`, and each one now links directly to the matching Apple Watch workout. In the current public cache projection those workouts do not expose a clear sport-type label, but they line up as short, no-distance, low-heart-rate sessions that fit the intended daily mobility pattern you described.

Each note also links back to `MORNING_MOBILITY.md` so the authored graph can treat these sessions as part of the same mobility thread rather than as disconnected one-off entries. The downstream impact is mainly source-of-truth completeness: the recent training history now records the daily mobility habit explicitly alongside the run and basketball notes already in place.
