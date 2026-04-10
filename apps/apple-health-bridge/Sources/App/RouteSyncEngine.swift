import Foundation
import CoreLocation
import HealthKit

@MainActor
final class RouteSyncEngine: ObservableObject {
    @Published private(set) var routes: [String: BridgeRoute] = [:]
    @Published private(set) var isRestoringCache = true
    @Published private(set) var isSyncing = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastSyncSummary: String?

    private let routeStore = BridgeFileStore<[String: BridgeRoute]>(filename: "routes.json")
    private let checkedWorkoutIdStore = BridgeFileStore<[String]>(filename: "route-checked-workout-ids.json")
    private var checkedWorkoutIds: Set<String>

    init() {
        checkedWorkoutIds = []
        restorePersistedState()
    }

    func syncRoutes(
        for workouts: [HKWorkout],
        changedWorkoutIds: [String],
        deletedWorkoutIds: [String],
        using healthStore: HKHealthStore
    ) async {
        isSyncing = true
        defer { isSyncing = false }
        lastError = nil
        var nextRoutes = routes
        var nextCheckedWorkoutIds = checkedWorkoutIds
        var failedWorkouts = 0

        for deletedWorkoutId in deletedWorkoutIds {
            nextRoutes.removeValue(forKey: deletedWorkoutId)
            nextCheckedWorkoutIds.remove(deletedWorkoutId)
        }

        let workoutSamplesById = Dictionary(
            uniqueKeysWithValues: workouts.map { ($0.uuid.uuidString, $0) }
        )
        let missingRouteCheckWorkoutIds = Set(workoutSamplesById.keys).subtracting(nextCheckedWorkoutIds)
        let candidateWorkoutIds = Set(changedWorkoutIds).union(missingRouteCheckWorkoutIds)

        for workoutId in candidateWorkoutIds.sorted() {
            do {
                guard let workout = try await workoutForRouteSync(
                    workoutId: workoutId,
                    cachedWorkoutsById: workoutSamplesById,
                    using: healthStore
                ) else {
                    continue
                }

                let workoutRoutes = try await healthStore.workoutRoutes(for: workout)
                guard !workoutRoutes.isEmpty else {
                    nextRoutes.removeValue(forKey: workout.uuid.uuidString)
                    nextCheckedWorkoutIds.insert(workout.uuid.uuidString)
                    continue
                }

                let orderedRouteSamples = workoutRoutes.sorted { $0.startDate < $1.startDate }
                var locations: [CLLocation] = []
                for routeSample in orderedRouteSamples {
                    locations.append(contentsOf: try await healthStore.locations(for: routeSample))
                }
                guard locations.count > 1 else {
                    nextRoutes.removeValue(forKey: workout.uuid.uuidString)
                    nextCheckedWorkoutIds.insert(workout.uuid.uuidString)
                    continue
                }

                let coordinates = locations.map {
                    CLLocationCoordinate(latitude: $0.coordinate.latitude, longitude: $0.coordinate.longitude)
                }
                let altitude = locations.map(\.altitude)
                let distance = buildDistanceSeries(from: locations)
                let velocity = buildVelocitySeries(from: locations)

                nextRoutes[workout.uuid.uuidString] = BridgeRoute(
                    activityId: workout.uuid.uuidString,
                    coordinates: coordinates,
                    altitude: altitude,
                    distance: distance,
                    velocitySmooth: velocity
                )
                nextCheckedWorkoutIds.insert(workout.uuid.uuidString)
            } catch {
                failedWorkouts += 1
                lastError = error.localizedDescription
            }
        }

        routes = nextRoutes
        checkedWorkoutIds = nextCheckedWorkoutIds
        try? routeStore.saveValue(routes)
        try? checkedWorkoutIdStore.saveValue(Array(checkedWorkoutIds).sorted())
        lastSyncSummary = buildRouteSyncSummary(
            workoutCount: candidateWorkoutIds.count,
            routeCount: nextRoutes.count,
            failedWorkoutCount: failedWorkouts
        )
    }

    private func restorePersistedState() {
        Task.detached(priority: .userInitiated) {
            let restoredRoutes = (try? BridgeFileStore<[String: BridgeRoute]>(filename: "routes.json").loadValue()) ?? [:]
            let restoredCheckedWorkoutIds = Set(
                (try? BridgeFileStore<[String]>(filename: "route-checked-workout-ids.json").loadValue()) ?? []
            )

            await MainActor.run {
                self.routes = restoredRoutes
                self.checkedWorkoutIds = restoredCheckedWorkoutIds
                self.isRestoringCache = false
            }
        }
    }
}

private func workoutForRouteSync(
    workoutId: String,
    cachedWorkoutsById: [String: HKWorkout],
    using healthStore: HKHealthStore
) async throws -> HKWorkout? {
    if let cachedWorkout = cachedWorkoutsById[workoutId] {
        return cachedWorkout
    }

    return try await healthStore.workout(withUUIDString: workoutId)
}

private func buildRouteSyncSummary(workoutCount: Int, routeCount: Int, failedWorkoutCount: Int) -> String {
    if workoutCount == 0 {
        return "No workouts available for route sync."
    }

    if routeCount == 0 && failedWorkoutCount == 0 {
        return "No workout routes were returned from HealthKit."
    }

    if failedWorkoutCount == 0 {
        return "Loaded \(routeCount) routes from \(workoutCount) workouts."
    }

    return "Loaded \(routeCount) routes from \(workoutCount) workouts. \(failedWorkoutCount) workouts failed route sync."
}

private extension HKHealthStore {
    func workout(withUUIDString workoutId: String) async throws -> HKWorkout? {
        guard let uuid = UUID(uuidString: workoutId) else {
            return nil
        }

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: HKObjectType.workoutType(),
                predicate: HKQuery.predicateForObject(with: uuid),
                limit: 1,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: samples?.first as? HKWorkout)
            }

            execute(query)
        }
    }

    func workoutRoutes(for workout: HKWorkout) async throws -> [HKWorkoutRoute] {
        try await withCheckedThrowingContinuation { continuation in
            let predicate = HKQuery.predicateForObjects(from: workout)
            let query = HKSampleQuery(
                sampleType: HKSeriesType.workoutRoute(),
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                continuation.resume(returning: (samples ?? []).compactMap { $0 as? HKWorkoutRoute })
            }

            execute(query)
        }
    }

    func locations(for workoutRoute: HKWorkoutRoute) async throws -> [CLLocation] {
        try await withCheckedThrowingContinuation { continuation in
            var collectedLocations: [CLLocation] = []
            let query = HKWorkoutRouteQuery(route: workoutRoute) { _, locations, done, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                collectedLocations.append(contentsOf: locations ?? [])
                if done {
                    continuation.resume(returning: collectedLocations)
                }
            }

            execute(query)
        }
    }
}

private func buildDistanceSeries(from locations: [CLLocation]) -> [Double] {
    var runningDistance = 0.0
    var output = [0.0]

    for index in 1..<locations.count {
        runningDistance += locations[index].distance(from: locations[index - 1])
        output.append((runningDistance * 10).rounded() / 10)
    }

    return output
}

private func buildVelocitySeries(from locations: [CLLocation]) -> [Double]? {
    var output = [0.0]
    var hasVelocity = false

    for index in 1..<locations.count {
        let deltaSeconds = locations[index].timestamp.timeIntervalSince(locations[index - 1].timestamp)
        let deltaDistance = locations[index].distance(from: locations[index - 1])
        let velocity = deltaSeconds > 0 ? deltaDistance / deltaSeconds : 0
        output.append((velocity * 1000).rounded() / 1000)
        hasVelocity = hasVelocity || velocity > 0
    }

    return hasVelocity ? output : nil
}
