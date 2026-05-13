import type { WorkoutGradeAdjustedPace, WorkoutSourceSummary } from "./schema";

export const GRADE_ADJUSTED_PACE_MODEL_VERSION = "strava-gap-v1" as const;

interface StravaGradeAdjustedPacePayload {
  source?: unknown;
  splitsMetric?: unknown;
}

interface StravaMetricSplit {
  averageGradeAdjustedSpeedMetersPerSecond: number;
  distanceMeters: number;
}

const MIN_DISTANCE_INCLUDED_RATIO = 0.9;

export function buildGradeAdjustedPace(
  summary: WorkoutSourceSummary,
  cachedGradeAdjustedPace: unknown,
): WorkoutGradeAdjustedPace | null {
  if (summary.provider !== "strava") {
    return null;
  }

  const actualDistanceKm = normalizePositiveNumber(summary.actualDistanceKm);
  const movingTimeSeconds = normalizePositiveNumber(summary.movingTimeSeconds);
  if (actualDistanceKm === null || movingTimeSeconds === null) {
    return null;
  }

  const splits = normalizeStravaMetricSplits(cachedGradeAdjustedPace);
  if (splits.length === 0) {
    return null;
  }

  const includedDistanceMeters = splits.reduce((sum, split) => sum + split.distanceMeters, 0);
  const equivalentFlatTimeSeconds = splits.reduce(
    (sum, split) => sum + split.distanceMeters / split.averageGradeAdjustedSpeedMetersPerSecond,
    0,
  );
  if (includedDistanceMeters <= 0 || equivalentFlatTimeSeconds <= 0) {
    return null;
  }

  const actualDistanceMeters = actualDistanceKm * 1000;
  const distanceIncludedRatio = includedDistanceMeters / actualDistanceMeters;
  if (distanceIncludedRatio < MIN_DISTANCE_INCLUDED_RATIO) {
    return null;
  }

  const paceSecondsPerKm = equivalentFlatTimeSeconds / (includedDistanceMeters / 1000);
  return {
    modelVersion: GRADE_ADJUSTED_PACE_MODEL_VERSION,
    source: "strava",
    paceSecondsPerKm: roundMetric(paceSecondsPerKm),
    equivalentFlatTimeSeconds: roundMetric(paceSecondsPerKm * actualDistanceKm),
    actualPaceSecondsPerKm: roundMetric(movingTimeSeconds / actualDistanceKm),
    distanceIncludedRatio: roundMetric(distanceIncludedRatio),
    splitCount: splits.length,
  };
}

function normalizeStravaMetricSplits(value: unknown): StravaMetricSplit[] {
  if (!isPlainObject(value)) {
    return [];
  }

  const payload = value as StravaGradeAdjustedPacePayload;
  if (payload.source !== "strava" || !Array.isArray(payload.splitsMetric)) {
    return [];
  }

  return payload.splitsMetric.flatMap((candidate) => {
    if (!isPlainObject(candidate)) {
      return [];
    }

    const distanceMeters = normalizePositiveNumber(candidate.distanceMeters);
    const averageGradeAdjustedSpeedMetersPerSecond = normalizePositiveNumber(
      candidate.averageGradeAdjustedSpeedMetersPerSecond,
    );
    if (distanceMeters === null || averageGradeAdjustedSpeedMetersPerSecond === null) {
      return [];
    }

    return [{ averageGradeAdjustedSpeedMetersPerSecond, distanceMeters }];
  });
}

function normalizePositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roundMetric(value: number) {
  return Math.round(value * 1000) / 1000;
}
