import Foundation
import CoreLocation
import HealthKit

@MainActor
final class RouteSyncEngine: ObservableObject {
    @Published private(set) var routes: [String: BridgeRoute] = [:]
    @Published private(set) var isSyncing = false
    @Published private(set) var lastError: String?
    @Published private(set) var lastSyncSummary: String?

    func syncRoutes(for workouts: [HKWorkout], using healthStore: HKHealthStore) async {
        isSyncing = true
        defer { isSyncing = false }
        lastError = nil
        var nextRoutes: [String: BridgeRoute] = [:]
        var failedWorkouts = 0

        for workout in workouts {
            do {
                let workoutRoutes = try await healthStore.workoutRoutes(for: workout)
                guard !workoutRoutes.isEmpty else {
                    continue
                }

                let orderedRouteSamples = workoutRoutes.sorted { $0.startDate < $1.startDate }
                var locations: [CLLocation] = []
                for routeSample in orderedRouteSamples {
                    locations.append(contentsOf: try await healthStore.locations(for: routeSample))
                }
                guard locations.count > 1 else {
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
            } catch {
                failedWorkouts += 1
                lastError = error.localizedDescription
            }
        }

        routes = nextRoutes
        lastSyncSummary = buildRouteSyncSummary(
            workoutCount: workouts.count,
            routeCount: nextRoutes.count,
            failedWorkoutCount: failedWorkouts
        )
    }
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
