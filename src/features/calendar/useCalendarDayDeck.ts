import { useCallback, useEffect, useMemo } from "react";
import {
  buildCalendarDay,
  buildWorkoutsByDate,
  clampDateToRange,
  getAdjacentDate,
  getWorkoutDateRange,
  type CalendarDayData,
  type CalendarDateRange,
} from "@/lib/calendar";
import type { WorkoutNote } from "@/lib/workouts/schema";

export type CalendarDayDeckController = {
  activeDate: string;
  activeDay: CalendarDayData | null;
  canGoBackward: boolean;
  canGoForward: boolean;
  nextDay: CalendarDayData | null;
  nextDate: string | null;
  previousDay: CalendarDayData | null;
  previousDate: string | null;
  range: CalendarDateRange | null;
  goToNextDay: () => void;
  goToPreviousDay: () => void;
  jumpToDate: (date: string) => void;
};

export function useCalendarDayDeck({
  activeDate,
  filteredWorkouts,
  onActiveDateChange,
}: {
  activeDate: string;
  filteredWorkouts: WorkoutNote[];
  onActiveDateChange: (date: string) => void;
}): CalendarDayDeckController {
  const workoutsByDate = useMemo(() => buildWorkoutsByDate(filteredWorkouts), [filteredWorkouts]);
  const range = useMemo(() => getWorkoutDateRange(filteredWorkouts, 14), [filteredWorkouts]);
  const resolvedActiveDate = useMemo(() => {
    if (!range || !activeDate) {
      return "";
    }

    return clampDateToRange(activeDate, range);
  }, [activeDate, range]);
  const canGoBackward = Boolean(range && resolvedActiveDate && resolvedActiveDate > range.startDate);
  const canGoForward = Boolean(range && resolvedActiveDate && resolvedActiveDate < range.endDate);
  const activeDay = useMemo(() => {
    if (!resolvedActiveDate) {
      return null;
    }

    return buildCalendarDay(resolvedActiveDate, workoutsByDate);
  }, [resolvedActiveDate, workoutsByDate]);
  const previousDate = useMemo(() => {
    if (!range || !resolvedActiveDate || !canGoBackward) {
      return null;
    }

    return clampDateToRange(getAdjacentDate(resolvedActiveDate, "backward"), range);
  }, [canGoBackward, range, resolvedActiveDate]);
  const nextDate = useMemo(() => {
    if (!range || !resolvedActiveDate || !canGoForward) {
      return null;
    }

    return clampDateToRange(getAdjacentDate(resolvedActiveDate, "forward"), range);
  }, [canGoForward, range, resolvedActiveDate]);
  const previousDay = useMemo(() => {
    if (!previousDate) {
      return null;
    }

    return buildCalendarDay(previousDate, workoutsByDate);
  }, [previousDate, workoutsByDate]);
  const nextDay = useMemo(() => {
    if (!nextDate) {
      return null;
    }

    return buildCalendarDay(nextDate, workoutsByDate);
  }, [nextDate, workoutsByDate]);

  useEffect(() => {
    if (!range || !resolvedActiveDate) {
      return;
    }

    if (resolvedActiveDate !== activeDate) {
      onActiveDateChange(resolvedActiveDate);
    }
  }, [activeDate, onActiveDateChange, range, resolvedActiveDate]);

  const goToPreviousDay = useCallback(() => {
    if (!range || !resolvedActiveDate || !canGoBackward) {
      return;
    }

    onActiveDateChange(clampDateToRange(getAdjacentDate(resolvedActiveDate, "backward"), range));
  }, [canGoBackward, onActiveDateChange, range, resolvedActiveDate]);

  const goToNextDay = useCallback(() => {
    if (!range || !resolvedActiveDate || !canGoForward) {
      return;
    }

    onActiveDateChange(clampDateToRange(getAdjacentDate(resolvedActiveDate, "forward"), range));
  }, [canGoForward, onActiveDateChange, range, resolvedActiveDate]);

  const jumpToDate = useCallback(
    (date: string) => {
      if (!range) {
        return;
      }

      onActiveDateChange(clampDateToRange(date, range));
    },
    [onActiveDateChange, range],
  );

  return {
    activeDate: resolvedActiveDate,
    activeDay,
    canGoBackward,
    canGoForward,
    goToNextDay,
    goToPreviousDay,
    jumpToDate,
    nextDay,
    nextDate,
    previousDay,
    previousDate,
    range,
  };
}
