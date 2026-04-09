import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var healthAuthorizationManager: HealthAuthorizationManager
    @EnvironmentObject private var workoutSyncEngine: WorkoutSyncEngine
    @EnvironmentObject private var routeSyncEngine: RouteSyncEngine
    @EnvironmentObject private var healthDataSyncEngine: HealthDataSyncEngine
    @EnvironmentObject private var exportWriter: ExportWriter

    @State private var shareRequest: ShareRequest?

    var body: some View {
        NavigationStack {
            List {
                Section("Authorization") {
                    HStack {
                        Text("Health access")
                        Spacer()
                        Text(healthAuthorizationManager.authorizationGranted ? "Granted" : "Not granted")
                            .foregroundStyle(healthAuthorizationManager.authorizationGranted ? .green : .secondary)
                    }

                    Button(healthAuthorizationManager.isRequestingAuthorization ? "Requesting…" : "Request access") {
                        Task {
                            await healthAuthorizationManager.requestAuthorization()
                        }
                    }
                    .disabled(healthAuthorizationManager.isRequestingAuthorization)

                    if let lastError = healthAuthorizationManager.lastError {
                        Text(lastError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                Section("Sync") {
                    Button(isSyncing ? "Syncing…" : "Sync health data") {
                        Task {
                            await workoutSyncEngine.syncWorkouts(using: healthAuthorizationManager.healthStore)
                            await routeSyncEngine.syncRoutes(
                                for: workoutSyncEngine.workoutSamples,
                                using: healthAuthorizationManager.healthStore
                            )
                            await healthDataSyncEngine.syncSamples(using: healthAuthorizationManager.healthStore)
                        }
                    }
                    .disabled(isSyncing || !healthAuthorizationManager.authorizationGranted)

                    LabeledContent("Workouts", value: "\(workoutSyncEngine.workouts.count)")
                    LabeledContent("Routes", value: "\(routeSyncEngine.routes.values.filter { !$0.coordinates.isEmpty }.count)")
                    LabeledContent("Collections", value: "\(healthDataSyncEngine.collections.values.filter { !$0.samples.isEmpty }.count)")
                    LabeledContent("Samples", value: "\(healthDataSyncEngine.totalSampleCount)")

                    if let lastSyncSummary = workoutSyncEngine.lastSyncSummary {
                        Text(lastSyncSummary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let lastRouteSyncSummary = routeSyncEngine.lastSyncSummary {
                        Text(lastRouteSyncSummary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let lastSampleSyncSummary = healthDataSyncEngine.lastSyncSummary {
                        Text(lastSampleSyncSummary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let lastError = workoutSyncEngine.lastError {
                        Text(lastError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    if let lastError = routeSyncEngine.lastError {
                        Text(lastError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    if let lastError = healthDataSyncEngine.lastError {
                        Text(lastError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                Section("Export") {
                    Button(exportWriter.isExporting ? "Exporting…" : "Export with Taildrop") {
                        Task {
                            if let exportBundle = await exportWriter.writeSnapshot(
                                workouts: workoutSyncEngine.workouts,
                                routes: routeSyncEngine.routes,
                                collections: healthDataSyncEngine.collections,
                                deletedActivityIds: workoutSyncEngine.deletedWorkoutIds
                            ) {
                                shareRequest = ShareRequest.taildrop(exportBundle: exportBundle)
                            }
                        }
                    }
                    .disabled(
                        exportWriter.isExporting ||
                        (
                            workoutSyncEngine.workouts.isEmpty &&
                            healthDataSyncEngine.totalSampleCount == 0 &&
                            workoutSyncEngine.deletedWorkoutIds.isEmpty
                        )
                    )

                    if let exportBundle = exportWriter.lastExportBundle {
                        Text("The export contains the private Apple Health cache snapshot. Choose Tailscale in the share sheet and send both export files together.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Text(exportBundle.directoryURL.lastPathComponent)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    if let lastError = exportWriter.lastError {
                        Text(lastError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Apple Health Bridge")
            .sheet(item: $shareRequest) { shareRequest in
                ExportShareController(
                    activityItems: shareRequest.activityItems,
                    subject: shareRequest.subject
                )
            }
        }
    }

    private var isSyncing: Bool {
        workoutSyncEngine.isSyncing || routeSyncEngine.isSyncing || healthDataSyncEngine.isSyncing
    }
}

private struct ShareRequest: Identifiable {
    let id: String
    let activityItems: [Any]
    let subject: String

    static func taildrop(exportBundle: BridgeExportBundle) -> ShareRequest {
        ShareRequest(
            id: "taildrop:\(exportBundle.id)",
            activityItems: [exportBundle.snapshotURL, exportBundle.manifestURL],
            subject: "Apple Health Bridge export for Taildrop"
        )
    }
}
