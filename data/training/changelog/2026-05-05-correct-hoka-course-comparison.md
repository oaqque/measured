---
title: Correct HOKA Course Comparison
date: "2026-05-05"
scope: training-analysis
tags:
  - analysis
  - half-marathon
  - race-comparison
  - route-data
affectedFiles:
  - notes/2026-05-03 HOKA Runaway Sydney Half Marathon.json
  - changelog/2026-05-05-compare-hoka-half-with-2025.md
---

Corrected the 2026 versus 2025 HOKA comparison after checking the route streams directly. The previous wording treated lower 2026 Strava-summary climbing as a kinder course, but the GPS path data does not support that.

The route streams show the same course within normal GPS tolerance: start points were `8.5 m` apart, finish points were `1.8 m` apart, nearest-path separation averaged `7.4 m`, and every sampled point was within `50 m` of the other year's path. Matching by exact distance from start looked worse because the two recordings accumulated distance differently, not because the route diverged.

The elevation difference is now recorded as a measurement discrepancy. Strava summary climbing differs (`255.8 m` in 2025 versus `189.4 m` in 2026), but matched-distance altitude traces averaged only about `0.5 m` apart, so the stronger 2026 result should be read as a real performance improvement on effectively the same course.
