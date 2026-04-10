---
title: Backfill Run Measurement Analysis
date: "2026-04-10"
scope: training-analysis
tags:
  - analysis
  - apple-health
  - strava
  - backfill
affectedFiles:
  - notes/
  - changelog/
---

Completed run notes now include typed measurement analysis sections sourced from both Apple Health and Strava.

The backfill adds Apple Health heart-rate and cadence readouts, plus Strava pace, heart-rate, moving, and elevation sections across the existing run history. Existing narrative analysis was preserved where it already existed, while imported-only notes now gain a dedicated `analysis` section instead of keeping source metrics only in the Strava import summary.

This gives older runs the same canonical measurement coverage as newly analyzed sessions and makes the JSON note format useful for both narrative coaching interpretation and provider-specific measurement commentary.
