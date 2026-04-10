---
title: Add Heart Rate Reference Page
date: "2026-04-10"
scope: training-analysis
tags:
  - heart-rate
  - analysis
  - reference
affectedFiles:
  - HEART_RATE.md
---

Added a dedicated training reference page for heart-rate interpretation.

The new page captures the current working inputs from local data: observed max heart rate, recent resting heart rate, and a provisional lactate-threshold heart rate estimate. It then keeps three zone systems separate instead of collapsing them into one blended model:

- percent of max heart rate
- heart-rate reserve / Karvonen
- LTHR / Friel-style running zones

This does not change the current route-map coloring yet. The immediate goal is to make the assumptions explicit in the training source of truth so future workout analysis can compare methods cleanly.
