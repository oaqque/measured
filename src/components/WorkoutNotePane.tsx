import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { RouteMap } from "@/components/RouteMap";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { WorkoutShareButton } from "@/components/WorkoutShareButton";
import {
  formatCompletedTimestamp,
  formatDisplayDate,
  formatDistance,
  generatedAt,
} from "@/lib/workouts/load";
import type { WorkoutDataSource, WorkoutEventType, WorkoutNote } from "@/lib/workouts/schema";
import { cn } from "@/lib/utils";

const WORKOUT_EVENT_TYPE_LABELS: Record<WorkoutEventType, string> = {
  basketball: "Basketball",
  mobility: "Mobility",
  race: "Race",
  run: "Run",
  strength: "Strength",
};

const WORKOUT_SOURCE_BADGE_META: Record<
  WorkoutDataSource,
  {
    badgeSrc: string;
    className: string;
    label: string;
  }
> = {
  "apple-health": {
    badgeSrc: "/source-badges/apple-health-app-icon.png",
    className: "size-4",
    label: "Apple Health",
  },
  strava: {
    badgeSrc: "/source-badges/powered-by-strava.svg",
    className: "h-3.5 w-[2.625rem]",
    label: "Strava",
  },
};

export default function WorkoutNotePane({
  workout,
  onBack,
  onLinkClick,
}: {
  workout: WorkoutNote;
  onBack: () => void;
  onLinkClick: (href: string) => boolean;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setIsClosing(false);
  }, [workout.slug]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const handleBack = () => {
    if (isClosing) {
      return;
    }

    setIsClosing(true);
    closeTimeoutRef.current = window.setTimeout(() => {
      closeTimeoutRef.current = null;
      onBack();
    }, 220);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", isClosing ? "motion-exit" : "motion-enter")}>
      <div className="mb-4 border-b border-foreground/10 pb-4">
        <Button
          aria-label="Back to calendar"
          className="size-9 rounded-[0.35rem] p-0"
          type="button"
          variant="secondary"
          onClick={handleBack}
        >
          <ArrowLeft className="size-4" />
          <span className="sr-only">Back to calendar</span>
        </Button>
      </div>

      <div className="app-scroll-pane min-h-0 flex-1 overflow-y-auto">
        <WorkoutDetailPanel workout={workout} onLinkClick={onLinkClick} />
      </div>
    </div>
  );
}

function WorkoutDetailPanel({
  workout,
  onLinkClick,
}: {
  workout: WorkoutNote;
  onLinkClick: (href: string) => boolean;
}) {
  const dataSourceMeta = getWorkoutDataSourceMeta(workout.dataSource);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-4 border-b border-foreground/10 pb-4">
        <div className="min-w-0">
          <p className="eyebrow">Workout Note</p>
          <h2 className="mt-2 text-2xl font-black">{workout.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{formatDisplayDate(workout.date)}</p>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <WorkoutShareButton slug={workout.slug} title={workout.title} />
          {dataSourceMeta ? (
            <div
              aria-label={`Data source: ${dataSourceMeta.label}`}
              className="flex h-9 items-center"
              title={dataSourceMeta.label}
            >
              <img
                alt=""
                aria-hidden="true"
                className={cn("block h-auto max-w-full object-contain", dataSourceMeta.className)}
                src={dataSourceMeta.badgeSrc}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-5 lg:hidden">
        <Accordion className="border-b border-foreground/10" collapsible type="single">
          <AccordionItem className="border-b-0" value="metadata">
            <AccordionTrigger className="py-3 text-base font-semibold">
              Metadata
            </AccordionTrigger>
            <AccordionContent>
              <WorkoutMetadataGrid workout={workout} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {workout.summaryPolyline ? (
          <div className="mt-5 border-b border-foreground/10 pb-5">
            <RouteMap
              activityId={workout.stravaId}
              generatedAt={generatedAt}
              hasStravaStreams={workout.hasStravaStreams}
              polyline={workout.summaryPolyline}
              title={workout.title}
            />
          </div>
        ) : null}

        <div className="markdown-prose mt-5 flex-1">
          <MarkdownContent content={workout.body} onLinkClick={onLinkClick} />
        </div>
      </div>

      <div className="hidden lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="min-w-0">
          <div className="markdown-prose">
            <MarkdownContent content={workout.body} onLinkClick={onLinkClick} />
          </div>
        </div>

        <aside className="space-y-5 pt-6">
          {workout.summaryPolyline ? (
            <section>
              <RouteMap
                activityId={workout.stravaId}
                generatedAt={generatedAt}
                hasStravaStreams={workout.hasStravaStreams}
                polyline={workout.summaryPolyline}
                title={workout.title}
              />
            </section>
          ) : null}

          <section>
            <p className="eyebrow">Metadata</p>
            <WorkoutMetadataGrid className="mt-4 pt-0" workout={workout} />
          </section>
        </aside>
      </div>
    </div>
  );
}

function WorkoutMetadataGrid({
  className,
  workout,
}: {
  className?: string;
  workout: WorkoutNote;
}) {
  return (
    <div className={cn("grid gap-4 pt-1 text-sm", className)}>
      <MetadataRow label="Event type" value={WORKOUT_EVENT_TYPE_LABELS[workout.eventType]} />
      <MetadataRow label="Expected distance" value={formatDistance(workout.expectedDistanceKm)} />
      <MetadataRow label="Actual distance" value={formatDistance(workout.actualDistanceKm)} />
      <MetadataRow label="Status" value={formatCompletedTimestamp(workout.completed)} />
      <MetadataRow
        label="Strava activity"
        value={workout.stravaId === null ? "Not linked" : String(workout.stravaId)}
      />
      <MetadataRow label="All day" value={workout.allDay ? "Yes" : "No"} />
      <MetadataRow label="Type" value={workout.type} />
      <MetadataRow label="Source file" value={workout.sourcePath} />
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

function getWorkoutDataSourceMeta(dataSource: WorkoutDataSource | null) {
  if (!dataSource) {
    return null;
  }

  return WORKOUT_SOURCE_BADGE_META[dataSource];
}
