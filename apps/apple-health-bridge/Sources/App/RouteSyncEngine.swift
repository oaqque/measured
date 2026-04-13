import Foundation
import CoreLocation
import HealthKit

@MainActor
final class RouteSyncEngine: ObservableObject {
    @Published private(set) var routes: [String: BridgeRoute] = [:]
    @Published private(set) var isRestoringCache = true
    @Published private(set) var isSyncing = false
    @Published private(set) var restoreProgress = BridgeProgress(
        title: "Loading cached health data…",
        detail: "Restoring routes from the bridge cache.",
        completedUnitCount: 0,
        totalUnitCount: 2
    )
    @Published private(set) var syncProgress = BridgeProgress(
        title: "Syncing health data…",
        detail: "Preparing route sync.",
        completedUnitCount: 0,
        totalUnitCount: 1
    )
    @Published private(set) var lastError: String?
    @Published private(set) var lastSyncSummary: String?

    private let routeStore = BridgeFileStore<[String: BridgeRoute]>(filename: "routes.json")
    private let routeStateStore = BridgeFileStore<[String: RouteSyncState]>(filename: "route-sync-states.json")
    private var routeSyncStates: [String: RouteSyncState]

    init() {
        routeSyncStates = [:]
        restorePersistedState()
    }

    func syncRoutes(
        for workouts: [BridgeWorkout],
        cachedWorkoutSamples: [HKWorkout],
        changedWorkoutIds: [String],
        deletedWorkoutIds: [String],
        using healthStore: HKHealthStore
    ) async {
        isSyncing = true
        syncProgress = BridgeProgress(
            title: "Syncing health data…",
            detail: "Preparing route candidates.",
            completedUnitCount: 0,
            totalUnitCount: 1
        )
        defer { isSyncing = false }
        lastError = nil
        var nextRoutes = routes
        var nextRouteSyncStates = routeSyncStates
        var failedWorkouts = 0
        let now = Date()
        let changedWorkoutIdSet = Set(changedWorkoutIds)

        for deletedWorkoutId in deletedWorkoutIds {
            nextRoutes.removeValue(forKey: deletedWorkoutId)
            nextRouteSyncStates.removeValue(forKey: deletedWorkoutId)
        }

        let workoutsById = Dictionary(
            uniqueKeysWithValues: workouts.map { ($0.id, $0) }
        )
        let cachedWorkoutSamplesById = Dictionary(
            uniqueKeysWithValues: cachedWorkoutSamples.map { ($0.uuid.uuidString, $0) }
        )
        let orderedCandidateWorkoutIds = workouts
            .filter { shouldAttemptRouteSync(for: $0, state: nextRouteSyncStates[$0.id], changedWorkoutIds: changedWorkoutIdSet, now: now) }
            .map(\.id)
        let totalCandidates = max(orderedCandidateWorkoutIds.count, 1)
        var completedCandidates = 0
        syncProgress = BridgeProgress(
            title: "Syncing health data…",
            detail: orderedCandidateWorkoutIds.isEmpty
                ? "No workouts require route sync."
                : "Loading route details for changed workouts.",
            completedUnitCount: orderedCandidateWorkoutIds.isEmpty ? 1 : 0,
            totalUnitCount: totalCandidates
        )

        for workoutId in orderedCandidateWorkoutIds {
            defer {
                completedCandidates += 1
                syncProgress = BridgeProgress(
                    title: "Syncing health data…",
                    detail: "Loading route details for changed workouts.",
                    completedUnitCount: completedCandidates,
                    totalUnitCount: totalCandidates
                )
            }

            do {
                guard let workout = try await workoutForRouteSync(
                    workoutId: workoutId,
                    cachedWorkoutsById: cachedWorkoutSamplesById,
                    using: healthStore
                ) else {
                    continue
                }

                let workoutRoutes = try await healthStore.workoutRoutes(for: workout)
                guard !workoutRoutes.isEmpty else {
                    // HealthKit route objects can appear after the workout itself,
                    // so treat an empty result as provisional and retry later.
                    nextRouteSyncStates[workout.uuid.uuidString] = provisionalRouteState(
                        previousState: nextRouteSyncStates[workout.uuid.uuidString],
                        checkedAt: now,
                        locationCount: 0
                    )
                    continue
                }

                let orderedRouteSamples = workoutRoutes.sorted { $0.startDate < $1.startDate }
                var locations: [CLLocation] = []
                for routeSample in orderedRouteSamples {
                    locations.append(contentsOf: try await healthStore.locations(for: routeSample))
                }
                guard locations.count > 1 else {
                    nextRouteSyncStates[workout.uuid.uuidString] = provisionalRouteState(
                        previousState: nextRouteSyncStates[workout.uuid.uuidString],
                        checkedAt: now,
                        locationCount: locations.count
                    )
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
                nextRouteSyncStates[workout.uuid.uuidString] = updatedRouteState(
                    previousState: nextRouteSyncStates[workout.uuid.uuidString],
                    workout: workoutsById[workout.uuid.uuidString],
                    checkedAt: now,
                    locationCount: locations.count
                )
            } catch {
                failedWorkouts += 1
                lastError = error.localizedDescription
            }
        }

        routes = nextRoutes
        routeSyncStates = nextRouteSyncStates
        try? routeStore.saveValue(routes)
        try? routeStateStore.saveValue(routeSyncStates)
        syncProgress = BridgeProgress(
            title: "Syncing health data…",
            detail: "Route sync finished.",
            completedUnitCount: syncProgress.totalUnitCount,
            totalUnitCount: syncProgress.totalUnitCount
        )
        lastSyncSummary = buildRouteSyncSummary(
            workoutCount: orderedCandidateWorkoutIds.count,
            routeCount: nextRoutes.count,
            failedWorkoutCount: failedWorkouts
        )
    }

    private func restorePersistedState() {
        Task.detached(priority: .userInitiated) {
            let restoredRoutes = (try? BridgeFileStore<[String: BridgeRoute]>(filename: "routes.json").loadValue()) ?? [:]
            await MainActor.run {
                self.restoreProgress = BridgeProgress(
                    title: "Loading cached health data…",
                    detail: "Restored routes from the bridge cache.",
                    completedUnitCount: 1,
                    totalUnitCount: 2
                )
            }
            let restoredRouteSyncStates = (try? BridgeFileStore<[String: RouteSyncState]>(filename: "route-sync-states.json").loadValue()) ?? [:]

            await MainActor.run {
                self.routes = restoredRoutes
                self.routeSyncStates = restoredRouteSyncStates
                self.restoreProgress = BridgeProgress(
                    title: "Loading cached health data…",
                    detail: "Route cache restored.",
                    completedUnitCount: 2,
                    totalUnitCount: 2
                )
                self.isRestoringCache = false
            }
        }
    }
}

struct RouteSyncState: Codable, Sendable, Equatable {
    let lastCheckedAt: Date
    let lastLocationCount: Int
    let stableRepeatCount: Int
    let isFinal: Bool
}

let routeFinalizationAge: TimeInterval = 24 * 60 * 60

func shouldAttemptRouteSync(
    for workout: BridgeWorkout,
    state: RouteSyncState?,
    changedWorkoutIds: Set<String>,
    now: Date
) -> Bool {
    if changedWorkoutIds.contains(workout.id) {
        return true
    }

    guard let state else {
        return true
    }

    if !state.isFinal {
        return true
    }

    guard let startDate = workout.startDate else {
        return false
    }

    return now.timeIntervalSince(startDate) < routeFinalizationAge
}

func provisionalRouteState(
    previousState: RouteSyncState?,
    checkedAt: Date,
    locationCount: Int
) -> RouteSyncState {
    RouteSyncState(
        lastCheckedAt: checkedAt,
        lastLocationCount: locationCount,
        stableRepeatCount: 0,
        isFinal: false
    )
}

func updatedRouteState(
    previousState: RouteSyncState?,
    workout: BridgeWorkout?,
    checkedAt: Date,
    locationCount: Int
) -> RouteSyncState {
    let repeatedLocationCount = previousState?.lastLocationCount == locationCount && locationCount > 1
    let stableRepeatCount = repeatedLocationCount ? (previousState?.stableRepeatCount ?? 0) + 1 : 0
    let isOldEnoughForFinalization: Bool
    if let startDate = workout?.startDate {
        isOldEnoughForFinalization = checkedAt.timeIntervalSince(startDate) >= routeFinalizationAge
    } else {
        isOldEnoughForFinalization = false
    }

    return RouteSyncState(
        lastCheckedAt: checkedAt,
        lastLocationCount: locationCount,
        stableRepeatCount: stableRepeatCount,
        isFinal: isOldEnoughForFinalization && stableRepeatCount > 0
    )
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
