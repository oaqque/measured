---
title: Correct Weekly Volume References After Split Monday Run
date: "2026-04-13"
scope: training-analysis
tags:
  - analysis
  - correction
  - weekly-volume
  - strava
affectedFiles:
  - notes/2026-04-11 4 km Easy Run.json
  - notes/2026-04-12 15 km Easy Long Run.json
  - notes/2026-04-13 7 km Easy Run.json
  - notes/2026-04-14 12 km Hill Session.json
  - changelog/2026-04-13-weekend-run-analysis-and-basketball-linkage.md
  - changelog/2026-04-13-rebalance-upcoming-week.md
---

Several recent analysis passages and follow-on changelog notes were corrected after re-checking the `2026-04-06` week against the actual run files.

The issue was not a stale provider sync. Monday, `2026-04-06`, was intentionally analyzed as one split session made from two back-to-back Strava activities totaling `12.194 km`, but some later weekly roll-up prose still referenced an older interpretation that effectively dropped that split day from the cumulative count.

The corrected week total is `65.332 km` across `6` runs for `2026-04-06` to `2026-04-12`, not `53.138 km` across `5` runs. The downstream impact is that the weekend analysis and this week's rebalance now point at the real load stack rather than understating the week that led into Monday basketball and the next quality session.
