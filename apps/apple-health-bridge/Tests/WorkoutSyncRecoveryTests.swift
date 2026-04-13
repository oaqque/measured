import XCTest
@testable import AppleHealthBridge

final class WorkoutSyncRecoveryTests: XCTestCase {
    func testMissingPersistedWorkoutsTriggersFullBackfillAndAnchorReplay() {
        let plan = makeWorkoutSyncRecoveryPlan(
            hasPersistedWorkouts: false,
            storedAnchorExists: true
        )

        XCTAssertEqual(plan.mode, .fullBackfill)
        XCTAssertTrue(plan.shouldReplayStoredAnchorDelta)
    }

    func testPersistedWorkoutsWithAnchorUseIncrementalSync() {
        let plan = makeWorkoutSyncRecoveryPlan(
            hasPersistedWorkouts: true,
            storedAnchorExists: true
        )

        XCTAssertEqual(plan.mode, .incremental)
        XCTAssertFalse(plan.shouldReplayStoredAnchorDelta)
    }

    func testReplayedAnchorDeltaRemovesAddedIdsAndPreservesDeletedIds() {
        let result = applyReplayedWorkoutAnchorDelta(
            existingDeletedWorkoutIds: ["deleted-1", "deleted-2"],
            replayedAddedWorkoutIds: ["deleted-2", "workout-3"],
            replayedDeletedWorkoutIds: ["deleted-4"]
        )

        XCTAssertEqual(result, Set(["deleted-1", "deleted-4"]))
    }
}
