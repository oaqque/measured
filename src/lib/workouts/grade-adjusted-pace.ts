import type { WorkoutRouteStreams, WorkoutSourceSummary } from "./schema";

export const GRADE_ADJUSTED_PACE_MODEL_VERSION = "measured-gap-v1" as const;

export type GradeAdjustedPaceReliability = "high" | "medium" | "low";

export interface WorkoutGradeAdjustedPace {
  modelVersion: typeof GRADE_ADJUSTED_PACE_MODEL_VERSION;
  paceSecondsPerKm: number;
  equivalentFlatTimeSeconds: number;
  actualPaceSecondsPerKm: number;
  reliability: GradeAdjustedPaceReliability;
  distanceIncludedRatio: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
  timeScale: number;
}

interface StreamPoint {
  altitudeMeters: number;
  distanceMeters: number;
  moving: boolean;
  velocityMetersPerSecond: number;
}

const ALTITUDE_SMOOTHING_WINDOW_METERS = 80;
const FLAT_GRADE_THRESHOLD = 0.002;
const MAX_ABSOLUTE_GRADE = 0.15;
const MIN_SEGMENT_DISTANCE_METERS = 2;
const MIN_MOVING_SPEED_METERS_PER_SECOND = 0.2;

export function buildGradeAdjustedPace(
  summary: WorkoutSourceSummary,
  routeStreams: WorkoutRouteStreams | null,
): WorkoutGradeAdjustedPace | null {
  const actualDistanceKm = normalizePositiveNumber(summary.actualDistanceKm);
  const movingTimeSeconds = normalizePositiveNumber(summary.movingTimeSeconds);
  if (actualDistanceKm === null || movingTimeSeconds === null) {
    return null;
  }

  const points = buildStreamPoints(routeStreams);
  if (points.length < 2) {
    return null;
  }

  const smoothedAltitudes = smoothAltitudeByDistance(points, ALTITUDE_SMOOTHING_WINDOW_METERS);
  let rawTimeSeconds = 0;
  let equivalentFlatTimeSeconds = 0;
  let includedDistanceMeters = 0;
  let totalAscentMeters = 0;
  let totalDescentMeters = 0;
  let clippedGradeSegments = 0;
  let largeGapSegments = 0;
  let includedSegments = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) {
      continue;
    }

    const distanceDeltaMeters = current.distanceMeters - previous.distanceMeters;
    if (!Number.isFinite(distanceDeltaMeters) || distanceDeltaMeters < MIN_SEGMENT_DISTANCE_METERS) {
      continue;
    }

    const segmentMoving = previous.moving || current.moving;
    const speedSamples = [previous.velocityMetersPerSecond, current.velocityMetersPerSecond].filter(
      (speed) => speed > MIN_MOVING_SPEED_METERS_PER_SECOND,
    );
    if (!segmentMoving || speedSamples.length === 0) {
      continue;
    }

    const segmentSpeedMetersPerSecond = average(speedSamples);
    const segmentTimeSeconds = distanceDeltaMeters / segmentSpeedMetersPerSecond;
    const altitudeDeltaMeters = (smoothedAltitudes[index] ?? current.altitudeMeters) -
      (smoothedAltitudes[index - 1] ?? previous.altitudeMeters);
    const rawGrade = altitudeDeltaMeters / distanceDeltaMeters;
    const grade = Math.abs(rawGrade) < FLAT_GRADE_THRESHOLD
      ? 0
      : clamp(rawGrade, -MAX_ABSOLUTE_GRADE, MAX_ABSOLUTE_GRADE);
    if (grade !== rawGrade) {
      clippedGradeSegments += 1;
    }
    if (distanceDeltaMeters > ALTITUDE_SMOOTHING_WINDOW_METERS * 2.5) {
      largeGapSegments += 1;
    }

    if (altitudeDeltaMeters > 0) {
      totalAscentMeters += altitudeDeltaMeters;
    } else if (altitudeDeltaMeters < 0) {
      totalDescentMeters += Math.abs(altitudeDeltaMeters);
    }

    rawTimeSeconds += segmentTimeSeconds;
    equivalentFlatTimeSeconds += segmentTimeSeconds * gradeToFlatTimeFactor(grade);
    includedDistanceMeters += distanceDeltaMeters;
    includedSegments += 1;
  }

  if (rawTimeSeconds <= 0 || equivalentFlatTimeSeconds <= 0 || includedDistanceMeters <= 0) {
    return null;
  }

  const timeScale = movingTimeSeconds / rawTimeSeconds;
  const scaledEquivalentFlatTimeSeconds = equivalentFlatTimeSeconds * timeScale;
  const distanceIncludedRatio = includedDistanceMeters / (actualDistanceKm * 1000);
  const quality = {
    clippedGradeShare: includedSegments > 0 ? clippedGradeSegments / includedSegments : 1,
    distanceIncludedRatio,
    largeGapShare: includedSegments > 0 ? largeGapSegments / includedSegments : 1,
    pointCount: points.length,
    timeScale,
  };

  return {
    modelVersion: GRADE_ADJUSTED_PACE_MODEL_VERSION,
    paceSecondsPerKm: roundMetric(scaledEquivalentFlatTimeSeconds / actualDistanceKm),
    equivalentFlatTimeSeconds: roundMetric(scaledEquivalentFlatTimeSeconds),
    actualPaceSecondsPerKm: roundMetric(movingTimeSeconds / actualDistanceKm),
    reliability: classifyReliability(quality),
    distanceIncludedRatio: roundMetric(distanceIncludedRatio),
    totalAscentMeters: roundMetric(totalAscentMeters),
    totalDescentMeters: roundMetric(totalDescentMeters),
    timeScale: roundMetric(timeScale),
  };
}

function buildStreamPoints(routeStreams: WorkoutRouteStreams | null): StreamPoint[] {
  if (!routeStreams) {
    return [];
  }

  const distance = routeStreams.distance;
  const altitude = routeStreams.altitude;
  const velocitySmooth = routeStreams.velocitySmooth;
  if (!Array.isArray(distance) || !Array.isArray(altitude) || !Array.isArray(velocitySmooth)) {
    return [];
  }

  const moving = Array.isArray(routeStreams.moving) ? routeStreams.moving : null;
  const maxIndex = Math.min(distance.length, altitude.length, velocitySmooth.length);
  const points: StreamPoint[] = [];
  let previousDistanceMeters = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < maxIndex; index += 1) {
    const distanceMeters = distance[index];
    const altitudeMeters = altitude[index];
    const velocityMetersPerSecond = velocitySmooth[index];
    if (
      !Number.isFinite(distanceMeters) ||
      !Number.isFinite(altitudeMeters) ||
      !Number.isFinite(velocityMetersPerSecond)
    ) {
      continue;
    }

    if ((distanceMeters as number) < previousDistanceMeters) {
      continue;
    }

    points.push({
      altitudeMeters: altitudeMeters as number,
      distanceMeters: distanceMeters as number,
      moving: moving ? moving[index] !== false : true,
      velocityMetersPerSecond: velocityMetersPerSecond as number,
    });
    previousDistanceMeters = distanceMeters as number;
  }

  return points;
}

function smoothAltitudeByDistance(points: StreamPoint[], windowMeters: number) {
  const halfWindowMeters = windowMeters / 2;
  return points.map((point, index) => {
    let firstIndex = index;
    while (
      firstIndex > 0 &&
      point.distanceMeters - (points[firstIndex - 1]?.distanceMeters ?? point.distanceMeters) <= halfWindowMeters
    ) {
      firstIndex -= 1;
    }

    let lastIndex = index;
    while (
      lastIndex < points.length - 1 &&
      (points[lastIndex + 1]?.distanceMeters ?? point.distanceMeters) - point.distanceMeters <= halfWindowMeters
    ) {
      lastIndex += 1;
    }

    const altitudeValues: number[] = [];
    for (let currentIndex = firstIndex; currentIndex <= lastIndex; currentIndex += 1) {
      const currentPoint = points[currentIndex];
      if (currentPoint) {
        altitudeValues.push(currentPoint.altitudeMeters);
      }
    }

    return average(altitudeValues);
  });
}

function gradeToFlatTimeFactor(grade: number) {
  const gradePercent = clamp(grade, -MAX_ABSOLUTE_GRADE, MAX_ABSOLUTE_GRADE) * 100;
  if (Math.abs(gradePercent) < FLAT_GRADE_THRESHOLD * 100) {
    return 1;
  }

  if (gradePercent > 0) {
    const factor = 1 - 0.033 * gradePercent + 0.00075 * gradePercent * gradePercent;
    return clamp(factor, 0.62, 1);
  }

  const downhillPercent = Math.abs(gradePercent);
  if (downhillPercent <= 6) {
    return clamp(1 + 0.009 * downhillPercent, 1, 1.06);
  }

  return clamp(1.054 + 0.014 * (downhillPercent - 6), 1.054, 1.2);
}

function classifyReliability({
  clippedGradeShare,
  distanceIncludedRatio,
  largeGapShare,
  pointCount,
  timeScale,
}: {
  clippedGradeShare: number;
  distanceIncludedRatio: number;
  largeGapShare: number;
  pointCount: number;
  timeScale: number;
}): GradeAdjustedPaceReliability {
  if (
    pointCount >= 100 &&
    distanceIncludedRatio >= 0.95 &&
    timeScale >= 0.85 &&
    timeScale <= 1.15 &&
    clippedGradeShare <= 0.05 &&
    largeGapShare <= 0.05
  ) {
    return "high";
  }

  if (
    pointCount >= 20 &&
    distanceIncludedRatio >= 0.8 &&
    timeScale >= 0.65 &&
    timeScale <= 1.5 &&
    clippedGradeShare <= 0.2
  ) {
    return "medium";
  }

  return "low";
}

function normalizePositiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundMetric(value: number) {
  return Math.round(value * 1000) / 1000;
}
