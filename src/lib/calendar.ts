import type { WorkoutNote } from "@/lib/workouts/schema";

export type CalendarDateRange = {
  startDate: string;
  endDate: string;
};

export type CalendarDayData = {
  date: string;
  isToday: boolean;
  workouts: WorkoutNote[];
};

export type CalendarDayStackItem = CalendarDayData & {
  isActive: boolean;
  key: string;
  position: number;
  relativeOffset: number;
};

export function formatDayLabel(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T00:00:00`));
}

export function formatDayWeekday(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
  }).format(new Date(`${value}T00:00:00`));
}

export function getTodayDateKey() {
  return formatDateKey(new Date());
}

export function resolveDefaultFocusDate(workouts: WorkoutNote[]) {
  const today = getTodayDateKey();
  return (
    workouts.find((workout) => workout.date >= today)?.date ??
    workouts[workouts.length - 1]?.date ??
    today
  );
}

export function buildWorkoutsByDate(workouts: WorkoutNote[]) {
  const workoutsByDate = new Map<string, WorkoutNote[]>();

  for (const workout of workouts) {
    const existing = workoutsByDate.get(workout.date);
    if (existing) {
      existing.push(workout);
      continue;
    }

    workoutsByDate.set(workout.date, [workout]);
  }

  return workoutsByDate;
}

export function getWorkoutDateRange(workouts: WorkoutNote[], marginDays = 14): CalendarDateRange | null {
  if (workouts.length === 0) {
    return null;
  }

  const sortedWorkouts = [...workouts].sort((left, right) => left.date.localeCompare(right.date));
  const startDate = addDaysToDate(parseDateKey(sortedWorkouts[0]!.date), -marginDays);
  const endDate = addDaysToDate(parseDateKey(sortedWorkouts[sortedWorkouts.length - 1]!.date), marginDays);

  return {
    startDate: formatDateKey(startDate),
    endDate: formatDateKey(endDate),
  };
}

export function isDateWithinRange(date: string, range: CalendarDateRange) {
  return date >= range.startDate && date <= range.endDate;
}

export function clampDateToRange(date: string, range: CalendarDateRange) {
  if (date < range.startDate) {
    return range.startDate;
  }

  if (date > range.endDate) {
    return range.endDate;
  }

  return date;
}

export function getAdjacentDate(date: string, direction: "backward" | "forward") {
  return formatDateKey(addDaysToDate(parseDateKey(date), direction === "backward" ? -1 : 1));
}

export function buildCalendarDay(date: string, workoutsByDate: Map<string, WorkoutNote[]>): CalendarDayData {
  return {
    date,
    isToday: date === getTodayDateKey(),
    workouts: workoutsByDate.get(date) ?? [],
  };
}

export function buildCalendarDayBuffer({
  activeDate,
  after,
  before,
  range,
  workoutsByDate,
}: {
  activeDate: string;
  after: number;
  before: number;
  range: CalendarDateRange;
  workoutsByDate: Map<string, WorkoutNote[]>;
}) {
  const items: CalendarDayStackItem[] = [];
  const offsets: number[] = [];

  for (let offset = before; offset >= 1; offset -= 1) {
    offsets.push(-offset);
  }
  offsets.push(0);
  for (let offset = 1; offset <= after; offset += 1) {
    offsets.push(offset);
  }

  offsets.forEach((relativeOffset) => {
    const date = formatDateKey(addDaysToDate(parseDateKey(activeDate), relativeOffset));
    if (!isDateWithinRange(date, range)) {
      return;
    }

    const day = buildCalendarDay(date, workoutsByDate);
    items.push({
      ...day,
      isActive: relativeOffset === 0,
      key: date,
      position: items.length,
      relativeOffset,
    });
  });

  return items;
}

export function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00`);
}

export function formatDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function formatMonthLabel(value: string) {
  return formatMonthFromDate(parseDateKey(value));
}

export function formatMonthFromDate(value: Date) {
  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
  }).format(value);
}

export function addDaysToDate(value: Date, days: number) {
  const nextValue = new Date(value);
  nextValue.setDate(nextValue.getDate() + days);
  return nextValue;
}

export function startOfWeek(value: Date) {
  return addDaysToDate(value, -((value.getDay() + 6) % 7));
}

export function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

export const calendarTestUtils = {
  addDaysToDate,
  buildCalendarDay,
  buildCalendarDayBuffer,
  buildWorkoutsByDate,
  clampDateToRange,
  formatDateKey,
  formatDayLabel,
  formatDayWeekday,
  formatMonthFromDate,
  formatMonthLabel,
  getAdjacentDate,
  getTodayDateKey,
  getWorkoutDateRange,
  isDateWithinRange,
  parseDateKey,
  resolveDefaultFocusDate,
  startOfMonth,
  startOfWeek,
};
