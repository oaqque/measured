import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var healthAuthorizationManager: HealthAuthorizationManager
    @EnvironmentObject private var workoutSyncEngine: WorkoutSyncEngine
    @EnvironmentObject private var routeSyncEngine: RouteSyncEngine
    @EnvironmentObject private var healthDataSyncEngine: HealthDataSyncEngine
    @EnvironmentObject private var exportWriter: ExportWriter
    @EnvironmentObject private var remoteSyncManager: RemoteSyncManager

    @State private var shareRequest: ShareRequest?
    @State private var didAttemptAutomation = false

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
                                    Text(authorizationStatusLabel)
                                        .foregroundStyle(authorizationStatusColor)
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

                                if healthAuthorizationManager.baseAuthorizationGranted,
                                   !healthAuthorizationManager.authorizationGranted {
                                    Text("Core access is granted, but additional Health data stages are still required before sync/export is enabled.")
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
            .task {
                await maybeRunAutomationIfNeeded()
            }
            .task(id: isRestoringCache) {
                await maybeRunAutomationIfNeeded()
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
            Text(restoreProgress.title)
                .font(.headline)
            ProgressView(
                value: Double(restoreProgress.completedUnitCount),
                total: Double(restoreProgress.totalUnitCount)
            )
                .progressViewStyle(.linear)
                .frame(maxWidth: 260)
            Text(restoreProgress.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Text(restoreProgress.countsLabel)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var taskOverlayView: some View {
        ZStack {
            Color.black.opacity(0.18)
                .ignoresSafeArea()

            VStack(spacing: 12) {
                Text(activeTaskProgress.title)
                    .font(.headline)
                ProgressView(
                    value: Double(activeTaskProgress.completedUnitCount),
                    total: Double(activeTaskProgress.totalUnitCount)
                )
                    .progressViewStyle(.linear)
                    .frame(width: 260)
                Text(activeTaskProgress.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
                Text(activeTaskProgress.countsLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.vertical, 24)
            .padding(.horizontal, 28)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .shadow(radius: 12)
        }
    }

    private var restoreProgress: BridgeProgress {
        combinedProgress(
            [
                workoutSyncEngine.restoreProgress,
                routeSyncEngine.restoreProgress,
                healthDataSyncEngine.restoreProgress,
            ],
            title: "Loading cached health data…",
            fallbackDetail: "Restoring workouts, routes, and collections from the bridge cache before the main screen appears."
        )
    }

    private var activeTaskProgress: BridgeProgress {
        if remoteSyncManager.isSending {
            return remoteSyncManager.sendProgress
        }

        if exportWriter.isExporting {
            return exportWriter.exportProgress
        }

        return combinedProgress(
            [
                workoutSyncEngine.syncProgress,
                routeSyncEngine.syncProgress,
                healthDataSyncEngine.syncProgress,
            ],
            title: "Syncing health data…",
            fallbackDetail: "The bridge is refreshing workouts, routes, and collections. Actions are temporarily disabled until sync finishes."
        )
    }

    private func combinedProgress(
        _ progresses: [BridgeProgress],
        title: String,
        fallbackDetail: String
    ) -> BridgeProgress {
        let completed = progresses.reduce(0) { $0 + $1.completedUnitCount }
        let total = progresses.reduce(0) { $0 + $1.totalUnitCount }
        let detail = progresses.last(where: { $0.completedUnitCount < $0.totalUnitCount })?.detail
            ?? progresses.last?.detail
            ?? fallbackDetail

        return BridgeProgress(
            title: title,
            detail: detail,
            completedUnitCount: completed,
            totalUnitCount: max(total, 1)
        )
    }

    private func syncAndExport() async {
        await workoutSyncEngine.syncWorkouts(using: healthAuthorizationManager.healthStore)
        await routeSyncEngine.syncRoutes(
            for: workoutSyncEngine.workouts,
            cachedWorkoutSamples: workoutSyncEngine.workoutSamples,
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

    private func maybeRunAutomationIfNeeded() async {
        guard !didAttemptAutomation else {
            return
        }

        let configuration = AutomationLaunchConfiguration.current
        guard configuration.isEnabled else {
            return
        }

        guard !isRestoringCache else {
            return
        }

        didAttemptAutomation = true

        if let receiverURL = configuration.receiverURL {
            remoteSyncManager.receiverBaseURLString = receiverURL
        }

        let resultStore = BridgeFileStore<AutomationRunResult>(filename: "automation-run-result.json")
        let startedAt = Date()
        try? resultStore.saveValue(
            AutomationRunResult(
                startedAt: startedAt,
                finishedAt: nil,
                status: "running",
                receiverURL: remoteSyncManager.receiverBaseURLString.nilIfBlank,
                summary: nil,
                error: nil
            )
        )

        guard healthAuthorizationManager.authorizationGranted else {
            try? resultStore.saveValue(
                AutomationRunResult(
                    startedAt: startedAt,
                    finishedAt: Date(),
                    status: "blocked",
                    receiverURL: remoteSyncManager.receiverBaseURLString.nilIfBlank,
                    summary: "Health authorization is not fully granted.",
                    error: healthAuthorizationManager.lastError ?? healthAuthorizationManager.nextAuthorizationStageDisplayName
                )
            )
            return
        }

        guard remoteSyncManager.hasReceiverConfigured else {
            try? resultStore.saveValue(
                AutomationRunResult(
                    startedAt: startedAt,
                    finishedAt: Date(),
                    status: "blocked",
                    receiverURL: nil,
                    summary: nil,
                    error: "No receiver URL is configured."
                )
            )
            return
        }

        await syncAndExport()

        let error = remoteSyncManager.lastError ?? exportWriter.lastError
        let status = error == nil ? "completed" : "failed"
        try? resultStore.saveValue(
            AutomationRunResult(
                startedAt: startedAt,
                finishedAt: Date(),
                status: status,
                receiverURL: remoteSyncManager.receiverBaseURLString.nilIfBlank,
                summary: remoteSyncManager.lastSummary,
                error: error
            )
        )
    }

    private var authorizationStatusLabel: String {
        if healthAuthorizationManager.authorizationGranted {
            return "Granted"
        }

        if healthAuthorizationManager.baseAuthorizationGranted {
            return "Partially granted"
        }

        return "Not granted"
    }

    private var authorizationStatusColor: Color {
        if healthAuthorizationManager.authorizationGranted {
            return .green
        }

        if healthAuthorizationManager.baseAuthorizationGranted {
            return .orange
        }

        return .secondary
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
