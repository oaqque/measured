import workoutsJson from "@/generated/workouts.json";
import type { WorkoutFilters, WorkoutNote, WorkoutsData } from "@/lib/workouts/schema";

const workoutsData = workoutsJson as WorkoutsData;
const workouts = [...workoutsData.workouts].sort((left, right) =>
  left.date === right.date ? left.slug.localeCompare(right.slug) : left.date.localeCompare(right.date),
);
const workoutsBySlug = new Map(workouts.map((workout) => [workout.slug, workout]));

export const trainingPlan = workoutsData.plan;
export const allWorkouts = workouts;
export const availableEventTypes = Array.from(
  new Set(workouts.map((workout) => workout.eventType)),
).sort((left, right) => left.localeCompare(right));

export function getWorkoutBySlug(slug: string) {
  return workoutsBySlug.get(slug) ?? null;
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

  return workouts.filter((workout) => {
    const matchesQuery =
      query.length === 0 ||
      workout.title.toLowerCase().includes(query) ||
      workout.body.toLowerCase().includes(query);
    const matchesEventType =
      filters.eventType === "all" || workout.eventType === filters.eventType;
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
