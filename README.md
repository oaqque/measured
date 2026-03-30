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

## Strava CLI

This repo includes the Strava CLI and MCP implementation as the Git submodule at
`tools/strava-mcp`.

The repo root also contains a small `uv` project that installs the `strava`
and `strava-mcp` CLIs from that submodule into this repo's local `.venv` only.

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

Run the direct Strava CLI from this repo's local environment:

```bash
uv run strava --root ./vault/strava list
uv run strava --root ./vault/strava profile
uv run strava --root ./vault/strava show <activity-id>
uv run strava --root ./vault/strava streams <activity-id> --keys heartrate watts
```

Use `--json` for raw output:

```bash
uv run strava --root ./vault/strava --json list --per-page 5
```

Strava app credentials and session state now live under `vault/strava/` in this
repo and are ignored by the parent repo.

Authorization and deeper Strava CLI/MCP usage are documented in the submodule
README at [`tools/strava-mcp/README.md`](tools/strava-mcp/README.md).
