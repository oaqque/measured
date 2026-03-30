# measured

Static workout viewer for markdown training notes.

## Setup

```bash
pnpm install
pnpm run dev
```

By default the data build looks for workout notes in `../grasp/thoughts/training/workouts`.

Override the source directory with either:

```bash
WORKOUTS_SOURCE_DIR=/absolute/path/to/workouts pnpm run dev
```

or:

```bash
pnpm run build:data -- --source /absolute/path/to/workouts
```
