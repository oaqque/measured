import Foundation
import HealthKit

@MainActor
final class HealthAuthorizationManager: ObservableObject {
    @Published private(set) var authorizationGranted = false
    @Published private(set) var isRequestingAuthorization = false
    @Published private(set) var lastError: String?

    let healthStore = HKHealthStore()

    private let readTypes: Set<HKObjectType> = Set([
        HKObjectType.workoutType(),
        HKSeriesType.workoutRoute(),
        HKObjectType.quantityType(forIdentifier: .heartRate)!,
    ]).union(HealthDataSyncEngine.readTypes)

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            authorizationGranted = false
            lastError = "Health data is unavailable on this device."
            return
        }

        guard !isRequestingAuthorization else {
            return
        }

        isRequestingAuthorization = true
        lastError = nil
        do {
            try await healthStore.requestAuthorization(toShare: [], read: readTypes)
            authorizationGranted = true
        } catch {
            authorizationGranted = false
            lastError = error.localizedDescription
        }
        isRequestingAuthorization = false
    }
}
