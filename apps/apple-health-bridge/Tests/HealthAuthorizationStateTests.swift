import XCTest
import HealthKit
@testable import AppleHealthBridge

final class HealthAuthorizationStateTests: XCTestCase {
    func testAuthorizationIsNotGrantedWithoutBaseStage() {
        XCTAssertEqual(
            resolveAuthorizationAccessState(completedStageKeys: [], hasPendingStage: true),
            .notGranted
        )
    }

    func testAuthorizationIsPartialWhenBaseStageCompletedButMoreStagesRemain() {
        XCTAssertEqual(
            resolveAuthorizationAccessState(completedStageKeys: ["base"], hasPendingStage: true),
            .partiallyGranted
        )
    }

    func testAuthorizationIsFullyGrantedWhenBaseStageCompletedAndNoStagesRemain() {
        XCTAssertEqual(
            resolveAuthorizationAccessState(completedStageKeys: ["base", "specialSamples"], hasPendingStage: false),
            .fullyGranted
        )
    }

    func testCombinedAuthorizationStatusPrefersShouldRequest() {
        XCTAssertEqual(
            combinedAuthorizationRequestStatus([.unnecessary, .shouldRequest]),
            .shouldRequest
        )
    }

    func testCombinedAuthorizationStatusIsUnnecessaryWhenAllIndividualStatusesAreUnnecessary() {
        XCTAssertEqual(
            combinedAuthorizationRequestStatus([.unnecessary, .unnecessary]),
            .unnecessary
        )
    }

    func testCombinedAuthorizationStatusFallsBackToUnknown() {
        XCTAssertEqual(
            combinedAuthorizationRequestStatus([.unknown, .unnecessary]),
            .unknown
        )
    }
}
