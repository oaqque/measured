import { describe, expect, it } from "vitest";
import { buildGradeAdjustedPace } from "@/lib/workouts/grade-adjusted-pace";
import type { WorkoutSourceSummary } from "@/lib/workouts/schema";

describe("grade-adjusted pace", () => {
  it("uses Strava metric split grade-adjusted speeds", () => {
    const result = buildGradeAdjustedPace(
      buildSummary({ distanceKm: 2, movingTimeSeconds: 700 }),
      {
        source: "strava",
        splitsMetric: [
          {
            averageGradeAdjustedSpeedMetersPerSecond: 4,
            distanceMeters: 1000,
            movingTimeSeconds: 300,
          },
          {
            averageGradeAdjustedSpeedMetersPerSecond: 2,
            distanceMeters: 1000,
            movingTimeSeconds: 400,
          },
        ],
      },
    );

    expect(result).toEqual({
      modelVersion: "strava-gap-v1",
      source: "strava",
      paceSecondsPerKm: 375,
      equivalentFlatTimeSeconds: 750,
      actualPaceSecondsPerKm: 350,
      distanceIncludedRatio: 1,
      splitCount: 2,
    });
  });

  it("weights split speeds by distance instead of averaging speeds", () => {
    const result = buildGradeAdjustedPace(
      buildSummary({ distanceKm: 1.5, movingTimeSeconds: 500 }),
      {
        source: "strava",
        splitsMetric: [
          {
            averageGradeAdjustedSpeedMetersPerSecond: 5,
            distanceMeters: 500,
          },
          {
            averageGradeAdjustedSpeedMetersPerSecond: 2.5,
            distanceMeters: 1000,
          },
        ],
      },
    );

    expect(result?.paceSecondsPerKm).toBeCloseTo(333.333, 3);
  });

  it("returns null when Strava GAP coverage is incomplete", () => {
    const result = buildGradeAdjustedPace(
      buildSummary({ distanceKm: 10, movingTimeSeconds: 3000 }),
      {
        source: "strava",
        splitsMetric: [
          {
            averageGradeAdjustedSpeedMetersPerSecond: 3.5,
            distanceMeters: 5000,
          },
        ],
      },
    );

    expect(result).toBeNull();
  });

  it("returns null for non-Strava sources", () => {
    const result = buildGradeAdjustedPace(
      {
        ...buildSummary({ distanceKm: 1, movingTimeSeconds: 300 }),
        provider: "appleHealth",
      },
      {
        source: "strava",
        splitsMetric: [
          {
            averageGradeAdjustedSpeedMetersPerSecond: 3.3,
            distanceMeters: 1000,
          },
        ],
      },
    );

    expect(result).toBeNull();
  });
});

function buildSummary({
  distanceKm,
  movingTimeSeconds,
}: {
  distanceKm: number;
  movingTimeSeconds: number;
}): WorkoutSourceSummary {
  return {
    activityId: "test",
    actualDistance: `${distanceKm} km`,
    actualDistanceKm: distanceKm,
    averageHeartrate: null,
    elapsedTimeSeconds: movingTimeSeconds,
    hasRouteStreams: true,
    maxHeartrate: null,
    movingTimeSeconds,
    primaryImageUrl: null,
    provider: "strava",
    routePath: "/generated/workout-routes/test.json",
    source: null,
    sportType: "Run",
    startDate: "2026-05-13T00:00:00Z",
    summaryPolyline: null,
  };
}
