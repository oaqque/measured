# Deployment

This repo now has a minimal Vercel deployment path.

The recommended workflow is:

1. Sync Strava locally.
2. Build locally on the same machine that has `vault/strava/cache-export.json`.
3. Deploy that prebuilt output to Vercel.

That remains the most reliable path for publishing freshly synced Strava-backed data.
The repo now also supports Git-triggered cloud builds better than before by allowing committed generated artifacts to act as a fallback when the local Strava cache is unavailable during the build.

## Why This Path

This app is a static Vite SPA with pathname routes:

- `/`
- `/plan`
- `/calendar`

Those routes are implemented in [`src/App.tsx`](src/App.tsx), so the host needs SPA fallback behavior.

The repo now includes:

- [`vercel.json`](vercel.json) for SPA rewrites
- `pnpm run vercel:link`
- `pnpm run deploy:vercel:preview`
- `pnpm run deploy:vercel:prod`

## First-Time Setup

### 1. Make sure the app builds locally

```bash
pnpm install
uv sync
pnpm run build
```

If you want the deployed site to include the latest Strava-backed data, refresh it first:

```bash
pnpm run sync:strava
pnpm run build
```

### 2. Log in to Vercel

Use the Vercel CLI. The scripts in this repo use `pnpm dlx vercel`, so you do not need to add Vercel as a dependency.

```bash
pnpm dlx vercel login
```

### 3. Link this repo to a Vercel project

```bash
pnpm run vercel:link
```

This creates local project metadata under `.vercel/`, which is gitignored.

For the Vercel project settings:

- Framework preset: `Vite`
- Build command: leave the Vercel default, or set `pnpm build`
- Output directory: `dist`
- Install command: leave the default, or set `pnpm install`

## Preview Deploy

Use this when you want a test deploy.

```bash
pnpm run sync:strava
pnpm run deploy:vercel:preview
```

What this does:

1. `vercel build` runs locally
2. the local build has access to your Strava cache
3. `vercel deploy --prebuilt --archive=tgz` uploads the generated output to Vercel

This is the recommended deploy path for this repo.

## Production Deploy

Use this when you want to update the main public site.

```bash
pnpm run sync:strava
pnpm run deploy:vercel:prod
```

This performs a production prebuilt deploy from your local machine.

## Verification Checklist

After deploy, verify:

1. `/` loads
2. `/plan` loads directly in a fresh tab
3. `/calendar` loads directly in a fresh tab
4. a Strava-linked workout still shows its route and Strava-backed fields

If `/plan` or `/calendar` 404, the rewrite config is missing or not applied.

## What Is Configured In Repo

### SPA routing fallback

[`vercel.json`](vercel.json) rewrites unmatched routes to `/index.html`.

That is what makes direct loads of `/plan` and `/calendar` work on Vercel.

### Local deploy scripts

In [`package.json`](package.json):

- `pnpm run vercel:link`
- `pnpm run deploy:vercel:preview`
- `pnpm run deploy:vercel:prod`

These are intentionally local-first scripts. They preserve your current data model better than a remote source build.
They also upload the prebuilt output as a `.tgz` archive, which is the path Vercel documents for reducing uploaded file count.

## Important Constraint

This repo still prefers local prebuilt deploys when you want the latest Strava sync reflected in production immediately.

Reasons:

- `build:data` reads Strava cache data from `vault/strava/cache-export.json` when it exists
- cloud builds usually do not have that cache available
- a cloud build can only preserve the last committed generated artifacts, not invent newer Strava-backed data

So if you import this repo into Vercel and let Vercel build directly from source:

- committed generated artifacts will keep existing route maps and Strava-enriched metrics available
- but newly synced Strava data will not appear until those generated artifacts are rebuilt locally and committed or deployed prebuilt

## If You Want Full Git-Triggered CI/CD Later

That needs one more design decision. Pick one:

1. Upload trusted build data during CI
2. Remove the cloud-build dependency on local Strava cache

Until then, use the local prebuilt Vercel deploy path in this document.
