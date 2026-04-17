import { WorkoutPreviewCard } from "@/features/calendar/WorkoutPreviewCard";
import type { CalendarDayData } from "@/lib/calendar";

export function CalendarDayCard({
  day,
  selectedWorkoutSlug,
  onSelectWorkout,
}: {
  day: CalendarDayData;
  selectedWorkoutSlug: string | null;
  onSelectWorkout: (slug: string) => void;
}) {
  const useLightDateLabel = day.workouts.some(
    (workout) => workout.primaryImageUrl !== null || workout.mediaThumbnailUrl !== null,
  );

  return (
    <section className="calendar-day-card h-full overflow-hidden rounded-[0.65rem] bg-[rgb(247,251,255)]">
      <div
        className="calendar-day-workout-list relative h-full overflow-y-auto"
        data-calendar-workout-list="true"
      >
        {day.workouts.length > 0 ? (
          <div className="flex h-full flex-col divide-y divide-foreground/10">
            {day.workouts.map((workout) => (
              <WorkoutPreviewCard
                compact={day.workouts.length >= 4}
                fullBleed
                key={workout.slug}
                selected={workout.slug === selectedWorkoutSlug}
                workout={workout}
                onSelectWorkout={onSelectWorkout}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-32 items-center justify-center bg-surface-elevated/40 px-6 text-center">
            <p className="text-sm font-medium text-muted-foreground">Rest day.</p>
          </div>
        )}

        <div className="pointer-events-none absolute bottom-3 left-3 z-10">
          <p
            className={
              useLightDateLabel
                ? "text-sm font-black leading-none text-white"
                : "text-sm font-black leading-none text-foreground"
            }
          >
            {formatFullDate(day.date)}
          </p>
        </div>
      </div>
    </section>
  );
}

function formatFullDate(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}
