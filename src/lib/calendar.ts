import type { WorkoutNote } from "@/lib/workouts/schema";

export type CalendarCell = {
  date: string;
  isToday: boolean;
  isOutsideRange: boolean;
  key: string;
  workouts: WorkoutNote[];
};

export const DESKTOP_CALENDAR_ROW_HEIGHT = 176;
export const MOBILE_CALENDAR_CARD_HEIGHT = 224;
export const MOBILE_CALENDAR_CARD_GAP = 12;
export const DESKTOP_CALENDAR_WINDOW_WEEKS = 9;
export const MOBILE_CALENDAR_WINDOW_WEEKS = 6;
export const CALENDAR_WINDOW_SHIFT_WEEKS = 4;

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
  return workouts.find((workout) => workout.date >= today)?.date ?? workouts[workouts.length - 1]?.date ?? today;
}

export function chunkCalendarWeeks(cells: CalendarCell[]) {
  const weeks: CalendarCell[][] = [];

  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return weeks;
}

export function buildCalendarWindow(focusDate: string, isMobileViewport: boolean) {
  const resolvedFocusDate = focusDate || getTodayDateKey();
  const focus = parseDateKey(resolvedFocusDate);

  if (isMobileViewport) {
    const rangeStartDate = startOfWeek(startOfMonth(focus));
    return {
      startDate: formatDateKey(rangeStartDate),
      endDate: formatDateKey(addDaysToDate(rangeStartDate, MOBILE_CALENDAR_WINDOW_WEEKS * 7 - 1)),
    };
  }

  const rangeStartDate = addDaysToDate(startOfWeek(focus), -Math.floor(DESKTOP_CALENDAR_WINDOW_WEEKS / 2) * 7);

  return {
    startDate: formatDateKey(rangeStartDate),
    endDate: formatDateKey(addDaysToDate(rangeStartDate, DESKTOP_CALENDAR_WINDOW_WEEKS * 7 - 1)),
  };
}

export function shiftCalendarWindow(
  range: { startDate: string; endDate: string },
  direction: "backward" | "forward",
) {
  const dayOffset = (direction === "backward" ? -1 : 1) * CALENDAR_WINDOW_SHIFT_WEEKS * 7;
  return {
    startDate: formatDateKey(addDaysToDate(parseDateKey(range.startDate), dayOffset)),
    endDate: formatDateKey(addDaysToDate(parseDateKey(range.endDate), dayOffset)),
  };
}

export function getCalendarWindowShiftScrollOffset(isMobileViewport: boolean) {
  if (isMobileViewport) {
    return CALENDAR_WINDOW_SHIFT_WEEKS * 7 * (MOBILE_CALENDAR_CARD_HEIGHT + MOBILE_CALENDAR_CARD_GAP);
  }

  return CALENDAR_WINDOW_SHIFT_WEEKS * DESKTOP_CALENDAR_ROW_HEIGHT;
}

export function shouldReleaseCalendarEdgeLock(
  viewport: HTMLDivElement,
  direction: "backward" | "forward",
  isMobileViewport: boolean,
) {
  const threshold = isMobileViewport ? MOBILE_CALENDAR_CARD_HEIGHT : DESKTOP_CALENDAR_ROW_HEIGHT;
  const releaseThreshold = threshold * 2;

  if (direction === "backward") {
    return viewport.scrollTop > releaseThreshold;
  }

  const remainingScroll = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
  return remainingScroll > releaseThreshold;
}

export function freezeViewportScroll(viewport: HTMLDivElement) {
  const previousOverflowY = viewport.style.overflowY;
  const previousOverscrollBehavior = viewport.style.overscrollBehavior;

  viewport.style.overflowY = "hidden";
  viewport.style.overscrollBehavior = "none";

  return () => {
    viewport.style.overflowY = previousOverflowY;
    viewport.style.overscrollBehavior = previousOverscrollBehavior;
  };
}

export function buildCalendarCells(
  startDateKey: string,
  endDateKey: string,
  workoutsByDate: Map<string, WorkoutNote[]>,
) {
  const startDate = parseDateKey(startDateKey);
  const endDate = parseDateKey(endDateKey);
  const todayDateKey = getTodayDateKey();
  const cells: CalendarCell[] = [];

  for (let currentDate = startDate; currentDate <= endDate; currentDate = addDaysToDate(currentDate, 1)) {
    const date = formatDateKey(currentDate);
    cells.push({
      key: date,
      date,
      isToday: date === todayDateKey,
      isOutsideRange: false,
      workouts: workoutsByDate.get(date) ?? [],
    });
  }

  return cells;
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
  buildCalendarCells,
  buildCalendarWindow,
  chunkCalendarWeeks,
  formatDateKey,
  formatDayLabel,
  formatDayWeekday,
  formatMonthFromDate,
  formatMonthLabel,
  freezeViewportScroll,
  getCalendarWindowShiftScrollOffset,
  getTodayDateKey,
  parseDateKey,
  resolveDefaultFocusDate,
  shiftCalendarWindow,
  shouldReleaseCalendarEdgeLock,
  startOfMonth,
  startOfWeek,
};
