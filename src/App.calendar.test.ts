import type { WorkoutNote } from "@/lib/workouts/schema";
import { calendarTestUtils } from "@/lib/calendar";

function createWorkout(overrides: Partial<WorkoutNote> = {}): WorkoutNote {
  return {
    slug: "2026-04-05-12-km-easy-long-run",
    title: "12 km Easy Long Run",
    date: "2026-04-05",
    eventType: "run",
    expectedDistance: "12 km",
    expectedDistanceKm: 12,
    actualDistance: null,
    actualDistanceKm: null,
    completed: null,
    stravaId: null,
    dataSource: null,
    actualMovingTimeSeconds: null,
    actualElapsedTimeSeconds: null,
    averageHeartrate: null,
    maxHeartrate: null,
    summaryPolyline: null,
    primaryImageUrl: null,
    weather: null,
    hasStravaStreams: false,
    hasRouteStreams: false,
    routePath: null,
    measurementsPath: null,
    allDay: true,
    type: "note",
    body: "Easy day.",
    sourcePath: "notes/2026-04-05 12 km Easy Long Run.md",
    ...overrides,
  };
}

describe("calendarTestUtils", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-05T09:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("formats and parses calendar dates consistently", () => {
    const parsedDate = calendarTestUtils.parseDateKey("2026-04-05");

    expect(calendarTestUtils.formatDateKey(parsedDate)).toBe("2026-04-05");
    expect(calendarTestUtils.formatMonthFromDate(parsedDate)).toBe("April 2026");
    expect(calendarTestUtils.formatMonthLabel("2026-04-05")).toBe("April 2026");
    expect(calendarTestUtils.formatDayLabel("2026-04-05")).toBe("5 Apr");
    expect(calendarTestUtils.formatDayWeekday("2026-04-05")).toBe("Sunday");
  });

  it("returns the current day key from the system clock", () => {
    expect(calendarTestUtils.getTodayDateKey()).toBe("2026-04-05");
  });

  it("adds days without mutating the original date", () => {
    const originalDate = new Date("2026-04-05T00:00:00");
    const shiftedDate = calendarTestUtils.addDaysToDate(originalDate, 3);

    expect(calendarTestUtils.formatDateKey(originalDate)).toBe("2026-04-05");
    expect(calendarTestUtils.formatDateKey(shiftedDate)).toBe("2026-04-08");
  });

  it("aligns dates to the Monday week start and month start", () => {
    const focusDate = new Date("2026-04-05T00:00:00");

    expect(calendarTestUtils.formatDateKey(calendarTestUtils.startOfWeek(focusDate))).toBe("2026-03-30");
    expect(calendarTestUtils.formatDateKey(calendarTestUtils.startOfMonth(focusDate))).toBe("2026-04-01");
  });

  it("resolves the default focus date to the next upcoming workout", () => {
    const workouts = [
      createWorkout({ slug: "a", date: "2026-04-01" }),
      createWorkout({ slug: "b", date: "2026-04-05" }),
      createWorkout({ slug: "c", date: "2026-04-08" }),
    ];

    expect(calendarTestUtils.resolveDefaultFocusDate(workouts)).toBe("2026-04-05");
  });

  it("falls back to the latest workout date when all workouts are in the past", () => {
    const workouts = [
      createWorkout({ slug: "a", date: "2026-03-20" }),
      createWorkout({ slug: "b", date: "2026-04-01" }),
    ];

    expect(calendarTestUtils.resolveDefaultFocusDate(workouts)).toBe("2026-04-01");
  });

  it("falls back to today when there are no workouts", () => {
    expect(calendarTestUtils.resolveDefaultFocusDate([])).toBe("2026-04-05");
  });

  it("groups workouts by date", () => {
    const map = calendarTestUtils.buildWorkoutsByDate([
      createWorkout({ slug: "a", date: "2026-04-05" }),
      createWorkout({ slug: "b", date: "2026-04-05" }),
      createWorkout({ slug: "c", date: "2026-04-06" }),
    ]);

    expect(map.get("2026-04-05")?.map((workout) => workout.slug)).toEqual(["a", "b"]);
    expect(map.get("2026-04-06")?.map((workout) => workout.slug)).toEqual(["c"]);
  });

  it("builds a clamped date range around the filtered workouts", () => {
    const range = calendarTestUtils.getWorkoutDateRange(
      [createWorkout({ date: "2026-04-05" }), createWorkout({ date: "2026-04-10" })],
      2,
    );

    expect(range).toEqual({
      startDate: "2026-04-03",
      endDate: "2026-04-12",
    });
  });

  it("clamps a date to the allowed range", () => {
    const range = {
      startDate: "2026-04-03",
      endDate: "2026-04-12",
    };

    expect(calendarTestUtils.clampDateToRange("2026-04-01", range)).toBe("2026-04-03");
    expect(calendarTestUtils.clampDateToRange("2026-04-08", range)).toBe("2026-04-08");
    expect(calendarTestUtils.clampDateToRange("2026-04-20", range)).toBe("2026-04-12");
  });

  it("returns the adjacent previous and next dates", () => {
    expect(calendarTestUtils.getAdjacentDate("2026-04-05", "backward")).toBe("2026-04-04");
    expect(calendarTestUtils.getAdjacentDate("2026-04-05", "forward")).toBe("2026-04-06");
  });

  it("builds an individual calendar day with workouts and today state", () => {
    const workoutsByDate = new Map<string, WorkoutNote[]>([
      ["2026-04-05", [createWorkout({ slug: "today-run", date: "2026-04-05" })]],
    ]);

    expect(calendarTestUtils.buildCalendarDay("2026-04-05", workoutsByDate)).toMatchObject({
      date: "2026-04-05",
      isToday: true,
    });
    expect(calendarTestUtils.buildCalendarDay("2026-04-06", workoutsByDate)).toMatchObject({
      date: "2026-04-06",
      isToday: false,
      workouts: [],
    });
  });

  it("builds a bounded day buffer with previous and next slots around the active day", () => {
    const workoutsByDate = new Map<string, WorkoutNote[]>([
      ["2026-04-05", [createWorkout({ slug: "a", date: "2026-04-05" })]],
      ["2026-04-06", [createWorkout({ slug: "b", date: "2026-04-06" })]],
      ["2026-04-04", [createWorkout({ slug: "c", date: "2026-04-04" })]],
    ]);

    const items = calendarTestUtils.buildCalendarDayBuffer({
      activeDate: "2026-04-05",
      after: 2,
      before: 2,
      range: {
        startDate: "2026-04-03",
        endDate: "2026-04-08",
      },
      workoutsByDate,
    });

    expect(items.map((item) => `${item.position}:${item.date}:${item.relativeOffset}`)).toEqual([
      "0:2026-04-03:-2",
      "1:2026-04-04:-1",
      "2:2026-04-05:0",
      "3:2026-04-06:1",
      "4:2026-04-07:2",
    ]);
    expect(items[2]).toMatchObject({ isActive: true, date: "2026-04-05" });
  });

  it("drops day-buffer entries that fall outside the range", () => {
    const items = calendarTestUtils.buildCalendarDayBuffer({
      activeDate: "2026-04-03",
      after: 2,
      before: 2,
      range: {
        startDate: "2026-04-03",
        endDate: "2026-04-04",
      },
      workoutsByDate: new Map(),
    });

    expect(items.map((item) => item.date)).toEqual(["2026-04-03", "2026-04-04"]);
  });
});
