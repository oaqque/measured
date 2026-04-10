import Foundation
import HealthKit

@MainActor
final class WorkoutSyncEngine: ObservableObject {
    @Published private(set) var workouts: [BridgeWorkout] = []
    @Published private(set) var deletedWorkoutIds: [String] = []
    @Published private(set) var isSyncing = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastSyncSummary: String?

    private let anchorStore = HealthKitAnchorStore(anchorKey: "workout-anchor")
    private let deletedWorkoutIdStore = StringArrayStore(arrayKey: "deleted-workout-ids")
    private var workoutSamplesById: [String: HKWorkout] = [:]

    var workoutSamples: [HKWorkout] {
        workouts.compactMap { workoutSamplesById[$0.id] }
    }

    init() {
        deletedWorkoutIds = (try? deletedWorkoutIdStore.loadValues()) ?? []
    }

    func syncWorkouts(using healthStore: HKHealthStore) async {
        isSyncing = true
        defer { isSyncing = false }

        do {
            let storedAnchor = try anchorStore.loadAnchor()
            var pendingDeletedWorkoutIds = Set(deletedWorkoutIds)
            let performedFullBackfill = workoutSamplesById.isEmpty
            let additionsCount: Int
            let deletedObjects: [HKDeletedObject]
            let anchorToSave: HKQueryAnchor?

            if performedFullBackfill {
                // Rebuild the in-memory workout cache from the current HealthKit
                // state, then apply the stored-anchor delta separately so
                // deletions that happened while the bridge was closed still
                // propagate downstream.
                let backfillResult = try await healthStore.anchoredWorkouts(
                    anchor: nil,
                    predicate: nil
                )

                workoutSamplesById = Dictionary(
                    uniqueKeysWithValues: backfillResult.addedWorkouts.map { ($0.uuid.uuidString, $0) }
                )
                for workout in backfillResult.addedWorkouts {
                    pendingDeletedWorkoutIds.remove(workout.uuid.uuidString)
                }
                additionsCount = backfillResult.addedWorkouts.count

                if let storedAnchor {
                    let deltaResult = try await healthStore.anchoredWorkouts(
                        anchor: storedAnchor,
                        predicate: nil
                    )
                    deletedObjects = deltaResult.deletedObjects
                    anchorToSave = deltaResult.newAnchor ?? backfillResult.newAnchor
                } else {
                    deletedObjects = []
                    anchorToSave = backfillResult.newAnchor
                }
            } else {
                let result = try await healthStore.anchoredWorkouts(
                    anchor: storedAnchor,
                    predicate: nil
                )

                for workout in result.addedWorkouts {
                    workoutSamplesById[workout.uuid.uuidString] = workout
                    pendingDeletedWorkoutIds.remove(workout.uuid.uuidString)
                }

                for deletedObject in result.deletedObjects {
                    workoutSamplesById.removeValue(forKey: deletedObject.uuid.uuidString)
                }

                additionsCount = result.addedWorkouts.count
                deletedObjects = result.deletedObjects
                anchorToSave = result.newAnchor
            }

            try anchorStore.saveAnchor(anchorToSave)
            for deletedObject in deletedObjects {
                pendingDeletedWorkoutIds.insert(deletedObject.uuid.uuidString)
            }
            deletedWorkoutIds = Array(pendingDeletedWorkoutIds).sorted()
            try deletedWorkoutIdStore.saveValues(deletedWorkoutIds)
            workouts = await publishedWorkouts(from: workoutSamplesById, using: healthStore)
            lastError = nil
            lastSyncSummary = buildSyncSummary(
                totalWorkoutCount: workouts.count,
                addedCount: additionsCount,
                deletedCount: deletedObjects.count,
                performedFullBackfill: performedFullBackfill
            )
        } catch {
            lastError = error.localizedDescription
            lastSyncSummary = nil
        }
    }
}

private func publishedWorkouts(
    from samplesById: [String: HKWorkout],
    using healthStore: HKHealthStore
) async -> [BridgeWorkout] {
    var published: [BridgeWorkout] = []

    for workout in samplesById.values.sorted(by: { $0.startDate > $1.startDate }) {
        let heartRateSummary = (try? await healthStore.heartRateSummary(for: workout)) ?? HeartRateSummary()
        published.append(
            BridgeWorkout(
                id: workout.uuid.uuidString,
                sportType: workout.workoutActivityType.measuredSportType,
                startDate: workout.startDate,
                distanceMeters: workout.totalDistance?.doubleValue(for: .meter()),
                elapsedTimeSeconds: Int(workout.duration.rounded()),
                averageHeartrate: heartRateSummary.averageHeartrate,
                maxHeartrate: heartRateSummary.maxHeartrate,
                sourceName: workout.sourceRevision.source.name,
                bundleIdentifier: workout.sourceRevision.source.bundleIdentifier,
                deviceName: workout.device?.name,
                deviceModel: workout.device?.model
            )
        )
    }

    return published
}

private func buildSyncSummary(
    totalWorkoutCount: Int,
    addedCount: Int,
    deletedCount: Int,
    performedFullBackfill: Bool
) -> String {
    if totalWorkoutCount == 0 {
        return performedFullBackfill
            ? "No workouts were returned from HealthKit."
            : "No new workout changes were returned from HealthKit."
    }

    if performedFullBackfill {
        return "Loaded \(totalWorkoutCount) workouts from HealthKit."
    }

    return "Applied \(addedCount) additions and \(deletedCount) deletions. \(totalWorkoutCount) workouts currently cached."
}

private extension HKHealthStore {
    func anchoredWorkouts(
        anchor: HKQueryAnchor?,
        predicate: NSPredicate?,
    ) async throws -> (addedWorkouts: [HKWorkout], deletedObjects: [HKDeletedObject], newAnchor: HKQueryAnchor?) {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(
                type: HKObjectType.workoutType(),
                predicate: predicate,
                anchor: anchor,
                limit: HKObjectQueryNoLimit
            ) { _, samples, deletedObjects, newAnchor, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(
                    returning: (
                        addedWorkouts: (samples ?? []).compactMap { $0 as? HKWorkout },
                        deletedObjects: deletedObjects ?? [],
                        newAnchor: newAnchor
                    )
                )
            }

            execute(query)
        }
    }

    func heartRateSummary(for workout: HKWorkout) async throws -> HeartRateSummary {
        guard let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate) else {
            return HeartRateSummary()
        }

        return try await withCheckedThrowingContinuation { continuation in
            let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [
                HKQuery.predicateForSamples(
                    withStart: workout.startDate,
                    end: workout.endDate,
                    options: [.strictStartDate, .strictEndDate]
                ),
                HKQuery.predicateForObjects(from: workout)
            ])

            let query = HKStatisticsQuery(
                quantityType: heartRateType,
                quantitySamplePredicate: predicate,
                options: [.discreteAverage, .discreteMax]
            ) { _, statistics, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                let unit = HKUnit.count().unitDivided(by: .minute())
                continuation.resume(
                    returning: HeartRateSummary(
                        averageHeartrate: statistics?.averageQuantity()?.doubleValue(for: unit),
                        maxHeartrate: statistics?.maximumQuantity()?.doubleValue(for: unit)
                    )
                )
            }

            execute(query)
        }
    }
}

private struct HeartRateSummary {
    let averageHeartrate: Double?
    let maxHeartrate: Double?

    init(averageHeartrate: Double? = nil, maxHeartrate: Double? = nil) {
        self.averageHeartrate = averageHeartrate
        self.maxHeartrate = maxHeartrate
    }
}

private final class HealthKitAnchorStore {
    private let anchorKey: String
    private let userDefaults: UserDefaults

    init(anchorKey: String, userDefaults: UserDefaults = .standard) {
        self.anchorKey = anchorKey
        self.userDefaults = userDefaults
    }

    func loadAnchor() throws -> HKQueryAnchor? {
        guard let data = userDefaults.data(forKey: anchorKey) else {
            return nil
        }

        return try NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    func saveAnchor(_ anchor: HKQueryAnchor?) throws {
        guard let anchor else {
            userDefaults.removeObject(forKey: anchorKey)
            return
        }

        let data = try NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true)
        userDefaults.set(data, forKey: anchorKey)
    }
}

private final class StringArrayStore {
    private let arrayKey: String
    private let userDefaults: UserDefaults

    init(arrayKey: String, userDefaults: UserDefaults = .standard) {
        self.arrayKey = arrayKey
        self.userDefaults = userDefaults
    }

    func loadValues() throws -> [String] {
        guard let values = userDefaults.array(forKey: arrayKey) else {
            return []
        }

        return values.compactMap { $0 as? String }
    }

    func saveValues(_ values: [String]) throws {
        if values.isEmpty {
            userDefaults.removeObject(forKey: arrayKey)
            return
        }

        userDefaults.set(values, forKey: arrayKey)
    }
}

private extension HKWorkoutActivityType {
    var measuredSportType: String? {
        switch self {
        case .running:
            return "run"
        case .walking:
            return "walk"
        case .hiking:
            return "hike"
        case .cycling:
            return "ride"
        default:
            return nil
        }
    }
}
