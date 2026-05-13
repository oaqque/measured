import { describe, expect, it } from "vitest";
import {
  buildGradeAdjustedPace,
  buildMeasuredGradeAdjustedPace,
} from "@/lib/workouts/grade-adjusted-pace";
import type { WorkoutRouteStreams, WorkoutSourceSummary } from "@/lib/workouts/schema";

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

  it("also supports the old measured flat-route model", () => {
    const result = buildMeasuredGradeAdjustedPace(
      buildSummary({ distanceKm: 1, movingTimeSeconds: 300 }),
      buildStreams({
        altitude: [10, 10, 10, 10, 10],
        distance: [0, 250, 500, 750, 1000],
        velocity: [1000 / 300, 1000 / 300, 1000 / 300, 1000 / 300, 1000 / 300],
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.modelVersion).toBe("measured-gap-v1");
    expect(result?.source).toBe("measured");
    expect(result?.paceSecondsPerKm).toBeCloseTo(300, 1);
    expect(result?.actualPaceSecondsPerKm).toBeCloseTo(300, 1);
    expect(result?.reliability).toBe("low");
  });

  it("keeps the old measured uphill adjustment", () => {
    const result = buildMeasuredGradeAdjustedPace(
      buildSummary({ distanceKm: 1, movingTimeSeconds: 360 }),
      buildStreams({
        altitude: [0, 12.5, 25, 37.5, 50],
        distance: [0, 250, 500, 750, 1000],
        velocity: [1000 / 360, 1000 / 360, 1000 / 360, 1000 / 360, 1000 / 360],
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.paceSecondsPerKm).toBeLessThan(360);
  });

  it("weights the old measured adjustment by the time stream when it is available", () => {
    const result = buildMeasuredGradeAdjustedPace(
      buildSummary({ distanceKm: 1, movingTimeSeconds: 300 }),
      buildStreams({
        altitude: [0, 25, 25],
        distance: [0, 500, 1000],
        time: [0, 240, 300],
        velocity: [1000 / 300, 1000 / 300, 1000 / 300],
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.paceSecondsPerKm).toBeLessThan(280);
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

function buildStreams({
  altitude,
  distance,
  time,
  velocity,
}: {
  altitude: number[];
  distance: number[];
  time?: number[];
  velocity: number[];
}): WorkoutRouteStreams {
  return {
    time: time ?? null,
    altitude,
    distance,
    heartrate: null,
    latlng: null,
    moving: distance.map(() => true),
    velocitySmooth: velocity,
  };
}
