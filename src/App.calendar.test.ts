import type { WorkoutNote } from "@/lib/workouts/schema";
import { calendarTestUtils } from "@/App";

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
    allDay: true,
    type: "note",
    body: "Easy day.",
    sourcePath: "notes/2026-04-05 12 km Easy Long Run.md",
    ...overrides,
  };
}

function setViewportMetrics(
  element: HTMLDivElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop: number },
) {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    value: metrics.scrollTop,
    writable: true,
  });
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

  it("chunks calendar cells into week-sized groups", () => {
    const cells = Array.from({ length: 10 }, (_, index) => ({
      key: `2026-04-${String(index + 1).padStart(2, "0")}`,
      date: `2026-04-${String(index + 1).padStart(2, "0")}`,
      isToday: false,
      isOutsideRange: false,
      workouts: [],
    }));

    const weeks = calendarTestUtils.chunkCalendarWeeks(cells);

    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toHaveLength(7);
    expect(weeks[1]).toHaveLength(3);
    expect(weeks[1][0]?.date).toBe("2026-04-08");
  });

  it("builds the mobile calendar window from the start of the focus month week", () => {
    expect(calendarTestUtils.buildCalendarWindow("2026-04-05", true)).toEqual({
      startDate: "2026-03-30",
      endDate: "2026-05-10",
    });
  });

  it("builds the desktop calendar window around the focus week", () => {
    expect(calendarTestUtils.buildCalendarWindow("2026-04-05", false)).toEqual({
      startDate: "2026-03-02",
      endDate: "2026-05-03",
    });
  });

  it("shifts the calendar window by four weeks in either direction", () => {
    const initialRange = {
      startDate: "2026-03-30",
      endDate: "2026-05-10",
    };

    expect(calendarTestUtils.shiftCalendarWindow(initialRange, "forward")).toEqual({
      startDate: "2026-04-27",
      endDate: "2026-06-07",
    });
    expect(calendarTestUtils.shiftCalendarWindow(initialRange, "backward")).toEqual({
      startDate: "2026-03-02",
      endDate: "2026-04-12",
    });
  });

  it("calculates the scroll offset needed to preserve continuity across window shifts", () => {
    expect(calendarTestUtils.getCalendarWindowShiftScrollOffset(true)).toBe(6608);
    expect(calendarTestUtils.getCalendarWindowShiftScrollOffset(false)).toBe(704);
  });

  it("releases the edge lock only after moving beyond the release threshold", () => {
    const viewport = document.createElement("div");

    setViewportMetrics(viewport, {
      clientHeight: 500,
      scrollHeight: 2000,
      scrollTop: 449,
    });
    expect(calendarTestUtils.shouldReleaseCalendarEdgeLock(viewport, "backward", true)).toBe(true);

    setViewportMetrics(viewport, {
      clientHeight: 500,
      scrollHeight: 2000,
      scrollTop: 351,
    });
    expect(calendarTestUtils.shouldReleaseCalendarEdgeLock(viewport, "backward", false)).toBe(false);

    setViewportMetrics(viewport, {
      clientHeight: 500,
      scrollHeight: 2000,
      scrollTop: 1100,
    });
    expect(calendarTestUtils.shouldReleaseCalendarEdgeLock(viewport, "forward", false)).toBe(true);

    setViewportMetrics(viewport, {
      clientHeight: 500,
      scrollHeight: 2000,
      scrollTop: 1060,
    });
    expect(calendarTestUtils.shouldReleaseCalendarEdgeLock(viewport, "forward", true)).toBe(false);
  });

  it("freezes viewport scrolling and restores the prior inline styles", () => {
    const viewport = document.createElement("div");
    viewport.style.overflowY = "auto";
    viewport.style.overscrollBehavior = "contain";
    viewport.scrollTop = 320;

    const restore = calendarTestUtils.freezeViewportScroll(viewport);

    expect(viewport.style.overflowY).toBe("hidden");
    expect(viewport.style.overscrollBehavior).toBe("none");
    expect(viewport.scrollTop).toBe(320);

    restore();

    expect(viewport.style.overflowY).toBe("auto");
    expect(viewport.style.overscrollBehavior).toBe("contain");
  });

  it("builds inclusive calendar cells and preserves workouts by date", () => {
    const workoutOnToday = createWorkout({ slug: "today-run", date: "2026-04-05" });
    const workoutTomorrow = createWorkout({ slug: "tomorrow-run", date: "2026-04-06" });
    const workoutsByDate = new Map<string, WorkoutNote[]>([
      ["2026-04-05", [workoutOnToday]],
      ["2026-04-06", [workoutTomorrow]],
    ]);

    const cells = calendarTestUtils.buildCalendarCells("2026-04-05", "2026-04-07", workoutsByDate);

    expect(cells).toHaveLength(3);
    expect(cells.map((cell) => cell.date)).toEqual(["2026-04-05", "2026-04-06", "2026-04-07"]);
    expect(cells[0]).toMatchObject({
      date: "2026-04-05",
      key: "2026-04-05",
      isToday: true,
      isOutsideRange: false,
    });
    expect(cells[0]?.workouts).toEqual([workoutOnToday]);
    expect(cells[1]?.workouts).toEqual([workoutTomorrow]);
    expect(cells[2]?.workouts).toEqual([]);
  });
});
