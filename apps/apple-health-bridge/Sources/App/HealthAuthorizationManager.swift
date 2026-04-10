import Foundation
import HealthKit

private let healthKitExceptionCatcherErrorDomain = "HealthKitExceptionCatcher"

@MainActor
final class HealthAuthorizationManager: ObservableObject {
    @Published private(set) var authorizationGranted = false
    @Published private(set) var isRequestingAuthorization = false
    @Published private(set) var lastError: String?
    @Published private(set) var nextAuthorizationStageDisplayName: String?

    let healthStore = HKHealthStore()
    private let userDefaults: UserDefaults
    private let baseReadTypes: Set<HKObjectType> = [
        HKObjectType.workoutType(),
        HKSeriesType.workoutRoute(),
        HKObjectType.quantityType(forIdentifier: .heartRate)!,
    ]
    private var completedAuthorizationStageKeys: Set<String> = []
    private let completedAuthorizationStageKeysKey = "completed-authorization-stage-keys"

    init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        completedAuthorizationStageKeys = Set(userDefaults.stringArray(forKey: completedAuthorizationStageKeysKey) ?? [])
        authorizationGranted = !completedAuthorizationStageKeys.isEmpty
        AppDiagnosticsLogger.resetAuthorizationLog()
        let stages = authorizationStages()
        nextAuthorizationStageDisplayName = nextAuthorizationStage(from: stages)?.displayName
        let stageSummary = stages
            .map { "\($0.key)=\($0.readTypes.count)" }
            .joined(separator: ", ")
        AppDiagnosticsLogger.appendAuthorization(
            "Authorization manager initialized. stages=[\(stageSummary)] completed=[\(completedAuthorizationStageKeys.sorted().joined(separator: ", "))]"
        )
    }

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            authorizationGranted = false
            lastError = "Health data is unavailable on this device."
            AppDiagnosticsLogger.appendAuthorization("Health data is unavailable on this device.")
            return
        }

        guard !isRequestingAuthorization else {
            AppDiagnosticsLogger.appendAuthorization("Ignored duplicate request while authorization is already in progress.")
            return
        }

        isRequestingAuthorization = true
        defer {
            isRequestingAuthorization = false
        }

        AppDiagnosticsLogger.appendAuthorization("Authorization request started.")
        lastError = nil

        let stages = authorizationStages()
        guard let stage = nextAuthorizationStage(from: stages) else {
            nextAuthorizationStageDisplayName = nil
            authorizationGranted = !completedAuthorizationStageKeys.isEmpty
            let completed = completedAuthorizationStageKeys.sorted().joined(separator: ", ")
            AppDiagnosticsLogger.appendAuthorization("No remaining authorization stages. completed=[\(completed)]")
            return
        }

        do {
            AppDiagnosticsLogger.appendAuthorization(
                "Requesting stage '\(stage.key)' (\(stage.displayName)) with \(stage.readTypes.count) types."
            )
            let result = try await requestAuthorization(for: stage)
            completedAuthorizationStageKeys.insert(stage.key)
            persistCompletedAuthorizationStageKeys()
            nextAuthorizationStageDisplayName = nextAuthorizationStage(from: stages)?.displayName
            authorizationGranted = authorizationGranted || result.startedAnyAuthorization
            lastError = result.warningMessages.isEmpty ? nil : result.warningMessages.joined(separator: "\n")
            AppDiagnosticsLogger.appendAuthorization(
                "Stage '\(stage.key)' completed. startedAnyAuthorization=\(result.startedAnyAuthorization) warnings=\(result.warningMessages.count)"
            )
            if let nextAuthorizationStageDisplayName {
                AppDiagnosticsLogger.appendAuthorization("Next pending stage: \(nextAuthorizationStageDisplayName)")
            } else {
                AppDiagnosticsLogger.appendAuthorization("All authorization stages completed.")
            }
        } catch {
            nextAuthorizationStageDisplayName = stage.displayName
            lastError = error.localizedDescription
            AppDiagnosticsLogger.appendAuthorization(
                "Stage '\(stage.key)' failed with error: \(describe(error))"
            )
        }
    }

    private func authorizationStages() -> [HealthKitAuthorizationStage] {
        let coreStage = HealthKitAuthorizationStage(
            key: "base",
            displayName: "Workouts and Core Health Data",
            readTypes: baseReadTypes.union(HealthKitTypeRegistry.authorizationStages.first { $0.key == "core" }?.readTypes ?? [])
        )

        return [coreStage] + HealthKitTypeRegistry.authorizationStages.filter { $0.key != "core" }
    }

    private func nextAuthorizationStage(
        from stages: [HealthKitAuthorizationStage]
    ) -> HealthKitAuthorizationStage? {
        stages.first { !completedAuthorizationStageKeys.contains($0.key) }
    }

    private func requestAuthorization(
        for stage: HealthKitAuthorizationStage
    ) async throws -> AuthorizationStageResult {
        guard !stage.readTypes.isEmpty else {
            AppDiagnosticsLogger.appendAuthorization("Stage '\(stage.key)' has no readable types. Skipping.")
            return AuthorizationStageResult(startedAnyAuthorization: false, warningMessages: [])
        }

        do {
            try await healthStore.safeRequestAuthorization(toShare: [], read: stage.readTypes)
            AppDiagnosticsLogger.appendAuthorization("Stage '\(stage.key)' batch request succeeded.")
            return AuthorizationStageResult(startedAnyAuthorization: true, warningMessages: [])
        } catch {
            guard isHealthKitExceptionCatcherError(error) else {
                AppDiagnosticsLogger.appendAuthorization(
                    "Stage '\(stage.key)' batch request failed without exception fallback: \(describe(error))"
                )
                throw error
            }

            AppDiagnosticsLogger.appendAuthorization(
                "Stage '\(stage.key)' batch request threw an Objective-C exception. Falling back to per-type requests."
            )
            return try await requestAuthorizationIndividually(for: stage)
        }
    }

    private func requestAuthorizationIndividually(
        for stage: HealthKitAuthorizationStage
    ) async throws -> AuthorizationStageResult {
        var startedAnyAuthorization = false
        var warningMessages: [String] = []

        for objectType in stage.readTypes.sorted(by: { $0.identifier < $1.identifier }) {
            let readTypes = Set([objectType]).union(supplementalAuthorizationReadTypes(for: objectType))
            do {
                try await healthStore.safeRequestAuthorization(toShare: [], read: readTypes)
                startedAnyAuthorization = true
                AppDiagnosticsLogger.appendAuthorization(
                    "Individual authorization succeeded for '\(objectType.identifier)' in stage '\(stage.key)' with \(readTypes.count) requested types."
                )
            } catch {
                guard isHealthKitExceptionCatcherError(error) else {
                    AppDiagnosticsLogger.appendAuthorization(
                        "Individual authorization failed for '\(objectType.identifier)' in stage '\(stage.key)': \(describe(error))"
                    )
                    throw error
                }

                let warning = "\(objectType.identifier): \(error.localizedDescription)"
                warningMessages.append(warning)
                AppDiagnosticsLogger.appendAuthorization(
                    "Individual authorization rejected for '\(objectType.identifier)' in stage '\(stage.key)': \(describe(error))"
                )
            }
        }

        return AuthorizationStageResult(
            startedAnyAuthorization: startedAnyAuthorization,
            warningMessages: warningMessages
        )
    }

    private func persistCompletedAuthorizationStageKeys() {
        userDefaults.set(Array(completedAuthorizationStageKeys).sorted(), forKey: completedAuthorizationStageKeysKey)
    }
}

private struct AuthorizationStageResult {
    let startedAnyAuthorization: Bool
    let warningMessages: [String]
}

private func isHealthKitExceptionCatcherError(_ error: Error) -> Bool {
    let nsError = error as NSError
    return nsError.domain == healthKitExceptionCatcherErrorDomain
}

private func describe(_ error: Error) -> String {
    let nsError = error as NSError
    return "\(nsError.domain) code=\(nsError.code) \(nsError.localizedDescription)"
}

private func supplementalAuthorizationReadTypes(for objectType: HKObjectType) -> Set<HKObjectType> {
    switch objectType.identifier {
    case HKSeriesType.heartbeat().identifier:
        if let heartRateVariabilitySDNN = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) {
            return [heartRateVariabilitySDNN]
        }
        return []
    default:
        return []
    }
}

private extension HKHealthStore {
    func safeRequestAuthorization(
        toShare shareTypes: Set<HKSampleType>,
        read readTypes: Set<HKObjectType>
    ) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            do {
                try HealthKitExceptionCatcher.performRequestAuthorization(
                    with: self,
                    toShare: shareTypes,
                    read: readTypes,
                    completion: { _, error in
                        if let error {
                            continuation.resume(throwing: error)
                            return
                        }

                        continuation.resume(returning: ())
                    }
                )
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}
