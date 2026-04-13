import Foundation
import HealthKit

private let healthKitExceptionCatcherErrorDomain = "HealthKitExceptionCatcher"

@MainActor
final class HealthAuthorizationManager: ObservableObject {
    @Published private(set) var authorizationGranted = false
    @Published private(set) var baseAuthorizationGranted = false
    @Published private(set) var isRequestingAuthorization = false
    @Published private(set) var lastError: String?
    @Published private(set) var nextAuthorizationStageDisplayName: String?

    let healthStore = HKHealthStore()
    private let baseReadTypes: Set<HKObjectType> = [
        HKObjectType.workoutType(),
        HKSeriesType.workoutRoute(),
        HKObjectType.quantityType(forIdentifier: .heartRate)!,
    ]

    init() {
        AppDiagnosticsLogger.resetAuthorizationLog()
        let stages = authorizationStages()
        nextAuthorizationStageDisplayName = nextAuthorizationStage(from: stages)?.displayName
        let stageSummary = stages
            .map { "\($0.key)=\($0.readTypes.count):\(stageFingerprint(for: $0))" }
            .joined(separator: ", ")
        AppDiagnosticsLogger.appendAuthorization(
            "Authorization manager initialized. stages=[\(stageSummary)]"
        )
        Task {
            await refreshAuthorizationState()
        }
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
        let currentState = await evaluateAuthorizationState(for: stages)
        applyAuthorizationState(currentState)

        guard let stage = currentState.nextStage else {
            AppDiagnosticsLogger.appendAuthorization("No remaining authorization stages.")
            return
        }

        do {
            AppDiagnosticsLogger.appendAuthorization(
                "Requesting stage '\(stage.key)' (\(stage.displayName)) with \(stage.readTypes.count) types."
            )
            let result = try await requestAuthorization(for: stage)
            let refreshedState = await evaluateAuthorizationState(for: stages)
            applyAuthorizationState(refreshedState)
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
            let refreshedState = await evaluateAuthorizationState(for: stages)
            applyAuthorizationState(refreshedState, fallbackStage: stage)
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
        stages.first
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

    private func refreshAuthorizationState() async {
        let state = await evaluateAuthorizationState(for: authorizationStages())
        applyAuthorizationState(state)
    }

    private func evaluateAuthorizationState(
        for stages: [HealthKitAuthorizationStage]
    ) async -> AuthorizationStateSnapshot {
        var completedStageKeys: Set<String> = []
        var nextStage: HealthKitAuthorizationStage?
        var stageSummaries: [String] = []

        for stage in stages {
            let status = await authorizationRequestStatus(for: stage)
            stageSummaries.append("\(stage.key)=\(describe(status)):\(stageFingerprint(for: stage))")
            if status == .unnecessary {
                completedStageKeys.insert(stage.key)
                continue
            }

            if nextStage == nil {
                nextStage = stage
            }
        }

        AppDiagnosticsLogger.appendAuthorization(
            "Authorization state refreshed. statuses=[\(stageSummaries.joined(separator: ", "))]"
        )

        return AuthorizationStateSnapshot(
            completedStageKeys: completedStageKeys,
            nextStage: nextStage
        )
    }

    private func applyAuthorizationState(
        _ state: AuthorizationStateSnapshot,
        fallbackStage: HealthKitAuthorizationStage? = nil
    ) {
        switch resolveAuthorizationAccessState(
            completedStageKeys: state.completedStageKeys,
            hasPendingStage: state.nextStage != nil
        ) {
        case .notGranted:
            baseAuthorizationGranted = false
            authorizationGranted = false
        case .partiallyGranted:
            baseAuthorizationGranted = true
            authorizationGranted = false
        case .fullyGranted:
            baseAuthorizationGranted = true
            authorizationGranted = true
        }
        nextAuthorizationStageDisplayName = state.nextStage?.displayName ?? fallbackStage?.displayName
    }

    private func authorizationRequestStatus(
        for stage: HealthKitAuthorizationStage
    ) async -> HKAuthorizationRequestStatus {
        guard !stage.readTypes.isEmpty else {
            return .unnecessary
        }

        do {
            return try await healthStore.authorizationRequestStatus(toShare: [], read: stage.readTypes)
        } catch {
            guard isHealthKitExceptionCatcherError(error) else {
                AppDiagnosticsLogger.appendAuthorization(
                    "Unable to fetch authorization status for stage '\(stage.key)': \(describe(error))"
                )
                return .unknown
            }

            AppDiagnosticsLogger.appendAuthorization(
                "Stage '\(stage.key)' status request threw an Objective-C exception. Falling back to per-type status checks."
            )
            return await authorizationRequestStatusIndividually(for: stage)
        }
    }

    private func authorizationRequestStatusIndividually(
        for stage: HealthKitAuthorizationStage
    ) async -> HKAuthorizationRequestStatus {
        var statuses: [HKAuthorizationRequestStatus] = []

        for objectType in stage.readTypes.sorted(by: { $0.identifier < $1.identifier }) {
            let readTypes = Set([objectType]).union(supplementalAuthorizationReadTypes(for: objectType))

            do {
                let status = try await healthStore.authorizationRequestStatus(toShare: [], read: readTypes)
                statuses.append(status)
                AppDiagnosticsLogger.appendAuthorization(
                    "Individual status for '\(objectType.identifier)' in stage '\(stage.key)' returned \(describe(status)) with \(readTypes.count) requested types."
                )
            } catch {
                AppDiagnosticsLogger.appendAuthorization(
                    "Individual status failed for '\(objectType.identifier)' in stage '\(stage.key)': \(describe(error))"
                )
                statuses.append(.unknown)
            }
        }

        return combinedAuthorizationRequestStatus(statuses)
    }
}

enum HealthAuthorizationAccessState: Equatable {
    case notGranted
    case partiallyGranted
    case fullyGranted
}

func resolveAuthorizationAccessState(
    completedStageKeys: Set<String>,
    hasPendingStage: Bool
) -> HealthAuthorizationAccessState {
    guard completedStageKeys.contains("base") else {
        return .notGranted
    }

    return hasPendingStage ? .partiallyGranted : .fullyGranted
}

func combinedAuthorizationRequestStatus(
    _ statuses: [HKAuthorizationRequestStatus]
) -> HKAuthorizationRequestStatus {
    if statuses.contains(.shouldRequest) {
        return .shouldRequest
    }

    if statuses.allSatisfy({ $0 == .unnecessary }) {
        return .unnecessary
    }

    return .unknown
}

private struct AuthorizationStageResult {
    let startedAnyAuthorization: Bool
    let warningMessages: [String]
}

private struct AuthorizationStateSnapshot {
    let completedStageKeys: Set<String>
    let nextStage: HealthKitAuthorizationStage?
}

private func isHealthKitExceptionCatcherError(_ error: Error) -> Bool {
    let nsError = error as NSError
    return nsError.domain == healthKitExceptionCatcherErrorDomain
}

private func describe(_ error: Error) -> String {
    let nsError = error as NSError
    return "\(nsError.domain) code=\(nsError.code) \(nsError.localizedDescription)"
}

private func describe(_ status: HKAuthorizationRequestStatus) -> String {
    switch status {
    case .shouldRequest:
        return "shouldRequest"
    case .unnecessary:
        return "unnecessary"
    case .unknown:
        return "unknown"
    @unknown default:
        return "unknownDefault"
    }
}

private func stageFingerprint(for stage: HealthKitAuthorizationStage) -> String {
    let identifiers = stage.readTypes.map(\.identifier).sorted().joined(separator: ",")
    return String(identifiers.hashValue, radix: 16)
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

    func authorizationRequestStatus(
        toShare shareTypes: Set<HKSampleType>,
        read readTypes: Set<HKObjectType>
    ) async throws -> HKAuthorizationRequestStatus {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<HKAuthorizationRequestStatus, Error>) in
            do {
                try HealthKitExceptionCatcher.getRequestStatus(
                    with: self,
                    toShare: shareTypes,
                    read: readTypes,
                    completion: { status, error in
                        if let error {
                            continuation.resume(throwing: error)
                            return
                        }

                        continuation.resume(returning: status)
                    }
                )
            } catch {
                continuation.resume(throwing: error)
            }
        }
    }
}
