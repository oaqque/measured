---
title: Recalculate Apple Health Cadence From Full Workout Duration
date: "2026-04-10"
scope: training-analysis
tags:
  - apple-health
  - cadence
  - analysis
affectedFiles:
  - notes/
---

Apple Health cadence analysis was recalculated across the run notes after finding that the previous pipeline was averaging short step-count intervals equally instead of anchoring cadence to the full workout duration.

That inflated the reported average cadence on runs with irregular `stepCount` bucket lengths. The corrected analysis now uses total clipped steps across the workout window divided by full workout duration, which brings recent examples much closer to Apple Fitness:

- the `2026-04-10` make-up run moved from about `179 spm` to `168 spm`
- the `2026-04-08` aerobic run moved from about `172 spm` to `164 spm`

The Apple Health heart-rate chart in the app also now uses the same LTHR-based zone colors as the route map so the visual read matches the chosen primary heart-rate system.
