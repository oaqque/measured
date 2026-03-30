import { ArrowRight, CalendarRange, NotebookText, TimerReset } from "lucide-react";
import { Link } from "react-router-dom";
import { WorkoutListItem } from "@/components/WorkoutListItem";
import { buttonVariants } from "@/components/ui/button";
import {
  allWorkouts,
  formatDistance,
  formatRange,
  getCurrentBlockSummary,
  getRecentCompletedWorkouts,
  getUpcomingWorkouts,
  trainingPlan,
} from "@/lib/workouts/load";
import { cn } from "@/lib/utils";

const upcomingWorkouts = getUpcomingWorkouts();
const recentCompletedWorkouts = getRecentCompletedWorkouts();
const currentBlock = getCurrentBlockSummary();
const planExcerpt = trainingPlan.body.split("\n\n").slice(2, 4).join("\n\n");

export function OverviewPage() {
  return (
    <div className="space-y-6">
      <section className="surface-hero motion-enter overflow-hidden px-6 py-7 md:px-8 md:py-9">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.9fr)]">
          <div className="space-y-5">
            <div className="space-y-3">
              <p className="eyebrow">Training dashboard</p>
              <h1 className="max-w-3xl text-4xl leading-none font-black text-foreground md:text-6xl">
                Read the marathon block without leaving the markdown source of truth.
              </h1>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">
                {trainingPlan.title} stays in your markdown source directory. This app ingests
                those notes at build time from a configurable path and makes the schedule easier to
                scan.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link className={buttonVariants()} to="/calendar">
                Open calendar
                <CalendarRange className="size-4" />
              </Link>
              <Link className={buttonVariants({ variant: "secondary" })} to="/plan">
                Read plan
                <NotebookText className="size-4" />
              </Link>
            </div>
          </div>

          <div className="surface-panel grid gap-3 p-5 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Current block</p>
                <p className="mt-2 text-2xl font-black">{formatRange(currentBlock.rangeStart, currentBlock.rangeEnd)}</p>
              </div>
              <TimerReset className="size-8 text-foreground/70" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricTile label="Sessions" value={String(currentBlock.sessions)} />
              <MetricTile label="Planned load" value={formatDistance(currentBlock.plannedDistanceKm)} />
              <MetricTile label="Completed" value={String(currentBlock.completedSessions)} />
              <MetricTile label="Races" value={String(currentBlock.raceCount)} />
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="surface-panel motion-enter p-5 md:p-6">
          <SectionHeader
            actionLabel="See full calendar"
            actionTo="/calendar"
            title="Upcoming workouts"
          />
          <div className="mt-5 space-y-3">
            {upcomingWorkouts.map((workout) => (
              <WorkoutListItem key={workout.slug} workout={workout} />
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="surface-panel-alt motion-enter p-5 md:p-6">
            <SectionHeader title="Recent completions" />
            <div className="mt-5 space-y-3">
              {recentCompletedWorkouts.map((workout) => (
                <WorkoutListItem key={workout.slug} workout={workout} />
              ))}
            </div>
          </div>

          <div className="surface-panel motion-enter p-5 md:p-6">
            <SectionHeader actionLabel="Open plan" actionTo="/plan" title="Plan context" />
            <p className="mt-5 text-sm leading-6 whitespace-pre-line text-muted-foreground">
              {planExcerpt}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <MetricTile label="Workout notes" value={String(allWorkouts.length)} />
              <MetricTile
                label="Completed notes"
                value={String(allWorkouts.filter((workout) => workout.completed !== null).length)}
              />
              <MetricTile label="Source file" value="README.md" />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] bg-surface-elevated px-4 py-4">
      <p className="eyebrow">{label}</p>
      <p className="mt-2 text-2xl leading-none font-black text-foreground">{value}</p>
    </div>
  );
}

function SectionHeader({
  title,
  actionLabel,
  actionTo,
}: {
  title: string;
  actionLabel?: string;
  actionTo?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="eyebrow">Section</p>
        <h2 className="mt-1 text-2xl font-black text-foreground">{title}</h2>
      </div>
      {actionLabel && actionTo ? (
        <Link className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "shrink-0")} to={actionTo}>
          {actionLabel}
          <ArrowRight className="size-4" />
        </Link>
      ) : null}
    </div>
  );
}
