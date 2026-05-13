import type {
  WorkoutMeasuredGradeAdjustedPace,
  WorkoutRouteStreams,
  WorkoutSourceSummary,
  WorkoutStravaGradeAdjustedPace,
} from "./schema";

export const STRAVA_GRADE_ADJUSTED_PACE_MODEL_VERSION = "strava-gap-v1" as const;
export const MEASURED_GRADE_ADJUSTED_PACE_MODEL_VERSION = "measured-gap-v1" as const;
export const GRADE_ADJUSTED_PACE_MODEL_VERSION = STRAVA_GRADE_ADJUSTED_PACE_MODEL_VERSION;

export type GradeAdjustedPaceReliability = WorkoutMeasuredGradeAdjustedPace["reliability"];

interface StravaGradeAdjustedPacePayload {
  source?: unknown;
  splitsMetric?: unknown;
}

interface StravaMetricSplit {
  averageGradeAdjustedSpeedMetersPerSecond: number;
  distanceMeters: number;
}

interface StreamPoint {
  altitudeMeters: number;
  distanceMeters: number;
  elapsedSeconds: number | null;
  moving: boolean;
  velocityMetersPerSecond: number | null;
}

const MIN_DISTANCE_INCLUDED_RATIO = 0.9;
const ALTITUDE_SMOOTHING_WINDOW_METERS = 80;
const FLAT_GRADE_THRESHOLD = 0.002;
const MAX_ABSOLUTE_GRADE = 0.15;
const MAX_REASONABLE_RUNNING_SPEED_METERS_PER_SECOND = 8;
const MIN_SEGMENT_DISTANCE_METERS = 2;
const MIN_MOVING_SPEED_METERS_PER_SECOND = 0.2;
const UPHILL_ADJUSTMENT_SCALE = 0.88;

export function buildGradeAdjustedPace(
  summary: WorkoutSourceSummary,
  cachedGradeAdjustedPace: unknown,
): WorkoutStravaGradeAdjustedPace | null {
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
    modelVersion: STRAVA_GRADE_ADJUSTED_PACE_MODEL_VERSION,
    source: "strava",
    paceSecondsPerKm: roundMetric(paceSecondsPerKm),
    equivalentFlatTimeSeconds: roundMetric(paceSecondsPerKm * actualDistanceKm),
    actualPaceSecondsPerKm: roundMetric(movingTimeSeconds / actualDistanceKm),
    distanceIncludedRatio: roundMetric(distanceIncludedRatio),
    splitCount: splits.length,
  };
}

export function buildMeasuredGradeAdjustedPace(
  summary: WorkoutSourceSummary,
  routeStreams: WorkoutRouteStreams | null,
): WorkoutMeasuredGradeAdjustedPace | null {
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
  let timeBasedSegments = 0;

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
    if (!segmentMoving) {
      continue;
    }

    const segmentTime = getSegmentTimeSeconds(previous, current, distanceDeltaMeters);
    if (!segmentTime) {
      continue;
    }

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

    rawTimeSeconds += segmentTime.seconds;
    equivalentFlatTimeSeconds += segmentTime.seconds * gradeToFlatTimeFactor(grade);
    includedDistanceMeters += distanceDeltaMeters;
    includedSegments += 1;
    if (segmentTime.source === "time") {
      timeBasedSegments += 1;
    }
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
    actualDistanceKm,
    timeBasedSegmentShare: includedSegments > 0 ? timeBasedSegments / includedSegments : 0,
    timeScale,
  };

  return {
    modelVersion: MEASURED_GRADE_ADJUSTED_PACE_MODEL_VERSION,
    source: "measured",
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

function buildStreamPoints(routeStreams: WorkoutRouteStreams | null): StreamPoint[] {
  if (!routeStreams) {
    return [];
  }

  const distance = routeStreams.distance;
  const altitude = routeStreams.altitude;
  const velocitySmooth = routeStreams.velocitySmooth;
  const time = routeStreams.time;
  if (!Array.isArray(distance) || !Array.isArray(altitude)) {
    return [];
  }

  const moving = Array.isArray(routeStreams.moving) ? routeStreams.moving : null;
  const maxIndex = Math.min(
    distance.length,
    altitude.length,
    Array.isArray(time) ? time.length : Array.isArray(velocitySmooth) ? velocitySmooth.length : 0,
  );
  const points: StreamPoint[] = [];
  let previousDistanceMeters = Number.NEGATIVE_INFINITY;
  let previousElapsedSeconds = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < maxIndex; index += 1) {
    const distanceMeters = distance[index];
    const altitudeMeters = altitude[index];
    const rawVelocityMetersPerSecond = Array.isArray(velocitySmooth) ? velocitySmooth[index] : null;
    const rawElapsedSeconds = Array.isArray(time) ? time[index] : null;
    const velocityMetersPerSecond = Number.isFinite(rawVelocityMetersPerSecond)
      ? rawVelocityMetersPerSecond as number
      : null;
    const elapsedSeconds = Number.isFinite(rawElapsedSeconds) ? rawElapsedSeconds as number : null;
    if (
      !Number.isFinite(distanceMeters) ||
      !Number.isFinite(altitudeMeters) ||
      (velocityMetersPerSecond === null && elapsedSeconds === null)
    ) {
      continue;
    }

    if ((distanceMeters as number) < previousDistanceMeters) {
      continue;
    }

    if (elapsedSeconds !== null && elapsedSeconds < previousElapsedSeconds) {
      continue;
    }

    points.push({
      altitudeMeters: altitudeMeters as number,
      distanceMeters: distanceMeters as number,
      elapsedSeconds,
      moving: moving ? moving[index] !== false : true,
      velocityMetersPerSecond,
    });
    previousDistanceMeters = distanceMeters as number;
    if (elapsedSeconds !== null) {
      previousElapsedSeconds = elapsedSeconds;
    }
  }

  return points;
}

function getSegmentTimeSeconds(
  previous: StreamPoint,
  current: StreamPoint,
  distanceDeltaMeters: number,
): { seconds: number; source: "time" | "velocity" } | null {
  if (previous.elapsedSeconds !== null && current.elapsedSeconds !== null) {
    const elapsedDeltaSeconds = current.elapsedSeconds - previous.elapsedSeconds;
    const impliedSpeedMetersPerSecond = distanceDeltaMeters / elapsedDeltaSeconds;
    if (
      Number.isFinite(elapsedDeltaSeconds) &&
      elapsedDeltaSeconds > 0 &&
      impliedSpeedMetersPerSecond >= MIN_MOVING_SPEED_METERS_PER_SECOND &&
      impliedSpeedMetersPerSecond <= MAX_REASONABLE_RUNNING_SPEED_METERS_PER_SECOND
    ) {
      return { seconds: elapsedDeltaSeconds, source: "time" };
    }
  }

  const speedSamples = [previous.velocityMetersPerSecond, current.velocityMetersPerSecond].filter(
    (speed): speed is number =>
      typeof speed === "number" &&
      Number.isFinite(speed) &&
      speed > MIN_MOVING_SPEED_METERS_PER_SECOND,
  );
  if (speedSamples.length === 0) {
    return null;
  }

  return {
    seconds: distanceDeltaMeters / average(speedSamples),
    source: "velocity",
  };
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
    const rawFactor = 1 - 0.033 * gradePercent + 0.00075 * gradePercent * gradePercent;
    const scaledFactor = 1 - (1 - rawFactor) * UPHILL_ADJUSTMENT_SCALE;
    return clamp(scaledFactor, 0.66, 1);
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
  actualDistanceKm,
  timeBasedSegmentShare,
  timeScale,
}: {
  clippedGradeShare: number;
  distanceIncludedRatio: number;
  largeGapShare: number;
  pointCount: number;
  actualDistanceKm: number;
  timeBasedSegmentShare: number;
  timeScale: number;
}): GradeAdjustedPaceReliability {
  if (
    actualDistanceKm >= 3 &&
    pointCount >= 100 &&
    distanceIncludedRatio >= 0.97 &&
    timeBasedSegmentShare >= 0.95 &&
    timeScale >= 0.92 &&
    timeScale <= 1.08 &&
    clippedGradeShare <= 0.03 &&
    largeGapShare <= 0.03
  ) {
    return "high";
  }

  if (
    actualDistanceKm >= 2 &&
    pointCount >= 50 &&
    distanceIncludedRatio >= 0.9 &&
    timeBasedSegmentShare >= 0.6 &&
    timeScale >= 0.8 &&
    timeScale <= 1.25 &&
    clippedGradeShare <= 0.1 &&
    largeGapShare <= 0.1
  ) {
    return "medium";
  }

  return "low";
}

function normalizePositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
