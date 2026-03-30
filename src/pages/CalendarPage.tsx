import { Search, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { WorkoutListItem } from "@/components/WorkoutListItem";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  availableEventTypes,
  filterWorkouts,
  formatDisplayDate,
  groupWorkoutsByMonth,
} from "@/lib/workouts/load";
import type { WorkoutFilters } from "@/lib/workouts/schema";

const initialFilters: WorkoutFilters = {
  query: "",
  eventType: "all",
  status: "all",
};

export function CalendarPage() {
  const [filters, setFilters] = useState(initialFilters);
  const filteredWorkouts = filterWorkouts(filters);
  const groupedWorkouts = groupWorkoutsByMonth(filteredWorkouts);

  return (
    <div className="space-y-6">
      <section className="surface-panel motion-enter px-6 py-6 md:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="eyebrow">Calendar</p>
            <h1 className="text-3xl font-black md:text-5xl">Scan the block by date, type, or status.</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              This is intentionally a readable list view rather than a complex planner. Filters are
              local, fast, and build directly from the markdown notes.
            </p>
          </div>
          <div className="rounded-full bg-surface-elevated px-4 py-2.5 text-sm font-semibold text-muted-foreground">
            {filteredWorkouts.length} matching workouts
          </div>
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(12rem,0.8fr)_minmax(12rem,0.8fr)]">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-11"
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  query: event.target.value,
                }))
              }
              placeholder="Search title or notes"
              value={filters.query}
            />
          </label>

          <Select
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                eventType: event.target.value,
              }))
            }
            value={filters.eventType}
          >
            <option value="all">All event types</option>
            {availableEventTypes.map((eventType) => (
              <option key={eventType} value={eventType}>
                {eventType}
              </option>
            ))}
          </Select>

          <Select
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                status: event.target.value as WorkoutFilters["status"],
              }))
            }
            value={filters.status}
          >
            <option value="all">All statuses</option>
            <option value="planned">Planned only</option>
            <option value="completed">Completed only</option>
          </Select>
        </div>
      </section>

      <section className="space-y-6">
        {groupedWorkouts.length === 0 ? (
          <div className="surface-panel-alt flex items-center gap-3 px-6 py-6 text-sm text-muted-foreground">
            <SlidersHorizontal className="size-4 shrink-0" />
            No workouts match the current filters.
          </div>
        ) : null}

        {groupedWorkouts.map((monthGroup) => (
          <div key={monthGroup.key} className="surface-panel motion-enter px-5 py-5 md:px-6 md:py-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Month</p>
                <h2 className="mt-1 text-2xl font-black">{monthGroup.label}</h2>
              </div>
              <div className="rounded-full bg-surface-elevated px-4 py-2 text-xs font-extrabold uppercase text-muted-foreground">
                {monthGroup.days.length} dates
              </div>
            </div>

            <div className="mt-5 space-y-5">
              {monthGroup.days.map((day) => (
                <div key={day.date} className="grid gap-3 lg:grid-cols-[13rem_minmax(0,1fr)]">
                  <div className="rounded-[1.5rem] bg-surface-panel-alt px-4 py-4">
                    <p className="eyebrow">Date</p>
                    <p className="mt-2 text-lg font-black">{formatDisplayDate(day.date)}</p>
                  </div>
                  <div className="space-y-3">
                    {day.workouts.map((workout) => (
                      <WorkoutListItem key={workout.slug} workout={workout} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
