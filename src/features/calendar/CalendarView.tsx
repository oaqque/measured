import { useCallback, useRef } from "react";
import { CalendarControls } from "@/features/calendar/CalendarControls";
import { CalendarDayDeck, type CalendarDayDeckHandle } from "@/features/calendar/CalendarDayDeck";
import { useMediaQuery } from "@/features/calendar/useMediaQuery";
import { getTodayDateKey } from "@/lib/calendar";
import type { WorkoutFilters, WorkoutNote } from "@/lib/workouts/schema";
import { cn } from "@/lib/utils";

type WorkoutStatus = WorkoutFilters["status"];

export function CalendarView({
  calendarFocusDate,
  eventType,
  filteredWorkouts,
  selectedWorkoutSlug,
  status,
  onFocusDateChange,
  onEventTypeChange,
  onStatusChange,
  onSelectWorkout,
}: {
  calendarFocusDate: string;
  eventType: WorkoutFilters["eventType"];
  filteredWorkouts: WorkoutNote[];
  selectedWorkoutSlug: string | null;
  status: WorkoutStatus;
  onFocusDateChange: (value: string) => void;
  onEventTypeChange: (value: WorkoutFilters["eventType"]) => void;
  onStatusChange: (value: WorkoutStatus) => void;
  onSelectWorkout: (slug: string) => void;
}) {
  const todayDateKey = getTodayDateKey();
  const isMobileViewport = useMediaQuery("(max-width: 1023px)");
  const deckRef = useRef<CalendarDayDeckHandle | null>(null);
  const handleDateChange = useCallback(
    (value: string) => {
      if (deckRef.current) {
        deckRef.current.jumpToDate(value);
        return;
      }

      onFocusDateChange(value);
    },
    [onFocusDateChange],
  );

  return (
    <section
      className={cn(
        "py-2",
        isMobileViewport && "flex min-h-full flex-1 flex-col justify-center pb-28",
      )}
    >
      <div
        className={cn(
          "border-t border-foreground/10 pt-5",
          isMobileViewport && "flex min-h-0 flex-1 flex-col justify-center pt-3",
        )}
      >
        <div className="hidden items-center justify-center lg:flex">
          <CalendarControls
            calendarFocusDate={calendarFocusDate}
            eventType={eventType}
            status={status}
            todayDateKey={todayDateKey}
            onEventTypeChange={onEventTypeChange}
            onFocusDateChange={handleDateChange}
            onStatusChange={onStatusChange}
          />
        </div>

        {filteredWorkouts.length > 0 && calendarFocusDate ? (
          <CalendarDayDeck
            activeDate={calendarFocusDate}
            filteredWorkouts={filteredWorkouts}
            ref={deckRef}
            selectedWorkoutSlug={selectedWorkoutSlug}
            onActiveDateChange={onFocusDateChange}
            onSelectWorkout={onSelectWorkout}
          />
        ) : (
          <div className="border-t border-foreground/10 py-10">
            <p className="text-sm text-muted-foreground">No workouts match the current filter set.</p>
          </div>
        )}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] lg:hidden">
        <div className="pointer-events-auto mx-auto w-full max-w-xl rounded-[0.75rem] border border-foreground/10 bg-background/92 p-2 shadow-lg shadow-black/10 backdrop-blur">
          <CalendarControls
            calendarFocusDate={calendarFocusDate}
            eventType={eventType}
            status={status}
            todayDateKey={todayDateKey}
            onEventTypeChange={onEventTypeChange}
            onFocusDateChange={handleDateChange}
            onStatusChange={onStatusChange}
          />
        </div>
      </div>
    </section>
  );
}
