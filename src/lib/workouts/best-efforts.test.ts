import { describe, expect, it } from "vitest";
import { buildWorkoutBestEffortsSummary } from "@/lib/workouts/best-efforts";

describe("best efforts", () => {
  it("finds rolling efforts inside longer runs and ignores ineligible workouts", () => {
    const summary = buildWorkoutBestEffortsSummary([
      {
        slug: "progression-long-run",
        title: "Progression Long Run",
        date: "2026-04-25",
        completed: "2026-04-25T10:00:00Z",
        eventType: "run",
        actualDistanceKm: 10,
        actualMovingTimeSeconds: null,
        actualElapsedTimeSeconds: null,
        routeStreams: {
          latlng: null,
          altitude: null,
          distance: [0, 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 8_000, 9_000, 10_000],
          heartrate: null,
          velocitySmooth: [2, 2, 4, 4, 4, 4, 4, 4, 2, 2, 2],
          moving: null,
        },
      },
      {
        slug: "even-5k",
        title: "Even 5K",
        date: "2026-04-26",
        completed: "2026-04-26T10:00:00Z",
        eventType: "run",
        actualDistanceKm: 5,
        actualMovingTimeSeconds: null,
        actualElapsedTimeSeconds: null,
        routeStreams: {
          latlng: null,
          altitude: null,
          distance: [0, 1_000, 2_000, 3_000, 4_000, 5_000],
          heartrate: null,
          velocitySmooth: [3.7, 3.7, 3.7, 3.7, 3.7, 3.7],
          moving: null,
        },
      },
      {
        slug: "strength-day",
        title: "Strength Day",
        date: "2026-04-27",
        completed: "2026-04-27T10:00:00Z",
        eventType: "strength",
        actualDistanceKm: null,
        actualMovingTimeSeconds: null,
        actualElapsedTimeSeconds: null,
        routeStreams: null,
      },
      {
        slug: "planned-race",
        title: "Planned Race",
        date: "2026-04-28",
        completed: null,
        eventType: "race",
        actualDistanceKm: null,
        actualMovingTimeSeconds: null,
        actualElapsedTimeSeconds: null,
        routeStreams: null,
      },
    ]);

    expect(summary.eligibleWorkoutCount).toBe(2);
    expect(summary.analyzedWorkoutCount).toBe(2);

    const oneHundredMeters = summary.efforts.find((effort) => effort.key === "100m");
    expect(oneHundredMeters).toMatchObject({
      workoutSlug: "progression-long-run",
      workoutTitle: "Progression Long Run",
      elapsedSeconds: 25,
    });

    const oneMile = summary.efforts.find((effort) => effort.key === "1-mile");
    expect(oneMile).toMatchObject({
      workoutSlug: "progression-long-run",
      workoutTitle: "Progression Long Run",
      elapsedSeconds: 402,
    });

    const fiveKilometers = summary.efforts.find((effort) => effort.key === "5k");
    expect(fiveKilometers).toMatchObject({
      workoutSlug: "progression-long-run",
      workoutTitle: "Progression Long Run",
      elapsedSeconds: 1250,
    });
    expect(fiveKilometers?.topEfforts).toEqual([
      expect.objectContaining({
        workoutSlug: "progression-long-run",
        elapsedSeconds: 1250,
      }),
      expect.objectContaining({
        workoutSlug: "even-5k",
      }),
    ]);
    expect(fiveKilometers?.topEfforts).toHaveLength(2);

    const tenKilometers = summary.efforts.find((effort) => effort.key === "10k");
    expect(tenKilometers).toMatchObject({
      workoutSlug: "progression-long-run",
      workoutTitle: "Progression Long Run",
      elapsedSeconds: 3417,
    });

    expect(summary.efforts.some((effort) => effort.key === "20k")).toBe(false);
  });
});
