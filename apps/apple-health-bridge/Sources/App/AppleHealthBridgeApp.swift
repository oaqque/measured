import SwiftUI

@main
struct AppleHealthBridgeApp: App {
    @StateObject private var healthAuthorizationManager = HealthAuthorizationManager()
    @StateObject private var workoutSyncEngine = WorkoutSyncEngine()
    @StateObject private var routeSyncEngine = RouteSyncEngine()
    @StateObject private var healthDataSyncEngine = HealthDataSyncEngine()
    @StateObject private var exportWriter = ExportWriter()
    @StateObject private var remoteSyncManager = RemoteSyncManager()

    init() {
        AutomationDiagnosticsRecorder.recordAppLaunch()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(healthAuthorizationManager)
                .environmentObject(workoutSyncEngine)
                .environmentObject(routeSyncEngine)
                .environmentObject(healthDataSyncEngine)
                .environmentObject(exportWriter)
                .environmentObject(remoteSyncManager)
        }
    }
}
