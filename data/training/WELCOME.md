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

The root documents live here as [`WELCOME.md`](WELCOME.md) and [`README.md`](README.md).
Individual workout notes live under [`notes/`](notes).
