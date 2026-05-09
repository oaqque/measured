import type {
  WorkoutBestEffortEntry,
  WorkoutBestEffortsSummary,
  WorkoutEventType,
  WorkoutRouteStreams,
} from "./schema";

export interface WorkoutBestEffortInput {
  slug: string;
  title: string;
  date: string;
  completed: string | null;
  eventType: WorkoutEventType;
  actualDistanceKm: number | null;
  actualMovingTimeSeconds: number | null;
  actualElapsedTimeSeconds: number | null;
  routeStreams: WorkoutRouteStreams | null;
}

interface BestEffortTarget {
  key: string;
  label: string;
  distanceMeters: number;
}

interface DistanceTimePoint {
  distanceMeters: number;
  elapsedSeconds: number;
}

const ELIGIBLE_EVENT_TYPES = new Set<WorkoutEventType>(["run", "race"]);

const BEST_EFFORT_TARGETS: BestEffortTarget[] = [
  { key: "100m", label: "100 m", distanceMeters: 100 },
  { key: "200m", label: "200 m", distanceMeters: 200 },
  { key: "400m", label: "400 m", distanceMeters: 400 },
  { key: "1k", label: "1 km", distanceMeters: 1_000 },
  { key: "1-mile", label: "1 Mile", distanceMeters: 1_609.344 },
  { key: "3k", label: "3 km", distanceMeters: 3_000 },
  { key: "5k", label: "5 km", distanceMeters: 5_000 },
  { key: "10k", label: "10 km", distanceMeters: 10_000 },
  { key: "15k", label: "15 km", distanceMeters: 15_000 },
  { key: "20k", label: "20 km", distanceMeters: 20_000 },
  { key: "half-marathon", label: "Half Marathon", distanceMeters: 21_097.5 },
  { key: "30k", label: "30 km", distanceMeters: 30_000 },
  { key: "marathon", label: "Marathon", distanceMeters: 42_195 },
  { key: "50k", label: "50 km", distanceMeters: 50_000 },
  { key: "100k", label: "100 km", distanceMeters: 100_000 },
];

export function buildWorkoutBestEffortsSummary(
  workouts: WorkoutBestEffortInput[],
): WorkoutBestEffortsSummary {
  const eligibleWorkouts = workouts.filter(
    (workout) => workout.completed !== null && ELIGIBLE_EVENT_TYPES.has(workout.eventType),
  );
  const bestEfforts = new Map<string, WorkoutBestEffortEntry[]>();
  let analyzedWorkoutCount = 0;

  for (const workout of eligibleWorkouts) {
    const timeline = buildDistanceTimeTimeline(workout);
    if (!timeline) {
      continue;
    }

    analyzedWorkoutCount += 1;
    const totalDistanceMeters = timeline[timeline.length - 1]?.distanceMeters ?? 0;

    for (const target of BEST_EFFORT_TARGETS) {
      if (target.distanceMeters > totalDistanceMeters) {
        continue;
      }

      const elapsedSeconds = findBestElapsedSecondsForDistance(timeline, target.distanceMeters);
      if (elapsedSeconds === null) {
        continue;
      }

      const candidate: WorkoutBestEffortEntry = {
        elapsedSeconds: Math.round(elapsedSeconds),
        paceSecondsPerKm: elapsedSeconds / (target.distanceMeters / 1_000),
        workoutSlug: workout.slug,
        workoutTitle: workout.title,
        workoutDate: workout.date,
        workoutActualDistanceKm: workout.actualDistanceKm,
      };
      bestEfforts.set(target.key, insertTopEffort(bestEfforts.get(target.key) ?? [], candidate));
    }
  }

  return {
    eligibleWorkoutCount: eligibleWorkouts.length,
    analyzedWorkoutCount,
    efforts: BEST_EFFORT_TARGETS.flatMap((target) => {
      const topEfforts = bestEfforts.get(target.key) ?? [];
      const bestEffort = topEfforts[0];
      return bestEffort
        ? [{
            key: target.key,
            label: target.label,
            distanceMeters: target.distanceMeters,
            elapsedSeconds: bestEffort.elapsedSeconds,
            paceSecondsPerKm: bestEffort.paceSecondsPerKm,
            workoutSlug: bestEffort.workoutSlug,
            workoutTitle: bestEffort.workoutTitle,
            workoutDate: bestEffort.workoutDate,
            workoutActualDistanceKm: bestEffort.workoutActualDistanceKm,
            topEfforts,
          }]
        : [];
    }),
  };
}

function buildDistanceTimeTimeline(workout: WorkoutBestEffortInput): DistanceTimePoint[] | null {
  const distance = workout.routeStreams?.distance;
  const velocity = workout.routeStreams?.velocitySmooth;
  if (!Array.isArray(distance) || !Array.isArray(velocity)) {
    return null;
  }

  const maxIndex = Math.min(distance.length, velocity.length);
  if (maxIndex < 2) {
    return null;
  }

  const lastDistance = toFiniteNumber(distance[maxIndex - 1]);
  if (lastDistance === null || lastDistance <= 0) {
    return null;
  }

  const totalTimeSeconds = workout.actualMovingTimeSeconds ?? workout.actualElapsedTimeSeconds;
  const fallbackSpeedMetersPerSecond =
    totalTimeSeconds && totalTimeSeconds > 0 ? lastDistance / totalTimeSeconds : null;
  const hasAnyVelocitySignal = velocity.some((sample) => {
    const normalizedSample = toFiniteNumber(sample);
    return normalizedSample !== null && normalizedSample > 0;
  });
  if (!hasAnyVelocitySignal) {
    return null;
  }

  const points: DistanceTimePoint[] = [];
  let elapsedSeconds = 0;

  for (let index = 1; index < maxIndex; index += 1) {
    const previousDistance = toFiniteNumber(distance[index - 1]);
    const currentDistance = toFiniteNumber(distance[index]);
    if (previousDistance === null || currentDistance === null || currentDistance <= previousDistance) {
      continue;
    }

    const deltaDistance = currentDistance - previousDistance;
    const speedSamples = [toPositiveNumber(velocity[index - 1]), toPositiveNumber(velocity[index])]
      .filter((sample): sample is number => sample !== null);
    const segmentSpeed =
      speedSamples.length > 0 ? average(speedSamples) : fallbackSpeedMetersPerSecond;
    if (!segmentSpeed || segmentSpeed <= 0) {
      continue;
    }

    if (points.length === 0) {
      points.push({ distanceMeters: previousDistance, elapsedSeconds: 0 });
    } else {
      const previousPointDistance = points[points.length - 1]?.distanceMeters ?? previousDistance;
      if (previousDistance > previousPointDistance) {
        points.push({ distanceMeters: previousDistance, elapsedSeconds });
      }
    }

    elapsedSeconds += deltaDistance / segmentSpeed;
    points.push({ distanceMeters: currentDistance, elapsedSeconds });
  }

  if (points.length < 2) {
    return null;
  }

  const estimatedTotalTime = points[points.length - 1]?.elapsedSeconds ?? 0;
  const scaleFactor =
    totalTimeSeconds && totalTimeSeconds > 0 && estimatedTotalTime > 0
      ? totalTimeSeconds / estimatedTotalTime
      : 1;

  return points.map((point) => ({
    distanceMeters: point.distanceMeters,
    elapsedSeconds: point.elapsedSeconds * scaleFactor,
  }));
}

function findBestElapsedSecondsForDistance(
  timeline: DistanceTimePoint[],
  targetDistanceMeters: number,
): number | null {
  const startDistance = timeline[0]?.distanceMeters ?? 0;
  const endDistance = timeline[timeline.length - 1]?.distanceMeters ?? 0;
  const maxStartDistance = endDistance - targetDistanceMeters;
  if (maxStartDistance < startDistance) {
    return null;
  }

  const candidateStarts = new Set<number>([startDistance, maxStartDistance]);
  for (const point of timeline) {
    if (point.distanceMeters >= startDistance && point.distanceMeters <= maxStartDistance) {
      candidateStarts.add(point.distanceMeters);
    }

    const shiftedStart = point.distanceMeters - targetDistanceMeters;
    if (shiftedStart >= startDistance && shiftedStart <= maxStartDistance) {
      candidateStarts.add(shiftedStart);
    }
  }

  let bestElapsedSeconds: number | null = null;
  for (const candidateStart of [...candidateStarts].sort((left, right) => left - right)) {
    const intervalStart = interpolateElapsedSeconds(timeline, candidateStart);
    const intervalEnd = interpolateElapsedSeconds(timeline, candidateStart + targetDistanceMeters);
    if (intervalStart === null || intervalEnd === null || intervalEnd <= intervalStart) {
      continue;
    }

    const elapsedSeconds = intervalEnd - intervalStart;
    if (bestElapsedSeconds === null || elapsedSeconds < bestElapsedSeconds) {
      bestElapsedSeconds = elapsedSeconds;
    }
  }

  return bestElapsedSeconds;
}

function interpolateElapsedSeconds(
  timeline: DistanceTimePoint[],
  targetDistanceMeters: number,
): number | null {
  if (timeline.length === 0) {
    return null;
  }

  const firstPoint = timeline[0];
  const lastPoint = timeline[timeline.length - 1];
  if (!firstPoint || !lastPoint) {
    return null;
  }

  if (targetDistanceMeters < firstPoint.distanceMeters || targetDistanceMeters > lastPoint.distanceMeters) {
    return null;
  }

  if (targetDistanceMeters === firstPoint.distanceMeters) {
    return firstPoint.elapsedSeconds;
  }

  if (targetDistanceMeters === lastPoint.distanceMeters) {
    return lastPoint.elapsedSeconds;
  }

  let low = 0;
  let high = timeline.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const point = timeline[middle];
    if (!point) {
      return null;
    }

    if (point.distanceMeters === targetDistanceMeters) {
      return point.elapsedSeconds;
    }

    if (point.distanceMeters < targetDistanceMeters) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const leftPoint = timeline[Math.max(0, high)];
  const rightPoint = timeline[Math.min(timeline.length - 1, low)];
  if (!leftPoint || !rightPoint || rightPoint.distanceMeters <= leftPoint.distanceMeters) {
    return null;
  }

  const interpolationRatio =
    (targetDistanceMeters - leftPoint.distanceMeters) /
    (rightPoint.distanceMeters - leftPoint.distanceMeters);
  return leftPoint.elapsedSeconds + interpolationRatio * (rightPoint.elapsedSeconds - leftPoint.elapsedSeconds);
}

function insertTopEffort(
  currentEfforts: WorkoutBestEffortEntry[],
  candidate: WorkoutBestEffortEntry,
) {
  const nextEfforts = [...currentEfforts, candidate]
    .sort(compareEffortCandidates)
    .filter((effort, index, efforts) =>
      efforts.findIndex((other) =>
        other.workoutSlug === effort.workoutSlug &&
        other.elapsedSeconds === effort.elapsedSeconds &&
        other.workoutDate === effort.workoutDate,
      ) === index,
    );

  return nextEfforts.slice(0, 5);
}

function compareEffortCandidates(candidate: WorkoutBestEffortEntry, current: WorkoutBestEffortEntry) {
  if (candidate.elapsedSeconds !== current.elapsedSeconds) {
    return candidate.elapsedSeconds - current.elapsedSeconds;
  }

  if (candidate.workoutDate !== current.workoutDate) {
    return candidate.workoutDate.localeCompare(current.workoutDate);
  }

  return candidate.workoutSlug.localeCompare(current.workoutSlug);
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toPositiveNumber(value: unknown) {
  const normalizedValue = toFiniteNumber(value);
  return normalizedValue !== null && normalizedValue > 0 ? normalizedValue : null;
}
