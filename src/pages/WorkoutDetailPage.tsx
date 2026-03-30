import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, NotebookPen } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { MarkdownContent } from "@/components/MarkdownContent";
import { buttonVariants } from "@/components/ui/button";
import {
  formatCompletedTimestamp,
  formatDisplayDate,
  formatDistance,
  getAdjacentWorkouts,
  getWorkoutBySlug,
} from "@/lib/workouts/load";
import { cn } from "@/lib/utils";

export function WorkoutDetailPage() {
  const { slug = "" } = useParams();
  const workout = getWorkoutBySlug(slug);

  if (!workout) {
    return (
      <div className="surface-panel-alt motion-enter px-6 py-6">
        <p className="eyebrow">Missing workout</p>
        <h1 className="mt-2 text-3xl font-black">That workout note was not found.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          The source markdown may have been renamed or removed since the build artifact was last
          generated.
        </p>
        <Link className={cn(buttonVariants(), "mt-5")} to="/calendar">
          Back to calendar
        </Link>
      </div>
    );
  }

  const { previous, next } = getAdjacentWorkouts(slug);

  return (
    <div className="space-y-6">
      <section className="surface-hero motion-enter px-6 py-7 md:px-8 md:py-9">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-4">
            <Link className={cn(buttonVariants({ variant: "ghost", size: "sm" }))} to="/calendar">
              <ArrowLeft className="size-4" />
              Back to calendar
            </Link>
            <div className="space-y-3">
              <p className="eyebrow">Workout note</p>
              <h1 className="max-w-3xl text-4xl leading-none font-black md:text-6xl">
                {workout.title}
              </h1>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <MetaTile icon={CalendarDays} label="Scheduled date" value={formatDisplayDate(workout.date)} />
            <MetaTile icon={CheckCircle2} label="Status" value={formatCompletedTimestamp(workout.completed)} />
            <MetaTile icon={NotebookPen} label="Expected distance" value={formatDistance(workout.expectedDistanceKm)} />
            <MetaTile icon={NotebookPen} label="Source file" value={workout.sourcePath} />
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)]">
        <div className="surface-panel motion-enter p-5 md:p-6">
          <p className="eyebrow">Workout metadata</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Pill>{workout.eventType}</Pill>
            <Pill>{workout.type}</Pill>
            <Pill>{workout.allDay ? "all day" : "timed"}</Pill>
          </div>

          <div className="mt-6 grid gap-3">
            {previous ? (
              <AdjacentCard
                direction="Previous"
                icon={ArrowLeft}
                slug={previous.slug}
                title={previous.title}
                date={formatDisplayDate(previous.date)}
              />
            ) : null}
            {next ? (
              <AdjacentCard
                direction="Next"
                icon={ArrowRight}
                slug={next.slug}
                title={next.title}
                date={formatDisplayDate(next.date)}
              />
            ) : null}
          </div>
        </div>

        <article className="surface-panel motion-enter px-6 py-6 md:px-8">
          <p className="eyebrow">Rendered markdown</p>
          <div className="markdown-prose mt-5">
            <MarkdownContent content={workout.body} />
          </div>
        </article>
      </section>
    </div>
  );
}

function MetaTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.5rem] bg-surface-panel px-4 py-4">
      <div className="flex items-center gap-2 text-xs font-extrabold uppercase text-muted-foreground">
        <Icon className="size-4" />
        <span>{label}</span>
      </div>
      <p className="mt-2 text-sm leading-6 font-semibold text-foreground">{value}</p>
    </div>
  );
}

function AdjacentCard({
  direction,
  icon: Icon,
  slug,
  title,
  date,
}: {
  direction: string;
  icon: typeof ArrowLeft;
  slug: string;
  title: string;
  date: string;
}) {
  return (
    <Link className="rounded-[1.5rem] bg-surface-elevated px-4 py-4 transition-colors hover:bg-white" to={`/workouts/${slug}`}>
      <div className="flex items-center gap-2 text-xs font-extrabold uppercase text-muted-foreground">
        <Icon className="size-4" />
        <span>{direction}</span>
      </div>
      <p className="mt-2 font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{date}</p>
    </Link>
  );
}

function Pill({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-surface-elevated px-3 py-1.5 text-xs font-extrabold uppercase text-foreground">
      {children}
    </span>
  );
}
