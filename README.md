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

By default the data build now reads workout notes from `data/training`.

Override the source directory with either:

```bash
WORKOUTS_SOURCE_DIR=/absolute/path/to/workouts pnpm run dev
```

or:

```bash
pnpm run build:data -- --source /absolute/path/to/workouts
```

The training data lives under [`data/training/README.md`](data/training/README.md).
