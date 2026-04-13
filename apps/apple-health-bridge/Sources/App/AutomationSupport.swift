import Foundation

struct AutomationLaunchConfiguration {
    let isEnabled: Bool
    let receiverURL: String?

    static var current: AutomationLaunchConfiguration {
        let environment = ProcessInfo.processInfo.environment
        let enabled = environment["MEASURED_AUTOMATION_SYNC"] == "1"
        let receiverURL = environment["MEASURED_AUTOMATION_RECEIVER_URL"]?.trimmingCharacters(in: .whitespacesAndNewlines)

        return AutomationLaunchConfiguration(
            isEnabled: enabled,
            receiverURL: receiverURL?.isEmpty == false ? receiverURL : nil
        )
    }
}

struct AutomationRunResult: Codable {
    let startedAt: Date
    let finishedAt: Date?
    let status: String
    let receiverURL: String?
    let summary: String?
    let error: String?
}

struct AutomationLaunchDiagnostics: Codable {
    let recordedAt: Date
    let automationEnabled: Bool
    let receiverURL: String?
    let environmentKeys: [String]
}

enum AutomationDiagnosticsRecorder {
    static func recordAppLaunch() {
        let configuration = AutomationLaunchConfiguration.current
        let environmentKeys = ProcessInfo.processInfo.environment.keys.sorted()
        let diagnostics = AutomationLaunchDiagnostics(
            recordedAt: Date(),
            automationEnabled: configuration.isEnabled,
            receiverURL: configuration.receiverURL,
            environmentKeys: environmentKeys.filter { $0.hasPrefix("MEASURED_") }
        )

        try? BridgeFileStore<AutomationLaunchDiagnostics>(filename: "automation-launch-diagnostics.json")
            .saveValue(diagnostics)
    }
}

extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
