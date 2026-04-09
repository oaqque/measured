---
title: Link Apple Health Activities Across Workout Notes
date: "2026-04-09"
scope: training-analysis
tags:
  - apple-health
  - source-linking
  - data-sync
affectedFiles:
  - notes/2024-02-15 3.7 km Morning Run 07 51.md
  - notes/2025-02-12 7 km Morning Run with Jono.md
  - notes/2026-04-07 7 km Hill Repeat Run.md
  - notes/2026-04-08 8 km Easy Aerobic Run.md
---

Linked Apple Health activity references across `116` existing Strava-linked workout notes so the generated workout data can expose Apple Health summaries, routes, and provider-specific note tabs alongside the current note content.

The affected notes span completed runs from `2024-02-15` through `2026-04-08`. Each file now carries an `activityRefs.appleHealth` value next to the existing Strava linkage, preserving the note files as the source of truth for cross-provider workout matching.

One note needed manual disambiguation: `2025-02-12 7 km Morning Run with Jono.md` matched two Apple Health records at the same start time. The linked record is the third-party-app version with route streams, because it better matches the underlying run than the duplicate Strava-mirrored Health entry.
