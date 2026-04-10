import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var healthAuthorizationManager: HealthAuthorizationManager
    @EnvironmentObject private var workoutSyncEngine: WorkoutSyncEngine
    @EnvironmentObject private var routeSyncEngine: RouteSyncEngine
    @EnvironmentObject private var healthDataSyncEngine: HealthDataSyncEngine
    @EnvironmentObject private var exportWriter: ExportWriter
    @EnvironmentObject private var remoteSyncManager: RemoteSyncManager

    @State private var shareRequest: ShareRequest?

    var body: some View {
        NavigationStack {
            Group {
                if isRestoringCache {
                    loadingView
                } else {
                    ZStack {
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
                                .disabled(isBusy || healthAuthorizationManager.isRequestingAuthorization)

                                if let nextStage = healthAuthorizationManager.nextAuthorizationStageDisplayName {
                                    Text("Next permission group: \(nextStage)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                if let lastError = healthAuthorizationManager.lastError {
                                    Text(lastError)
                                        .font(.caption)
                                        .foregroundStyle(.red)
                                }
                            }

                            Section("Health Data") {
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

                            Section("Destination") {
                                TextField(
                                    "http://receiver.tailnet:8788",
                                    text: $remoteSyncManager.receiverBaseURLString,
                                    prompt: Text("http://receiver.tailnet:8788")
                                )
                                .textInputAutocapitalization(.never)
                                .keyboardType(.URL)
                                .autocorrectionDisabled()
                                .disabled(isBusy)

                                Text(destinationHelperText)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                if let lastSummary = remoteSyncManager.lastSummary {
                                    Text(lastSummary)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                if let lastError = remoteSyncManager.lastError {
                                    Text(lastError)
                                        .font(.caption)
                                        .foregroundStyle(.red)
                                }
                            }

                            Section("Tailscale Discovery") {
                                SecureField(
                                    "tskey-api-... or OAuth access token",
                                    text: $remoteSyncManager.tailscaleCredentialString,
                                    prompt: Text("tskey-api-... or OAuth access token")
                                )
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .disabled(isBusy || remoteSyncManager.isDiscovering)

                                Button(remoteSyncManager.isDiscovering ? "Discovering…" : "Discover receivers") {
                                    Task {
                                        await remoteSyncManager.discoverReceivers()
                                    }
                                }
                                .disabled(isBusy || remoteSyncManager.isDiscovering)

                                Text("Discovery uses the Tailscale device API, then probes eligible online macOS, Linux, and Windows devices for a receiver on port 8788.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                if let lastSummary = remoteSyncManager.lastDiscoverySummary {
                                    Text(lastSummary)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                if let lastError = remoteSyncManager.lastDiscoveryError {
                                    Text(lastError)
                                        .font(.caption)
                                        .foregroundStyle(.red)
                                }

                                ForEach(remoteSyncManager.discoveredDevices) { device in
                                    Button {
                                        if let receiverBaseURLString = device.receiverBaseURLString {
                                            remoteSyncManager.receiverBaseURLString = receiverBaseURLString
                                        }
                                    } label: {
                                        VStack(alignment: .leading, spacing: 4) {
                                            HStack {
                                                Text(device.displayName)
                                                    .font(.body)
                                                Spacer()
                                                Text(device.osName)
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                            }

                                            Text(device.availabilitySummary)
                                                .font(.caption)
                                                .foregroundStyle(device.hasReceiver ? .green : .secondary)

                                            if let receiverBaseURLString = device.receiverBaseURLString {
                                                Text(receiverBaseURLString)
                                                    .font(.caption2)
                                                    .foregroundStyle(.secondary)
                                            } else if let dnsName = device.dnsName {
                                                Text(dnsName)
                                                    .font(.caption2)
                                                    .foregroundStyle(.secondary)
                                            } else if let ipv4Address = device.ipv4Address {
                                                Text(ipv4Address)
                                                    .font(.caption2)
                                                    .foregroundStyle(.secondary)
                                            }

                                            if let receiverId = device.receiverId {
                                                Text("Receiver: \(receiverId)")
                                                    .font(.caption2)
                                                    .foregroundStyle(.secondary)
                                            }

                                            if !device.failureDetails.isEmpty {
                                                ForEach(device.failureDetails, id: \.self) { failureDetail in
                                                    Text(failureDetail)
                                                        .font(.caption2)
                                                        .foregroundStyle(.secondary)
                                                }
                                            }
                                        }
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                    }
                                    .disabled(isBusy || !device.hasReceiver)
                                }
                            }

                            Section("Export") {
                                Button(primaryActionTitle) {
                                    Task {
                                        await syncAndExport()
                                    }
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(
                                    isBusy ||
                                    !healthAuthorizationManager.authorizationGranted ||
                                    exportWriter.isExporting ||
                                    remoteSyncManager.isSending
                                )

                                Text(primaryActionDescription)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)

                                if !remoteSyncManager.hasReceiverConfigured,
                                   let exportBundle = exportWriter.lastExportBundle {
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
                        .disabled(isBusy)
                        .blur(radius: isBusy ? 1.5 : 0)

                        if isBusy {
                            taskOverlayView
                        }
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

    private var isBusy: Bool {
        isSyncing || exportWriter.isExporting || remoteSyncManager.isSending
    }

    private var isRestoringCache: Bool {
        workoutSyncEngine.isRestoringCache || routeSyncEngine.isRestoringCache || healthDataSyncEngine.isRestoringCache
    }

    private var primaryActionTitle: String {
        if remoteSyncManager.isSending {
            return "Sending…"
        }

        if exportWriter.isExporting {
            return "Exporting…"
        }

        if isSyncing {
            return "Syncing…"
        }

        return remoteSyncManager.hasReceiverConfigured
            ? "Sync and Send to Receiver"
            : "Sync and Export with Taildrop"
    }

    private var primaryActionDescription: String {
        remoteSyncManager.hasReceiverConfigured
            ? "This primary action refreshes the bridge cache, computes a delta from the current checkpoint, and sends it directly to the configured receiver over the network."
            : "This primary action refreshes the bridge cache, writes a new export bundle, and opens the share sheet automatically."
    }

    private var destinationHelperText: String {
        remoteSyncManager.hasReceiverConfigured
            ? "Direct sync is enabled. The bridge will send incremental updates to this receiver after refresh completes."
            : "Leave this empty to keep using Taildrop export files. Set a tailnet URL to send incremental updates directly to a receiver."
    }

    private var loadingView: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.large)
            Text("Loading cached health data…")
                .font(.headline)
            Text("Restoring workouts, routes, and collections from the bridge cache before the main screen appears.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var taskOverlayView: some View {
        ZStack {
            Color.black.opacity(0.18)
                .ignoresSafeArea()

            VStack(spacing: 12) {
                ProgressView()
                    .controlSize(.large)
                Text(taskOverlayTitle)
                    .font(.headline)
                Text(taskOverlayMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .padding(.vertical, 24)
            .padding(.horizontal, 28)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(radius: 12)
        }
    }

    private var taskOverlayTitle: String {
        if remoteSyncManager.isSending {
            return "Sending health data…"
        }

        if exportWriter.isExporting {
            return "Exporting health data…"
        }

        return "Syncing health data…"
    }

    private var taskOverlayMessage: String {
        if remoteSyncManager.isSending {
            return "The bridge is sending incremental updates to the configured receiver and will only advance its export checkpoint after the receiver confirms the commit."
        }

        if exportWriter.isExporting {
            return "The bridge is writing a fresh export bundle and will open the share sheet automatically when it finishes."
        }

        return "The bridge is refreshing workouts, routes, and collections. Actions are temporarily disabled until sync finishes."
    }

    private func syncAndExport() async {
        await workoutSyncEngine.syncWorkouts(using: healthAuthorizationManager.healthStore)
        await routeSyncEngine.syncRoutes(
            for: workoutSyncEngine.workoutSamples,
            changedWorkoutIds: workoutSyncEngine.lastChangedWorkoutIds,
            deletedWorkoutIds: workoutSyncEngine.deletedWorkoutIds,
            using: healthAuthorizationManager.healthStore
        )
        await healthDataSyncEngine.syncSamples(using: healthAuthorizationManager.healthStore)

        let snapshot = SnapshotExportBuilder.snapshot(
            workouts: workoutSyncEngine.workouts,
            routes: routeSyncEngine.routes,
            collections: healthDataSyncEngine.collections,
            deletedActivityIds: workoutSyncEngine.deletedWorkoutIds
        )

        if remoteSyncManager.hasReceiverConfigured {
            let didSync = await remoteSyncManager.syncSnapshot(snapshot)
            if didSync {
                shareRequest = nil
            }
            return
        }

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
