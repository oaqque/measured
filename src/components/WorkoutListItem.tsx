import { ArrowUpRight, CheckCircle2, Clock3 } from "lucide-react";
import { Link } from "react-router-dom";
import type { WorkoutNote } from "@/lib/workouts/schema";
import {
  formatCompletedTimestamp,
  formatDistance,
  formatShortDate,
} from "@/lib/workouts/load";

interface WorkoutListItemProps {
  workout: WorkoutNote;
}

export function WorkoutListItem({ workout }: WorkoutListItemProps) {
  const isCompleted = workout.completed !== null;

  return (
    <Link
      className="group flex items-start justify-between gap-4 rounded-[1.75rem] bg-surface-elevated px-5 py-4 transition-colors hover:bg-white"
      to={`/workouts/${workout.slug}`}
    >
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-extrabold uppercase text-muted-foreground">
          <span>{formatShortDate(workout.date)}</span>
          <span className="rounded-full bg-surface-panel px-2.5 py-1 text-[11px] text-foreground">
            {workout.eventType}
          </span>
          <span className="rounded-full bg-surface-panel px-2.5 py-1 text-[11px] text-foreground">
            {formatDistance(workout.expectedDistanceKm)}
          </span>
        </div>
        <div>
          <p className="text-base font-semibold text-foreground">{workout.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {isCompleted ? formatCompletedTimestamp(workout.completed) : "Still planned"}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-muted-foreground transition-colors group-hover:text-foreground">
        {isCompleted ? <CheckCircle2 className="size-4" /> : <Clock3 className="size-4" />}
        <ArrowUpRight className="size-4" />
      </div>
    </Link>
  );
}
