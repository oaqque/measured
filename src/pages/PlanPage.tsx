import { FileCode2, FolderKanban, Route } from "lucide-react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { allWorkouts, formatDistance, trainingPlan } from "@/lib/workouts/load";

const totalDistance = Math.round(
  allWorkouts.reduce((sum, workout) => sum + (workout.expectedDistanceKm ?? 0), 0) * 10,
) / 10;

export function PlanPage() {
  return (
    <div className="space-y-6">
      <section className="surface-panel motion-enter px-6 py-7 md:px-8 md:py-9">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <div className="space-y-3">
            <p className="eyebrow">Plan document</p>
            <h1 className="text-4xl leading-none font-black md:text-6xl">{trainingPlan.title}</h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              The plan page renders the source README directly, so the editorial workflow stays in
              your configured markdown directory.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <InfoTile icon={FolderKanban} label="Workout notes" value={String(allWorkouts.length)} />
            <InfoTile icon={Route} label="Planned distance" value={formatDistance(totalDistance)} />
            <InfoTile icon={FileCode2} label="Source" value="README.md" />
          </div>
        </div>
      </section>

      <article className="surface-panel-alt motion-enter px-6 py-6 md:px-8">
        <div className="markdown-prose">
          <MarkdownContent content={trainingPlan.body} />
        </div>
      </article>
    </div>
  );
}

function InfoTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof FolderKanban;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.5rem] bg-surface-elevated px-4 py-4">
      <div className="flex items-center gap-2 text-xs font-extrabold uppercase text-muted-foreground">
        <Icon className="size-4" />
        <span>{label}</span>
      </div>
      <p className="mt-2 text-sm leading-6 font-semibold text-foreground">{value}</p>
    </div>
  );
}
