# Apple Health Bridge

This folder scaffolds the native iPhone bridge described in
[`docs/apple-health-sync-architecture.md`](../../docs/apple-health-sync-architecture.md).

It is intentionally separate from the web app. The bridge's job is:

1. Request HealthKit read authorization.
2. Perform workout sync plus broader Apple Health reads.
3. Export a normalized `appleHealth` cache snapshot.
4. Hand that snapshot to the repo import flow.

The cache is private and can contain more Apple Health data than the web app
publishes. Publication happens later as a repo-side projection step.

## Layout

- `project.yml`: XcodeGen project definition for a minimal iOS bridge app
- `Sources/App/AppleHealthBridgeApp.swift`: app entry point
- `Sources/App/ContentView.swift`: simple sync/export UI
- `Sources/App/HealthAuthorizationManager.swift`: HealthKit permission boundary
- `Sources/App/WorkoutSyncEngine.swift`: workout summary sync
- `Sources/App/RouteSyncEngine.swift`: workout route extraction
- `Sources/App/HealthDataSyncEngine.swift`: broader Apple Health sample sync
- `Sources/App/ExportWriter.swift`: normalized snapshot writer
- `Sources/App/ExportShareController.swift`: share/export handoff

## Expected Flow

1. Generate an Xcode project from `project.yml` with XcodeGen.
2. Open the generated project in Xcode.
3. Set a signing team so the HealthKit entitlement can be provisioned on your device.
4. Build to an iPhone with Health access enabled.
5. Build an export snapshot, then use `Export with Taildrop` to open the share sheet and send `cache-export.json` and `export-manifest.json` to a device on your tailnet.
6. Import the snapshot on your machine with:

```bash
pnpm run import:apple-health -- --from /path/to/cache-export.json
```
