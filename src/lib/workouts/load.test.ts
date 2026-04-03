import {
  allWorkouts,
  getAdjacentWorkouts,
  getCurrentBlockSummary,
  getWorkoutBySlug,
  trainingPlan,
} from "@/lib/workouts/load";

describe("workout data", () => {
  it("excludes training root docs from workout ingestion", () => {
    expect(allWorkouts.length).toBeGreaterThan(0);
    expect(allWorkouts.some((workout) => workout.slug === "readme")).toBe(false);
    expect(allWorkouts.some((workout) => workout.slug === "plan")).toBe(false);
    expect(trainingPlan.sourcePath).toBe("PLAN.md");
  });

  it("sorts workouts chronologically and keeps adjacent navigation stable", () => {
    const workout = getWorkoutBySlug("2026-03-29-12-km-easy-long-run");
    expect(workout?.date).toBe("2026-03-29");

    const adjacent = getAdjacentWorkouts("2026-03-30-6-km-easy-run");
    expect(adjacent.previous?.slug).toBe("2026-03-29-12-km-easy-long-run");
    expect(adjacent.next?.slug).toBe("2026-03-30-basketball");
  });

  it("derives a current block summary from the workout schedule", () => {
    const summary = getCurrentBlockSummary("2026-03-30");
    expect(summary.sessions).toBeGreaterThan(0);
    expect(summary.plannedDistanceKm).toBeGreaterThan(0);
  });
});
