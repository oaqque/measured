import { describe, expect, it } from "vitest";
import { buildGradeAdjustedPace } from "@/lib/workouts/grade-adjusted-pace";
import type { WorkoutRouteStreams, WorkoutSourceSummary } from "@/lib/workouts/schema";

describe("grade-adjusted pace", () => {
  it("keeps flat routes at the actual moving pace", () => {
    const result = buildGradeAdjustedPace(
      buildSummary({ distanceKm: 1, movingTimeSeconds: 300 }),
      buildStreams({
        altitude: [10, 10, 10, 10, 10],
        distance: [0, 250, 500, 750, 1000],
        velocity: [1000 / 300, 1000 / 300, 1000 / 300, 1000 / 300, 1000 / 300],
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.paceSecondsPerKm).toBeCloseTo(300, 1);
    expect(result?.actualPaceSecondsPerKm).toBeCloseTo(300, 1);
    expect(result?.reliability).toBe("low");
  });

  it("adjusts uphill running faster than raw pace", () => {
    const result = buildGradeAdjustedPace(
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

  it("adjusts downhill running slower than raw pace", () => {
    const result = buildGradeAdjustedPace(
      buildSummary({ distanceKm: 1, movingTimeSeconds: 300 }),
      buildStreams({
        altitude: [50, 37.5, 25, 12.5, 0],
        distance: [0, 250, 500, 750, 1000],
        velocity: [1000 / 300, 1000 / 300, 1000 / 300, 1000 / 300, 1000 / 300],
      }),
    );

    expect(result).not.toBeNull();
    expect(result?.paceSecondsPerKm).toBeGreaterThan(300);
  });

  it("does not let small altitude noise materially change a flat run", () => {
    const distance = Array.from({ length: 21 }, (_, index) => index * 50);
    const altitude = distance.map((_, index) => (index % 2 === 0 ? 10 : 10.4));
    const velocity = distance.map(() => 1000 / 300);
    const result = buildGradeAdjustedPace(
      buildSummary({ distanceKm: 1, movingTimeSeconds: 300 }),
      buildStreams({ altitude, distance, velocity }),
    );

    expect(result).not.toBeNull();
    expect(result?.paceSecondsPerKm).toBeGreaterThan(295);
    expect(result?.paceSecondsPerKm).toBeLessThan(305);
  });

  it("returns null when stream data is missing", () => {
    const result = buildGradeAdjustedPace(buildSummary({ distanceKm: 1, movingTimeSeconds: 300 }), null);

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

function buildStreams({
  altitude,
  distance,
  velocity,
}: {
  altitude: number[];
  distance: number[];
  velocity: number[];
}): WorkoutRouteStreams {
  return {
    altitude,
    distance,
    heartrate: null,
    latlng: null,
    moving: distance.map(() => true),
    velocitySmooth: velocity,
  };
}
