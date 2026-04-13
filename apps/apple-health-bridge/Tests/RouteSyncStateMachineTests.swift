import XCTest
@testable import AppleHealthBridge

final class RouteSyncStateMachineTests: XCTestCase {
    func testRouteSyncRunsWhenStateIsMissing() {
        let workout = makeWorkout(startDate: Date(timeIntervalSince1970: 1_710_000_000))

        XCTAssertTrue(
            shouldAttemptRouteSync(
                for: workout,
                state: nil,
                changedWorkoutIds: [],
                now: workout.startDate ?? .distantPast
            )
        )
    }

    func testRouteSyncContinuesForProvisionalState() {
        let now = Date(timeIntervalSince1970: 1_710_000_000)
        let workout = makeWorkout(startDate: now.addingTimeInterval(-2 * 60 * 60))
        let state = provisionalRouteState(previousState: nil, checkedAt: now, locationCount: 1)

        XCTAssertFalse(state.isFinal)
        XCTAssertTrue(
            shouldAttemptRouteSync(
                for: workout,
                state: state,
                changedWorkoutIds: [],
                now: now
            )
        )
    }

    func testRouteStateFinalizesOnlyAfterStableRepeatForOldWorkout() {
        let now = Date(timeIntervalSince1970: 1_710_000_000)
        let workout = makeWorkout(startDate: now.addingTimeInterval(-(routeFinalizationAge + 60)))

        let first = updatedRouteState(
            previousState: nil,
            workout: workout,
            checkedAt: now,
            locationCount: 42
        )
        XCTAssertFalse(first.isFinal)

        let second = updatedRouteState(
            previousState: first,
            workout: workout,
            checkedAt: now.addingTimeInterval(60),
            locationCount: 42
        )
        XCTAssertTrue(second.isFinal)
        XCTAssertEqual(second.stableRepeatCount, 1)
    }

    func testRecentFinalStateStillGetsRecheckedWithinFinalizationWindow() {
        let now = Date(timeIntervalSince1970: 1_710_000_000)
        let workout = makeWorkout(startDate: now.addingTimeInterval(-(routeFinalizationAge / 2)))
        let state = RouteSyncState(
            lastCheckedAt: now,
            lastLocationCount: 42,
            stableRepeatCount: 2,
            isFinal: true
        )

        XCTAssertTrue(
            shouldAttemptRouteSync(
                for: workout,
                state: state,
                changedWorkoutIds: [],
                now: now
            )
        )
    }

    private func makeWorkout(startDate: Date) -> BridgeWorkout {
        BridgeWorkout(
            id: "activity-1",
            sportType: "run",
            startDate: startDate,
            distanceMeters: 5000,
            elapsedTimeSeconds: 1500,
            averageHeartrate: 145,
            maxHeartrate: 170,
            sourceName: nil,
            bundleIdentifier: nil,
            deviceName: nil,
            deviceModel: nil
        )
    }
}
