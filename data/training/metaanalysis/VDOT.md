# VDOT

This page records the current working VDOT estimate and the measurements used to calculate it.

## Current Estimate

- Working VDOT: `42`
- Conservative race-anchored floor: `41.0`
- Current-fitness range from recent hard training: `42.0-42.7`
- Assessment date: `2026-06-15`

Read:
Use `42` as the practical training estimate right now.
The May 3 HOKA half marathon is the cleanest race input and gives `41.0`.
The June 10 hard quality run gives a stronger current-fitness signal, but because it was an embedded workout rather than a race, it should raise the working estimate without replacing the race anchor outright.

## Formula

The calculation uses the Daniels-style VDOT equations:

```text
velocity = distance in metres / time in minutes
oxygen cost = -4.60 + 0.182258 * velocity + 0.000104 * velocity^2
fraction of VO2 max = 0.8 + 0.1894393 * e^(-0.012778 * time) + 0.2989558 * e^(-0.1932605 * time)
VDOT = oxygen cost / fraction of VO2 max
```

This is a race-performance estimate, not the same thing as Apple Health VO2 max.
Apple Health VO2 max is useful context, but it is not the input to this VDOT calculation.

## Calculation Inputs

| Source | Distance | Time | Pace | VDOT | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| `2026-05-03` HOKA generated half-marathon best effort | `21.098 km` | `1:48:29` | `5:09 /km` | `41.0` | Primary race anchor from generated best efforts. |
| `2026-05-03` HOKA full Strava moving result | `21.469 km` | `1:50:24` | `5:09 /km` | `41.1` | Full moving result; Strava activity `18352213672`, Apple Health workout `960C2B4E-A317-493C-ACA5-934340AF83A3`. |
| `2026-05-03` HOKA full Strava elapsed result | `21.469 km` | `1:51:17` | `5:11 /km` | `40.7` | Includes the full elapsed race clock from the provider summary. |
| `2026-06-10` generated 10 km best effort | `10.000 km` | `48:03` | `4:48 /km` | `41.9` | Current-fitness cross-check inside a hard `18.066 km` workout. |
| `2026-06-10` generated 15 km best effort | `15.000 km` | `1:12:48` | `4:51 /km` | `42.7` | Strongest sustained current-fitness signal, but not a standalone race. |
| `2026-06-10` full moving result | `18.066 km` | `1:29:44` | `4:58 /km` | `42.2` | Strava activity `18857423112`, Apple Health workout `DFEBAA61-259D-47F0-BA2C-F786F2B1EC14`. |

## Supporting Measurements

### HOKA Runaway Sydney Half Marathon, `2026-05-03`

- Strava activity: `18352213672`
- Apple Health workout: `960C2B4E-A317-493C-ACA5-934340AF83A3`
- Actual distance: `21.469 km`
- Moving time: `1:50:24`
- Elapsed time: `1:51:17`
- Generated half-marathon best effort: `1:48:29`
- Average HR: `174.7 bpm`
- Max HR: `184 bpm`
- Grade-adjusted pace: `5:03 /km` by Strava GAP and about `5:03 /km` by measured GAP
- Measured GAP reliability: `high`
- Elevation context: measured ascent about `191.0 m`
- Weather: overcast, about `17.4 C`, `80.5%` humidity, no recorded precipitation, `7.9 kph` wind, `17.3 kph` gusts
- Shoes: `Nike Alphafly 3`

Interpretation:
This is the best clean race anchor because it was a continuous half-marathon race effort with high average HR and a strong close.
It supports a conservative VDOT of about `41`.

### June 10 Hard Quality Run, `2026-06-10` Local

- Strava activity: `18857423112`
- Apple Health workout: `DFEBAA61-259D-47F0-BA2C-F786F2B1EC14`
- Actual distance: `18.066 km`
- Moving time: `1:29:44`
- Elapsed time: `1:30:10`
- Generated 10 km best effort: `48:03`
- Generated 15 km best effort: `1:12:48`
- Average HR: `169.1 bpm`
- Max HR: `191 bpm`
- Grade-adjusted pace: `4:56 /km` by Strava GAP and about `4:56 /km` by measured GAP
- Measured GAP reliability: `medium`
- Elevation context: measured ascent about `78.6 m`
- Weather: clear, about `11.7 C`, `97%` humidity, no recorded precipitation, `4.7 kph` wind, `9.4 kph` gusts
- Shoes: `Saucony Speed 4`

Interpretation:
This run is the strongest current-fitness evidence because the `10 km`, `15 km`, and full-run VDOT values cluster between `41.9` and `42.7`.
Because it was not a race and included workout-shape pacing, it should be used as a cross-check rather than the sole anchor.

## Goal Benchmarks

| Goal | Distance | Time | Pace | Required VDOT |
| --- | ---: | ---: | ---: | ---: |
| Parramatta Half Marathon target | `21.098 km` | `1:45:00` | `4:59 /km` | `42.6` |
| Sydney Marathon target | `42.195 km` | `3:30:00` | `4:59 /km` | `44.6` |

Read:
The Parramatta `1:45:00` target is within the current workout-supported range but above the conservative race anchor.
The Sydney `3:30:00` marathon target requires a higher VDOT and, more importantly, the durability to hold roughly the same pace for twice as long.

## Update Triggers

Revise this page when one of these happens:

- a standalone race replaces the HOKA half marathon as the cleanest anchor
- Parramatta produces a new half-marathon result
- a dedicated 5 km, 10 km, or threshold test gives a cleaner current-fitness input
- Apple Health or Strava provider data materially changes the source measurements above
