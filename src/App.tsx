import type { CSSProperties } from "react";
import { CalendarDays, NotebookText } from "lucide-react";
import { MarkdownContent } from "@/components/MarkdownContent";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  allWorkouts,
  formatCompletedTimestamp,
  formatDisplayDate,
  formatDistance,
  generatedAt,
  getUpcomingWorkouts,
  trainingPlan,
} from "@/lib/workouts/load";

export default function App() {
  const upcomingWorkouts = getUpcomingWorkouts();

  return (
    <div className="min-h-screen bg-page text-foreground">
      <div className="mx-auto grid min-h-screen w-full max-w-7xl lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="border-b border-foreground/10 px-4 py-6 md:px-6 lg:min-h-screen lg:border-r lg:border-b-0 lg:px-8 lg:py-8">
          <div className="lg:sticky lg:top-0 lg:pt-2">
            <div className="mx-auto w-full max-w-44">
              <SportShoeIcon className="block h-auto w-full text-foreground" />
            </div>

            <div className="mt-5 text-center">
              <p className="text-3xl font-black md:text-4xl">measured.</p>
            </div>

            <nav className="mt-8 space-y-2 border-t border-foreground/10 pt-6 text-sm">
              <a className="block font-semibold text-foreground transition-colors hover:text-primary" href="#plan">
                Plan
              </a>
              <a
                className="block font-semibold text-foreground transition-colors hover:text-primary"
                href="#upcoming"
              >
                Upcoming workouts
              </a>
            </nav>

            <dl className="mt-8 grid gap-5 border-t border-foreground/10 pt-6 text-sm">
              <MetadataRow label="Workouts loaded" value={String(allWorkouts.length)} />
              <MetadataRow label="Plan source" value={trainingPlan.sourcePath} />
              <MetadataRow label="Generated" value={formatTimestamp(generatedAt)} />
            </dl>
          </div>
        </aside>

        <main className="px-4 py-6 md:px-6 md:py-8 lg:px-10 lg:py-10">
        <section className="py-2" id="plan">
          <div className="mb-3 flex items-center gap-2">
            <NotebookText className="size-4 text-muted-foreground" />
            <p className="eyebrow">Plan</p>
          </div>
          <Accordion collapsible type="single">
            <AccordionItem value="plan">
              <AccordionTrigger className="py-5 text-base font-semibold">
                <div>
                  <p className="text-lg font-black md:text-2xl">{trainingPlan.title}</p>
                  <p className="mt-1 text-sm font-normal text-muted-foreground">
                    Expand to read the full plan source.
                  </p>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="border-t border-foreground/10 pt-5">
                  <dl className="mb-6 grid gap-3 text-sm sm:grid-cols-2">
                    <MetadataRow label="Source file" value={trainingPlan.sourcePath} />
                    <MetadataRow label="Generated at" value={formatTimestamp(generatedAt)} />
                  </dl>
                  <div className="markdown-prose">
                    <MarkdownContent content={trainingPlan.body} />
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>

        <section className="py-8" id="upcoming">
          <div className="mb-3 flex items-center gap-2">
            <CalendarDays className="size-4 text-muted-foreground" />
            <p className="eyebrow">Upcoming Workouts</p>
          </div>
          <div className="border-t border-foreground/10">
            {upcomingWorkouts.map((workout) => (
              <article className="border-b border-foreground/10 py-5" key={workout.slug}>
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <h2 className="text-xl font-black md:text-2xl">{workout.title}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {formatDisplayDate(workout.date)}
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">{formatCompletedTimestamp(workout.completed)}</p>
                  </div>

                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                    <MetadataRow label="Event type" value={workout.eventType} />
                    <MetadataRow label="Expected distance" value={formatDistance(workout.expectedDistanceKm)} />
                    <MetadataRow label="Status" value={formatCompletedTimestamp(workout.completed)} />
                    <MetadataRow label="All day" value={workout.allDay ? "Yes" : "No"} />
                    <MetadataRow label="Type" value={workout.type} />
                    <MetadataRow label="Source file" value={workout.sourcePath} />
                  </dl>

                  <Accordion collapsible type="single">
                    <AccordionItem value={workout.slug}>
                      <AccordionTrigger className="py-3">
                        <span>Workout notes</span>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="markdown-prose border-t border-foreground/10 pt-4">
                          <MarkdownContent content={workout.body} />
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </article>
            ))}
          </div>
        </section>
        </main>
      </div>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="eyebrow">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

const FINGERPRINT_STROKES = [
  { color: "#1d2a6d", d: "M2 12a10 10 0 0 1 18-6" },
  { color: "#24479d", d: "M9 6.8a6 6 0 0 1 9 5.2v2" },
  { color: "#1f63d2", d: "M21.8 16c.2-2 .131-5.354 0-6" },
  { color: "#2388ef", d: "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" },
  { color: "#39b8ff", d: "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" },
  { color: "#63ddff", d: "M14 13.12c0 2.38 0 6.38-1 8.88" },
  { color: "#8ef2ff", d: "M17.29 21.02c.12-.6.43-2.3.5-3.02" },
  { color: "#c6fbff", d: "M8.65 22c.21-.66.45-1.32.57-2" },
  { color: "#ffffff", d: "M2 16h.01" },
] as const;

function SportShoeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g>
        {FINGERPRINT_STROKES.map((stroke, index) => (
          <path
            className="fingerprint-stroke"
            d={stroke.d}
            key={stroke.d}
            pathLength="1"
            style={
              {
                "--fingerprint-delay": `${index * -0.2}s`,
                "--fingerprint-stroke": stroke.color,
              } as CSSProperties
            }
          />
        ))}
      </g>
    </svg>
  );
}
