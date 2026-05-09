import { useEffect, useMemo, useRef, useState } from "react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PlanAnalysisTimeline as PlanAnalysisTimelineData } from "@/lib/workouts/schema";

interface PlanAnalysisTimelineProps {
  timeline: PlanAnalysisTimelineData | null;
  onLinkClick?: (href: string) => boolean;
}

export function PlanAnalysisTimeline({ timeline, onLinkClick }: PlanAnalysisTimelineProps) {
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);
  const closeTimeoutRef = useRef<number | null>(null);
  const entries = useMemo(
    () =>
      [...(timeline?.entries ?? [])].sort((left, right) =>
        left.date === right.date ? left.id.localeCompare(right.id) : left.date.localeCompare(right.date),
      ),
    [timeline?.entries],
  );

  useEffect(
    () => () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    },
    [],
  );

  if (!timeline || entries.length === 0) {
    return null;
  }

  const keepOpen = (entryId: string) => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }

    setOpenEntryId(entryId);
  };

  const scheduleClose = (entryId: string) => {
    if (closeTimeoutRef.current !== null) {
      window.clearTimeout(closeTimeoutRef.current);
    }

    closeTimeoutRef.current = window.setTimeout(() => {
      setOpenEntryId((currentEntryId) => (currentEntryId === entryId ? null : currentEntryId));
      closeTimeoutRef.current = null;
    }, 120);
  };

  return (
    <section className="shrink-0 border-t border-foreground/10 bg-background/95 px-4 py-3 backdrop-blur md:px-6 lg:px-10">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Analysis timeline</p>
          {timeline.sourceSummary ? (
            <p className="mt-1 max-w-3xl text-xs font-medium leading-5 text-muted-foreground">{timeline.sourceSummary}</p>
          ) : null}
        </div>
        <p className="text-xs font-semibold text-muted-foreground">Updated {formatDateLabel(timeline.updatedAt)}</p>
      </div>

      <div className="app-scroll-pane overflow-x-auto pb-1 pt-2">
        <ol className="relative flex min-w-max items-start gap-6 px-1 pt-3">
          <li aria-hidden="true" className="absolute left-3 right-3 top-6 h-px bg-foreground/15" />
          {entries.map((entry) => (
            <li key={entry.id} className="relative flex w-48 flex-col items-start gap-2">
              <Popover
                open={openEntryId === entry.id}
                onOpenChange={(open) => setOpenEntryId(open ? entry.id : null)}
              >
                <PopoverTrigger asChild>
                  <button
                    aria-label={`${entry.title}, ${formatEntryDateLabel(entry)}`}
                    className="group relative z-10 flex size-6 items-center justify-center rounded-full border border-primary/40 bg-background text-primary shadow-sm outline-none transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    type="button"
                    onBlur={() => scheduleClose(entry.id)}
                    onFocus={() => keepOpen(entry.id)}
                    onMouseEnter={() => keepOpen(entry.id)}
                    onMouseLeave={() => scheduleClose(entry.id)}
                  >
                    <span className="size-2.5 rounded-full bg-primary transition-transform group-hover:scale-125" />
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="center"
                  className="w-[min(30rem,calc(100vw-2rem))] p-0"
                  side="top"
                  sideOffset={10}
                  onMouseEnter={() => keepOpen(entry.id)}
                  onMouseLeave={() => scheduleClose(entry.id)}
                >
                  <div className="border-b border-foreground/10 px-4 py-3">
                    <p className="eyebrow">{formatEntryDateLabel(entry)}</p>
                    <h3 className="mt-1 text-base font-black leading-snug">{entry.title}</h3>
                    {entry.summary ? (
                      <p className="mt-2 text-sm font-medium leading-6 text-muted-foreground">{entry.summary}</p>
                    ) : null}
                  </div>
                  {Object.keys(entry.metrics).length > 0 ? (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-foreground/10 px-4 py-3 text-xs">
                      {Object.entries(entry.metrics).map(([metric, value]) => (
                        <div key={metric}>
                          <dt className="font-bold text-muted-foreground">{formatMetricLabel(metric)}</dt>
                          <dd className="mt-0.5 font-extrabold text-foreground">{formatMetricValue(metric, value)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  <div className="app-scroll-pane max-h-[min(22rem,58vh)] overflow-y-auto px-4 py-3">
                    <div className="markdown-prose text-sm">
                      <MarkdownContent content={entry.analysis} onLinkClick={onLinkClick} />
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <div>
                <p className="text-xs font-extrabold text-foreground">{formatCompactDateLabel(entry.date)}</p>
                <p className="mt-0.5 line-clamp-2 text-sm font-bold leading-5 text-foreground">{entry.title}</p>
                {entry.category ? <p className="mt-1 text-[11px] font-bold uppercase text-muted-foreground">{entry.category}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

type TimelineEntry = PlanAnalysisTimelineData["entries"][number];

function formatEntryDateLabel(entry: TimelineEntry) {
  if (entry.period) {
    return `${formatDateLabel(entry.period.start)} to ${formatDateLabel(entry.period.end)}`;
  }

  return formatDateLabel(entry.date);
}

function formatDateLabel(date: string) {
  const parsed = parseDateOnly(date);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

function formatCompactDateLabel(date: string) {
  const parsed = parseDateOnly(date);
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
  }).format(parsed);
}

function parseDateOnly(date: string) {
  const [year = "1970", month = "1", day = "1"] = date.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function formatMetricLabel(key: string) {
  return key
    .replace(/_/gu, " ")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Za-z])([0-9])/gu, "$1 $2")
    .replace(/([0-9])([A-Za-z])/gu, "$1 $2")
    .replace(/\bkm\b/giu, "km")
    .replace(/\bbpm\b/giu, "bpm")
    .replace(/^./u, (firstLetter) => firstLetter.toUpperCase());
}

function formatMetricValue(key: string, value: string | number | boolean | null) {
  if (value === null) {
    return "None";
  }

  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (typeof value === "number") {
    if (/km$/iu.test(key)) {
      return `${value.toLocaleString("en-AU")} km`;
    }

    if (/bpm$/iu.test(key)) {
      return `${value.toLocaleString("en-AU")} bpm`;
    }

    return value.toLocaleString("en-AU");
  }

  return value;
}
