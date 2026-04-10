---
title: Switch Primary Heart Rate Zones to LTHR
date: "2026-04-10"
scope: training-analysis
tags:
  - heart-rate
  - lthr
  - route-map
affectedFiles:
  - HEART_RATE.md
---

The heart-rate reference now names LTHR as the primary zone system rather than leaving the app on fixed absolute bpm buckets.

The route map consumes a 6-band LTHR set that matches the existing UI shape:

- `Z1 <147 bpm`
- `Z2 147-155 bpm`
- `Z3 156-163 bpm`
- `Z4 164-172 bpm`
- `Z5 173-177 bpm`
- `Z6 178+ bpm`

This keeps the route coloring simple while aligning it with the running-specific model chosen in the reference note.
