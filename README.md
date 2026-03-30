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

By default the data build looks for workout notes in `../grasp/thoughts/training/workouts`.

Override the source directory with either:

```bash
WORKOUTS_SOURCE_DIR=/absolute/path/to/workouts pnpm run dev
```

or:

```bash
pnpm run build:data -- --source /absolute/path/to/workouts
```

## Strava MCP

This repo includes the Strava MCP server as the Git submodule at
`tools/strava-mcp`.

The repo root also contains a small `uv` project that installs the `strava-mcp`
CLI from that submodule into this repo's local `.venv` only.

For fresh clones, initialize the submodule first:

```bash
git submodule update --init --recursive
```

To update the bundled server to the latest `main` commit:

```bash
git submodule update --remote tools/strava-mcp
```

Install or refresh the local Strava CLI after submodule updates:

```bash
uv sync
```

Run the server from this repo's local CLI install:

```bash
uv run strava-mcp --root ./vault/strava serve
```

One-time Strava auth is handled through the same local CLI install:

```bash
uv run strava-mcp --root ./vault/strava authorize start --launch-browser
uv run strava-mcp --root ./vault/strava authorize complete --state '<state-from-start>'
```

Strava app credentials and session state now live under `vault/strava/` in this
repo and are ignored by the parent repo.
