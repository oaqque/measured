import workoutsJson from "@/generated/workouts.json";
import type {
  ChangelogEntry,
  WorkoutActivityRefMap,
  WorkoutDataSource,
  WorkoutFilters,
  WorkoutNote,
  WorkoutProvider,
  WorkoutSourceDetailsPayload,
  WorkoutSourceSummary,
  WorkoutsData,
} from "@/lib/workouts/schema";

type RawWorkoutProvider = WorkoutProvider;
type RawWorkoutSourceSummary = WorkoutSourceSummary;
type RawWorkoutNote = WorkoutNote & {
  activityRefs?: WorkoutActivityRefMap;
  sources?: Partial<Record<RawWorkoutProvider, RawWorkoutSourceSummary>>;
};

type RawWorkoutsData = Omit<WorkoutsData, "workouts"> & {
  workouts: RawWorkoutNote[];
};

const workoutSourceDetailsPath = "/generated/workout-source-details.json";
const rawWorkoutsData = workoutsJson as RawWorkoutsData;
const changelog = [...rawWorkoutsData.changelog].sort((left, right) =>
  left.date === right.date ? right.slug.localeCompare(left.slug) : right.date.localeCompare(left.date),
);
const workouts = rawWorkoutsData.workouts
  .map((workout) => normalizeWorkoutNote(workout))
  .sort((left, right) =>
  left.date === right.date ? left.slug.localeCompare(right.slug) : left.date.localeCompare(right.date),
  );
const goalNotes = [...rawWorkoutsData.goalNotes].sort((left, right) =>
  left.date === right.date ? left.title.localeCompare(right.title) : left.date.localeCompare(right.date),
);
const workoutsBySlug = new Map(workouts.map((workout) => [workout.slug, workout]));
const changelogByAffectedFile = buildChangelogByAffectedFile(changelog);
let workoutSourceDetailsPromise: Promise<Map<string, Partial<Record<WorkoutProvider, WorkoutSourceSummary>>>> | null =
  null;

export const generatedAt = rawWorkoutsData.generatedAt;
export const welcomeDocument = rawWorkoutsData.welcome;
export const goalsDocument = rawWorkoutsData.goals;
export const heartRateDocument = rawWorkoutsData.heartRate;
export const allGoalNotes = goalNotes;
export const trainingPlan = rawWorkoutsData.plan;
export const allChangelogEntries = changelog;
export const allWorkouts = workouts;
export const availableEventTypes = Array.from(
  new Set(workouts.map((workout) => workout.eventType)),
).sort((left, right) => left.localeCompare(right));
export const availableChangelogAffectedFiles = Array.from(
  new Set(changelog.flatMap((entry) => entry.affectedFiles)),
).sort((left, right) => left.localeCompare(right));

export function getWorkoutBySlug(slug: string) {
  return workoutsBySlug.get(slug) ?? null;
}

export async function loadWorkoutSourceDetails(slug: string) {
  const existingWorkout = workoutsBySlug.get(slug);
  if (existingWorkout?.sources && Object.keys(existingWorkout.sources).length > 0) {
    return existingWorkout.sources;
  }

  const detailsBySlug = await readWorkoutSourceDetails();
  const sources = detailsBySlug.get(slug) ?? null;
  if (existingWorkout && sources) {
    existingWorkout.sources = sources;
  }

  return sources;
}

export function getChangelogEntriesForFile(sourcePath: string) {
  return changelogByAffectedFile.get(sourcePath) ?? [];
}

export function getAdjacentWorkouts(slug: string) {
  const index = workouts.findIndex((workout) => workout.slug === slug);
  if (index === -1) {
    return { previous: null, next: null };
  }

  return {
    previous: workouts[index - 1] ?? null,
    next: workouts[index + 1] ?? null,
  };
}

export function getUpcomingWorkouts(referenceDate = todayKey(), limit = 6) {
  const upcoming = workouts.filter(
    (workout) => workout.completed === null && workout.date >= referenceDate,
  );
  if (upcoming.length > 0) {
    return upcoming.slice(0, limit);
  }

  return workouts.filter((workout) => workout.date >= referenceDate).slice(0, limit);
}

export function getRecentCompletedWorkouts(limit = 6) {
  return [...workouts]
    .filter((workout) => workout.completed !== null)
    .sort((left, right) => {
      if (left.completed === null || right.completed === null) {
        return 0;
      }

      return right.completed.localeCompare(left.completed);
    })
    .slice(0, limit);
}

export function getCurrentBlockSummary(referenceDate = todayKey()) {
  const anchor =
    workouts.find((workout) => workout.date >= referenceDate) ??
    workouts[workouts.length - 1] ??
    null;

  if (!anchor) {
    return {
      rangeStart: referenceDate,
      rangeEnd: referenceDate,
      sessions: 0,
      completedSessions: 0,
      plannedDistanceKm: 0,
      raceCount: 0,
    };
  }

  const rangeStart = anchor.date;
  const rangeEnd = addDays(anchor.date, 13);
  const blockWorkouts = workouts.filter(
    (workout) => workout.date >= rangeStart && workout.date <= rangeEnd,
  );

  return {
    rangeStart,
    rangeEnd,
    sessions: blockWorkouts.length,
    completedSessions: blockWorkouts.filter((workout) => workout.completed !== null).length,
    plannedDistanceKm: roundNumber(
      blockWorkouts.reduce((sum, workout) => sum + (workout.expectedDistanceKm ?? 0), 0),
    ),
    raceCount: blockWorkouts.filter((workout) => workout.eventType === "race").length,
  };
}

export function filterWorkouts(filters: WorkoutFilters) {
  const query = filters.query.trim().toLowerCase();
  const selectedEventTypes = new Set(filters.eventType);

  return workouts.filter((workout) => {
    const matchesQuery =
      query.length === 0 ||
      workout.title.toLowerCase().includes(query) ||
      workout.body.toLowerCase().includes(query);
    const matchesEventType =
      selectedEventTypes.size === 0 || selectedEventTypes.has(workout.eventType);
    const matchesStatus =
      filters.status === "all" ||
      (filters.status === "completed" ? workout.completed !== null : workout.completed === null);

    return matchesQuery && matchesEventType && matchesStatus;
  });
}

export function groupWorkoutsByMonth(items: WorkoutNote[]) {
  const monthMap = new Map<
    string,
    {
      key: string;
      label: string;
      days: Array<{ date: string; workouts: WorkoutNote[] }>;
    }
  >();

  for (const workout of items) {
    const monthKey = workout.date.slice(0, 7);
    const monthLabel = formatMonthLabel(workout.date);
    let monthGroup = monthMap.get(monthKey);

    if (!monthGroup) {
      monthGroup = { key: monthKey, label: monthLabel, days: [] };
      monthMap.set(monthKey, monthGroup);
    }

    const existingDay = monthGroup.days.find((day) => day.date === workout.date);
    if (existingDay) {
      existingDay.workouts.push(workout);
    } else {
      monthGroup.days.push({ date: workout.date, workouts: [workout] });
    }
  }

  return Array.from(monthMap.values());
}

export function formatDisplayDate(date: string) {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

export function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date}T00:00:00`));
}

export function formatCompletedTimestamp(completed: string | null) {
  if (!completed) {
    return "Planned";
  }

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(completed));
}

export function formatDistance(distanceKm: number | null) {
  if (distanceKm === null) {
    return "Distance TBD";
  }

  return `${trimTrailingZero(distanceKm)} km`;
}

export function formatRange(rangeStart: string, rangeEnd: string) {
  return `${formatShortDate(rangeStart)} to ${formatShortDate(rangeEnd)}`;
}

export function formatChangelogDate(date: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function normalizeWorkoutNote(workout: RawWorkoutNote): WorkoutNote {
  const preferredSource = getPreferredWorkoutSource(workout);
  const stravaSource = workout.sources?.strava ?? null;

  return {
    slug: workout.slug,
    title: workout.title,
    date: workout.date,
    eventType: workout.eventType,
    expectedDistance: workout.expectedDistance,
    expectedDistanceKm: workout.expectedDistanceKm,
    actualDistance: workout.actualDistance,
    actualDistanceKm: workout.actualDistanceKm,
    completed: workout.completed,
    stravaId:
      workout.stravaId ??
      normalizeNumericActivityId(workout.activityRefs?.strava ?? stravaSource?.activityId ?? null),
    dataSource: workout.dataSource ?? normalizeLegacyDataSource(preferredSource?.provider ?? null),
    actualMovingTimeSeconds: workout.actualMovingTimeSeconds ?? preferredSource?.movingTimeSeconds ?? null,
    actualElapsedTimeSeconds: workout.actualElapsedTimeSeconds ?? preferredSource?.elapsedTimeSeconds ?? null,
    averageHeartrate: workout.averageHeartrate ?? preferredSource?.averageHeartrate ?? null,
    maxHeartrate: workout.maxHeartrate ?? preferredSource?.maxHeartrate ?? null,
    summaryPolyline: workout.summaryPolyline ?? preferredSource?.summaryPolyline ?? null,
    primaryImageUrl: workout.primaryImageUrl ?? preferredSource?.primaryImageUrl ?? null,
    weather: workout.weather ?? null,
    hasStravaStreams:
      workout.hasStravaStreams || Boolean(stravaSource?.hasRouteStreams && stravaSource.routePath),
    activityRefs: workout.activityRefs,
    sources: workout.sources,
    allDay: workout.allDay,
    type: workout.type,
    body: workout.body,
    sections: workout.sections,
    sourcePath: workout.sourcePath,
  };
}

function getPreferredWorkoutSource(workout: RawWorkoutNote) {
  return (
    getSourceMatching(workout, (source) => source.hasRouteStreams && source.routePath !== null) ??
    getSourceMatching(workout, (source) => source.summaryPolyline !== null) ??
    getSourceMatching(workout, (source) => source.primaryImageUrl !== null) ??
    getSourceMatching(workout)
  );
}

function getSourceMatching(
  workout: RawWorkoutNote,
  predicate?: (source: RawWorkoutSourceSummary) => boolean,
) {
  for (const provider of ["strava", "appleHealth"] as const) {
    const source = workout.sources?.[provider];
    if (!source) {
      continue;
    }

    if (predicate && !predicate(source)) {
      continue;
    }

    return source;
  }

  return null;
}

function normalizeLegacyDataSource(provider: RawWorkoutProvider | null): WorkoutDataSource | null {
  if (provider === "strava") {
    return "strava";
  }

  if (provider === "appleHealth") {
    return "apple-health";
  }

  return null;
}

function normalizeNumericActivityId(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readWorkoutSourceDetails() {
  if (!workoutSourceDetailsPromise) {
    workoutSourceDetailsPromise = fetch(`${workoutSourceDetailsPath}?v=${encodeURIComponent(generatedAt)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 404) {
          return new Map<string, Partial<Record<WorkoutProvider, WorkoutSourceSummary>>>();
        }

        if (!response.ok) {
          throw new Error(`Unable to load workout source details: ${response.status}`);
        }

        const payload = (await response.json()) as WorkoutSourceDetailsPayload;
        return new Map(
          Object.entries(payload.workouts ?? {}).map(([slug, details]) => [slug, details.sources ?? {}]),
        );
      })
      .catch((error) => {
        workoutSourceDetailsPromise = null;
        throw error;
      });
  }

  return workoutSourceDetailsPromise;
}

function buildChangelogByAffectedFile(entries: ChangelogEntry[]) {
  const changelogMap = new Map<string, ChangelogEntry[]>();

  for (const entry of entries) {
    for (const affectedFile of entry.affectedFiles) {
      const existingEntries = changelogMap.get(affectedFile);
      if (existingEntries) {
        existingEntries.push(entry);
      } else {
        changelogMap.set(affectedFile, [entry]);
      }
    }
  }

  for (const [key, items] of changelogMap.entries()) {
    changelogMap.set(
      key,
      [...items].sort((left, right) =>
        left.date === right.date ? right.slug.localeCompare(left.slug) : right.date.localeCompare(left.date),
      ),
    );
  }

  return changelogMap;
}

function formatMonthLabel(date: string) {
  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const current = new Date(`${date}T00:00:00`);
  current.setDate(current.getDate() + days);
  return current.toISOString().slice(0, 10);
}

function roundNumber(value: number) {
  return Math.round(value * 10) / 10;
}

function trimTrailingZero(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
