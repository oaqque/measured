# measured

hi! welcome. this is my training in a git monorepo.
join me while i work with the garage doors up.

## Setup

```bash
pnpm install
git submodule update --init --recursive
uv sync
pnpm run dev
```

By default the data build now reads training content from `data/training`.

Override the source directory with either:

```bash
WORKOUTS_SOURCE_DIR=/absolute/path/to/workouts pnpm run dev
```

or:

```bash
pnpm run build:data -- --source /absolute/path/to/workouts
```

The training data root lives under [`data/training/PLAN.md`](data/training/PLAN.md).
The welcome page source is [`data/training/WELCOME.md`](data/training/WELCOME.md), and individual workout notes live under [`data/training/notes`](data/training/notes).

Generated app data is local-only:

- `src/generated/workouts.json`
- `public/generated/workout-routes/`

Regenerate those artifacts locally with `pnpm run build:data` before running the app or deploying from a fresh clone.

## Data Attribution

This project uses or can display data from the following external sources:

- **Strava**
  Activity metadata, route geometry, streams, and images can be synced from the Strava API into the local cache under `vault/strava/`.
  Strava requires API consumers to comply with the [Strava API Agreement](https://www.strava.com/legal/api) and [Strava Brand Guidelines](https://developers.strava.com/guidelines). This repo uses Strava badges in the UI where Strava-backed workout data is shown.
  Strava’s API Agreement also says that if displayed activity data includes Garmin-sourced data, Garmin attribution may be required as well.

- **Apple Health**
  Some workout notes can be marked with `dataSource: apple-health`.
  Apple’s guidance is to refer to the app as **Apple Health** or **the Apple Health app**, and Apple notes that health data belongs to the user, not Apple.
  Sources:
  [HealthKit Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/healthkit)
  [Works with Apple Health](https://developer.apple.com/licensing-trademarks/works-with-apple-health/)

- **Open-Meteo**
  Historical weather enrichment is fetched from [Open-Meteo](https://open-meteo.com/) in `scripts/sync-strava-cache.py`.
  Open-Meteo states that API data are offered under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) and requires attribution where the data are displayed.
  Sources:
  [Open-Meteo Licence](https://open-meteo.com/en/licence)
  [Open-Meteo Pricing](https://open-meteo.com/en/pricing)

- **OpenStreetMap and CARTO**
  Route maps use CARTO basemap tiles with OpenStreetMap data in [src/components/RouteMap.tsx](src/components/RouteMap.tsx).
  The app’s map tile attribution is:
  `© OpenStreetMap contributors © CARTO`
  Sources:
  [OpenStreetMap Copyright and License](https://www.openstreetmap.org/copyright)
  [CARTO Attribution](https://carto.com/attribution)

Where this repo derives summaries or transforms source data, those derived fields remain attributable to the original data providers.
