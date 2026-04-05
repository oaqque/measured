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
