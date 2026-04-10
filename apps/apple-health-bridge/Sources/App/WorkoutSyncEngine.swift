import Foundation
import HealthKit

@MainActor
final class WorkoutSyncEngine: ObservableObject {
    @Published private(set) var workouts: [BridgeWorkout] = []
    @Published private(set) var deletedWorkoutIds: [String] = []
    @Published private(set) var lastChangedWorkoutIds: [String] = []
    @Published private(set) var isRestoringCache = true
    @Published private(set) var isSyncing = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastSyncSummary: String?

    private let anchorStore = PersistentHealthKitAnchorStore(anchorKey: "workout-anchor")
    private let workoutStore = BridgeFileStore<[BridgeWorkout]>(filename: "workouts.json")
    private let deletedWorkoutIdStore = BridgeFileStore<[String]>(filename: "deleted-workout-ids.json")
    private var workoutSamplesById: [String: HKWorkout] = [:]

    var workoutSamples: [HKWorkout] {
        workouts.compactMap { workoutSamplesById[$0.id] }
    }

    init() {
        restorePersistedState()
    }

    func syncWorkouts(using healthStore: HKHealthStore) async {
        isSyncing = true
        defer { isSyncing = false }

        do {
            let storedAnchor = try anchorStore.loadAnchor()
            var pendingDeletedWorkoutIds = Set(deletedWorkoutIds)
            let persistedWorkoutsById = Dictionary(uniqueKeysWithValues: workouts.map { ($0.id, $0) })
            let performedFullBackfill = persistedWorkoutsById.isEmpty || storedAnchor == nil
            var nextWorkoutsById = persistedWorkoutsById
            let additionsCount: Int
            let deletedObjects: [HKDeletedObject]
            let anchorToSave: HKQueryAnchor?

            if performedFullBackfill {
                let result = try await healthStore.anchoredWorkouts(
                    anchor: nil,
                    predicate: nil
                )

                workoutSamplesById = Dictionary(
                    uniqueKeysWithValues: result.addedWorkouts.map { ($0.uuid.uuidString, $0) }
                )
                nextWorkoutsById = Dictionary(
                    uniqueKeysWithValues: await publishedWorkouts(from: workoutSamplesById, using: healthStore).map { ($0.id, $0) }
                )
                for workout in result.addedWorkouts {
                    pendingDeletedWorkoutIds.remove(workout.uuid.uuidString)
                }
                additionsCount = result.addedWorkouts.count
                deletedObjects = []
                anchorToSave = result.newAnchor
                lastChangedWorkoutIds = Array(nextWorkoutsById.keys).sorted()
            } else {
                let result = try await healthStore.anchoredWorkouts(
                    anchor: storedAnchor,
                    predicate: nil
                )

                var changedWorkoutIds = Set<String>()
                for workout in result.addedWorkouts {
                    workoutSamplesById[workout.uuid.uuidString] = workout
                    pendingDeletedWorkoutIds.remove(workout.uuid.uuidString)
                    nextWorkoutsById[workout.uuid.uuidString] = try await publishedWorkout(from: workout, using: healthStore)
                    changedWorkoutIds.insert(workout.uuid.uuidString)
                }

                for deletedObject in result.deletedObjects {
                    workoutSamplesById.removeValue(forKey: deletedObject.uuid.uuidString)
                    nextWorkoutsById.removeValue(forKey: deletedObject.uuid.uuidString)
                    changedWorkoutIds.insert(deletedObject.uuid.uuidString)
                }

                additionsCount = result.addedWorkouts.count
                deletedObjects = result.deletedObjects
                anchorToSave = result.newAnchor
                lastChangedWorkoutIds = Array(changedWorkoutIds).sorted()
            }

            for deletedObject in deletedObjects {
                pendingDeletedWorkoutIds.insert(deletedObject.uuid.uuidString)
            }
            deletedWorkoutIds = Array(pendingDeletedWorkoutIds).sorted()
            try deletedWorkoutIdStore.saveValue(deletedWorkoutIds)
            workouts = nextWorkoutsById.values.sorted(by: {
                (($0.startDate ?? .distantPast), $0.id) > (($1.startDate ?? .distantPast), $1.id)
            })
            try workoutStore.saveValue(workouts)
            try anchorStore.saveAnchor(anchorToSave)
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

    private func restorePersistedState() {
        Task.detached(priority: .userInitiated) {
            let restoredWorkouts = (try? BridgeFileStore<[BridgeWorkout]>(filename: "workouts.json").loadValue()) ?? []
            let restoredDeletedWorkoutIds = (try? BridgeFileStore<[String]>(filename: "deleted-workout-ids.json").loadValue()) ?? []

            await MainActor.run {
                self.workouts = restoredWorkouts
                self.deletedWorkoutIds = restoredDeletedWorkoutIds
                self.isRestoringCache = false
            }
        }
    }
}

private func publishedWorkout(
    from workout: HKWorkout,
    using healthStore: HKHealthStore
) async throws -> BridgeWorkout {
    let heartRateSummary = (try? await healthStore.heartRateSummary(for: workout)) ?? HeartRateSummary()
    return BridgeWorkout(
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
}

private func publishedWorkouts(
    from samplesById: [String: HKWorkout],
    using healthStore: HKHealthStore
) async -> [BridgeWorkout] {
    var published: [BridgeWorkout] = []

    for workout in samplesById.values.sorted(by: { $0.startDate > $1.startDate }) {
        if let publishedWorkout = try? await publishedWorkout(from: workout, using: healthStore) {
            published.append(publishedWorkout)
        }
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
