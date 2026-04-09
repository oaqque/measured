import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MarkdownContent } from "@/components/MarkdownContent";
import { RouteMap } from "@/components/RouteMap";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { WorkoutShareButton } from "@/components/WorkoutShareButton";
import {
  loadAppleHealthWorkoutMeasurements,
} from "@/lib/workouts/apple-health";
import {
  formatCompletedTimestamp,
  formatDisplayDate,
  formatDistance,
  generatedAt,
  loadWorkoutSourceDetails,
} from "@/lib/workouts/load";
import type {
  AppleHealthMeasurementSeries,
  AppleHealthWorkoutMeasurements,
  WorkoutDataSource,
  WorkoutEventType,
  WorkoutNote,
  WorkoutProvider,
  WorkoutSourceSummary,
  WorkoutWeather,
} from "@/lib/workouts/schema";
import { cn } from "@/lib/utils";

type WorkoutDetailTab = "note" | "appleHealth" | "appleHealthRecovery";

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
  const [activeTab, setActiveTab] = useState<WorkoutDetailTab>("note");
  const [loadedSources, setLoadedSources] = useState<Partial<Record<WorkoutProvider, WorkoutSourceSummary>> | null>(
    workout.sources ?? null,
  );
  const [sourceDetailsLoaded, setSourceDetailsLoaded] = useState(Boolean(workout.sources));
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    setIsClosing(false);
    setActiveTab("note");
  }, [workout.slug]);

  useEffect(() => {
    let cancelled = false;
    setLoadedSources(workout.sources ?? null);
    setSourceDetailsLoaded(Boolean(workout.sources));

    loadWorkoutSourceDetails(workout.slug)
      .then((sources) => {
        if (cancelled) {
          return;
        }

        setLoadedSources(sources);
        setSourceDetailsLoaded(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setLoadedSources(null);
        setSourceDetailsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [workout.slug, workout.sources]);

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
        <WorkoutDetailPanel
          activeTab={activeTab}
          loadedSources={loadedSources}
          setActiveTab={setActiveTab}
          sourceDetailsLoaded={sourceDetailsLoaded}
          workout={workout}
          onLinkClick={onLinkClick}
        />
      </div>
    </div>
  );
}

function WorkoutDetailPanel({
  activeTab,
  loadedSources,
  setActiveTab,
  sourceDetailsLoaded,
  workout,
  onLinkClick,
}: {
  activeTab: WorkoutDetailTab;
  loadedSources: Partial<Record<WorkoutProvider, WorkoutSourceSummary>> | null;
  setActiveTab: (tab: WorkoutDetailTab) => void;
  sourceDetailsLoaded: boolean;
  workout: WorkoutNote;
  onLinkClick: (href: string) => boolean;
}) {
  const appleHealthSource = loadedSources?.appleHealth ?? null;
  const showAppleHealthTab = Boolean(workout.activityRefs?.appleHealth) || appleHealthSource !== null;
  const activeBadge =
    activeTab === "appleHealth" || activeTab === "appleHealthRecovery" ? "apple-health" : workout.dataSource;
  const dataSourceMeta = getWorkoutDataSourceMeta(activeBadge);

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

      {showAppleHealthTab ? (
        <div className="mt-5 inline-flex w-fit rounded-[0.6rem] border border-foreground/10 bg-surface-panel-alt p-1">
          <button
            aria-pressed={activeTab === "note"}
            className={cn(
              "rounded-[0.45rem] px-3 py-2 text-sm font-semibold transition-colors",
              activeTab === "note" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            type="button"
            onClick={() => setActiveTab("note")}
          >
            Note
          </button>
          <button
            aria-pressed={activeTab === "appleHealth"}
            className={cn(
              "rounded-[0.45rem] px-3 py-2 text-sm font-semibold transition-colors",
              activeTab === "appleHealth" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            type="button"
            onClick={() => setActiveTab("appleHealth")}
          >
            Apple Health
          </button>
          <button
            aria-pressed={activeTab === "appleHealthRecovery"}
            className={cn(
              "rounded-[0.45rem] px-3 py-2 text-sm font-semibold transition-colors",
              activeTab === "appleHealthRecovery" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            type="button"
            onClick={() => setActiveTab("appleHealthRecovery")}
          >
            Recovery
          </button>
        </div>
      ) : null}

      {activeTab === "appleHealth" && appleHealthSource ? (
        <WorkoutSourcePanel
          measurementSection="duringWorkout"
          provider="appleHealth"
          source={appleHealthSource}
          workout={workout}
        />
      ) : activeTab === "appleHealthRecovery" && appleHealthSource ? (
        <WorkoutSourcePanel
          measurementSection="recoveryContext"
          provider="appleHealth"
          source={appleHealthSource}
          workout={workout}
        />
      ) : activeTab === "appleHealth" && showAppleHealthTab && !sourceDetailsLoaded ? (
        <WorkoutSourcePanelSkeleton providerLabel="Apple Health" />
      ) : activeTab === "appleHealthRecovery" && showAppleHealthTab && !sourceDetailsLoaded ? (
        <WorkoutSourcePanelSkeleton providerLabel="Apple Health recovery" />
      ) : (activeTab === "appleHealth" || activeTab === "appleHealthRecovery") && showAppleHealthTab ? (
        <WorkoutSourcePanelUnavailable providerLabel="Apple Health" />
      ) : (
        <WorkoutNarrativePanel loadedSources={loadedSources} workout={workout} onLinkClick={onLinkClick} />
      )}
    </div>
  );
}

function WorkoutNarrativePanel({
  loadedSources,
  workout,
  onLinkClick,
}: {
  loadedSources: Partial<Record<WorkoutProvider, WorkoutSourceSummary>> | null;
  workout: WorkoutNote;
  onLinkClick: (href: string) => boolean;
}) {
  const displaySource = getNoteDisplaySource(workout, loadedSources);
  const routeActivityId =
    displaySource?.provider === "strava"
      ? normalizeNumericActivityId(displaySource.activityId)
      : workout.stravaId;
  const routePath = displaySource?.routePath ?? null;
  const routePolyline = displaySource?.summaryPolyline ?? workout.summaryPolyline;
  const hasRouteStreams = displaySource?.hasRouteStreams ?? workout.hasStravaStreams;
  const imageUrl = displaySource?.primaryImageUrl ?? workout.primaryImageUrl;
  const hasRoutePanel = routePolyline !== null || (hasRouteStreams && (routePath !== null || routeActivityId !== null));

  return (
    <>
      {imageUrl ? (
        <div className="mt-5 overflow-hidden rounded-[1rem] border border-foreground/10 bg-surface-elevated">
          <img
            alt={`Workout image for ${workout.title}`}
            className="block max-h-[32rem] w-full object-contain"
            loading="lazy"
            src={imageUrl}
          />
        </div>
      ) : null}

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

        {hasRoutePanel ? (
          <div className="mt-5 border-b border-foreground/10 pb-5">
            <RouteMap
              activityId={routeActivityId}
              generatedAt={generatedAt}
              hasRouteStreams={hasRouteStreams}
              polyline={routePolyline ?? ""}
              routePath={routePath}
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
          {hasRoutePanel ? (
            <section>
              <RouteMap
                activityId={routeActivityId}
                generatedAt={generatedAt}
                hasRouteStreams={hasRouteStreams}
                polyline={routePolyline ?? ""}
                routePath={routePath}
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
    </>
  );
}

function WorkoutSourcePanel({
  measurementSection,
  provider,
  source,
  workout,
}: {
  measurementSection?: AppleHealthMeasurementSeries["section"];
  provider: WorkoutProvider;
  source: WorkoutSourceSummary;
  workout: WorkoutNote;
}) {
  const providerLabel = getWorkoutProviderLabel(provider);
  const hasRoutePanel = source.summaryPolyline !== null || (source.hasRouteStreams && source.routePath !== null);
  const [measurements, setMeasurements] = useState<AppleHealthWorkoutMeasurements | null>(null);
  const [measurementsLoaded, setMeasurementsLoaded] = useState(provider !== "appleHealth");

  useEffect(() => {
    let cancelled = false;

    if (provider !== "appleHealth") {
      setMeasurements(null);
      setMeasurementsLoaded(true);
      return () => {
        cancelled = true;
      };
    }

    setMeasurements(null);
    setMeasurementsLoaded(false);
    loadAppleHealthWorkoutMeasurements(source.activityId, generatedAt)
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setMeasurements(payload);
        setMeasurementsLoaded(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setMeasurements(null);
        setMeasurementsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [provider, source.activityId]);

  return (
    <>
      {source.primaryImageUrl ? (
        <div className="mt-5 overflow-hidden rounded-[1rem] border border-foreground/10 bg-surface-elevated">
          <img
            alt={`${providerLabel} activity image for ${workout.title}`}
            className="block max-h-[32rem] w-full object-contain"
            loading="lazy"
            src={source.primaryImageUrl}
          />
        </div>
      ) : null}

      <div className="mt-5 lg:hidden">
        <Accordion className="border-b border-foreground/10" collapsible type="single">
          <AccordionItem className="border-b-0" value="metadata">
            <AccordionTrigger className="py-3 text-base font-semibold">
              {providerLabel} metadata
            </AccordionTrigger>
            <AccordionContent>
              <WorkoutSourceMetadataGrid provider={provider} source={source} />
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {provider === "appleHealth" ? (
          <div className="mt-5">
            <AppleHealthMeasurementsSection
              measurements={measurements}
              measurementsLoaded={measurementsLoaded}
              section={measurementSection ?? "duringWorkout"}
            />
          </div>
        ) : null}

        {hasRoutePanel ? (
          <div className="mt-5 border-b border-foreground/10 pb-5">
            <RouteMap
              activityId={provider === "strava" ? normalizeNumericActivityId(source.activityId) : null}
              generatedAt={generatedAt}
              hasRouteStreams={source.hasRouteStreams}
              polyline={source.summaryPolyline ?? ""}
              routePath={source.routePath}
              title={`${workout.title} (${providerLabel})`}
            />
          </div>
        ) : null}
      </div>

      <div className="hidden lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="min-w-0 space-y-5 pt-6">
          {provider === "appleHealth" ? (
            <AppleHealthMeasurementsSection
              measurements={measurements}
              measurementsLoaded={measurementsLoaded}
              section={measurementSection ?? "duringWorkout"}
            />
          ) : null}
        </div>

        <aside className="space-y-5 pt-6">
          {hasRoutePanel ? (
            <section>
              <RouteMap
                activityId={provider === "strava" ? normalizeNumericActivityId(source.activityId) : null}
                generatedAt={generatedAt}
                hasRouteStreams={source.hasRouteStreams}
                polyline={source.summaryPolyline ?? ""}
                routePath={source.routePath}
                title={`${workout.title} (${providerLabel})`}
              />
            </section>
          ) : null}

          <section>
            <p className="eyebrow">{providerLabel} metadata</p>
            <WorkoutSourceMetadataGrid className="mt-4 pt-0" provider={provider} source={source} />
          </section>
        </aside>
      </div>
    </>
  );
}

function WorkoutMetadataGrid({
  className,
  workout,
}: {
  className?: string;
  workout: WorkoutNote;
}) {
  const weatherRows = getWorkoutWeatherRows(workout.weather);
  const appleHealthActivityId = workout.activityRefs?.appleHealth ?? null;

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
      {appleHealthActivityId ? (
        <MetadataRow label="Apple Health activity" value={appleHealthActivityId} />
      ) : null}
      <MetadataRow label="All day" value={workout.allDay ? "Yes" : "No"} />
      <MetadataRow label="Type" value={workout.type} />
      {weatherRows.map((row) => (
        <MetadataRow key={row.label} label={row.label} value={row.value} />
      ))}
      <MetadataRow label="Source file" value={workout.sourcePath} />
    </div>
  );
}

function WorkoutSourceMetadataGrid({
  className,
  provider,
  source,
}: {
  className?: string;
  provider: WorkoutProvider;
  source: WorkoutSourceSummary;
}) {
  const providerLabel = getWorkoutProviderLabel(provider);
  const startedAt = formatSourceTimestamp(source.startDate);
  const movingTime = formatDuration(source.movingTimeSeconds);
  const elapsedTime = formatDuration(source.elapsedTimeSeconds);
  const showProviderIdentityRows = provider !== "appleHealth";

  return (
    <div className={cn("grid gap-4 pt-1 text-sm", className)}>
      <MetadataRow label="Provider" value={providerLabel} />
      {showProviderIdentityRows ? <MetadataRow label="Activity ID" value={source.activityId} /> : null}
      {source.sportType ? <MetadataRow label="Sport type" value={source.sportType} /> : null}
      {startedAt ? <MetadataRow label="Started" value={startedAt} /> : null}
      <MetadataRow label="Distance" value={source.actualDistance ?? formatDistance(source.actualDistanceKm)} />
      {movingTime ? <MetadataRow label="Moving time" value={movingTime} /> : null}
      {elapsedTime ? <MetadataRow label="Elapsed time" value={elapsedTime} /> : null}
      {source.averageHeartrate !== null ? (
        <MetadataRow label="Average HR" value={`${trimTrailingZero(source.averageHeartrate)} bpm`} />
      ) : null}
      {source.maxHeartrate !== null ? (
        <MetadataRow label="Max HR" value={`${trimTrailingZero(source.maxHeartrate)} bpm`} />
      ) : null}
      {showProviderIdentityRows && source.source?.name ? <MetadataRow label="Source app" value={source.source.name} /> : null}
      {showProviderIdentityRows && source.source?.deviceName ? <MetadataRow label="Device" value={source.source.deviceName} /> : null}
      {showProviderIdentityRows && source.source?.deviceModel ? <MetadataRow label="Device model" value={source.source.deviceModel} /> : null}
    </div>
  );
}

function AppleHealthMeasurementsSection({
  measurements,
  measurementsLoaded,
  section,
}: {
  measurements: AppleHealthWorkoutMeasurements | null;
  measurementsLoaded: boolean;
  section: AppleHealthMeasurementSeries["section"];
}) {
  const visibleSeries = measurements?.series.filter((item) => item.section === section) ?? [];

  if (!measurementsLoaded) {
    return (
      <section className="rounded-[1rem] border border-foreground/10 bg-background/40 p-5">
        <p className="eyebrow">Measurements</p>
        <p className="mt-3 text-sm text-muted-foreground">Linking Apple Health samples to this activity…</p>
      </section>
    );
  }

  if (!measurements || measurements.series.length === 0) {
    return (
      <section className="rounded-[1rem] border border-foreground/10 bg-background/40 p-5">
        <p className="eyebrow">Measurements</p>
        <p className="mt-3 text-sm text-muted-foreground">
          {section === "recoveryContext"
            ? "No Apple Health recovery samples were linked to this workout."
            : "No Apple Health measurement samples were linked to this workout window."}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[1rem] border border-foreground/10 bg-background/40 p-5">
      <p className="eyebrow">Measurements</p>
      <div className="mt-4 space-y-6">
        <div className="space-y-5">
          {visibleSeries.map((series) => (
            <AppleHealthMeasurementChart key={series.key} series={series} />
          ))}
        </div>
      </div>
    </section>
  );
}

function AppleHealthMeasurementChart({ series }: { series: AppleHealthMeasurementSeries }) {
  const minValue = series.minValue ?? Math.min(...series.points.map((point) => point.value));
  const maxValue = series.maxValue ?? Math.max(...series.points.map((point) => point.value));
  const offsetRangeLabel = formatMeasurementOffsetRange(series.points);
  const chartData = buildMeasurementChartData(series.points);
  const offsetDomain = getMeasurementOffsetDomain(series.points, series.section);
  const valueDomain = getMeasurementValueDomain(series.points, series.kind);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{series.label}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{getMeasurementSummary(series)}</p>
        </div>
        <p className="text-right text-[11px] text-muted-foreground">
          {series.sampleCount} samples
        </p>
      </div>

      <div className="overflow-hidden rounded-[0.85rem] border border-foreground/10 bg-background/70 p-3">
        <div className="h-40 min-w-0">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 18, bottom: 8, left: 18 }}>
              <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
              <XAxis
                type="number"
                dataKey="offsetSeconds"
                domain={offsetDomain}
                tickFormatter={(value) => formatMeasurementAxisOffset(value, series.section)}
                tick={{ fill: "currentColor", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={12}
                stroke="currentColor"
                strokeOpacity={0.2}
              />
              <YAxis
                type="number"
                domain={valueDomain}
                tickFormatter={(value) => formatMeasurementAxisValue(value, series.unit)}
                tick={{ fill: "currentColor", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={46}
                stroke="currentColor"
                strokeOpacity={0.2}
              />
              <Tooltip
                cursor={series.section === "recoveryContext" ? false : { stroke: "currentColor", strokeOpacity: 0.14 }}
                content={(props) => <MeasurementTooltip {...props} series={series} />}
              />
              {series.section === "recoveryContext" ? (
                <>
                  {chartData
                    .filter((point) => point.previousValue !== null)
                    .map((point) => (
                      <ReferenceLine
                        key={`${series.key}-${point.offsetSeconds}`}
                        ifOverflow="extendDomain"
                        segment={[
                          { x: point.offsetSeconds, y: point.previousValue ?? point.value },
                          { x: point.offsetSeconds, y: point.value },
                        ]}
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeOpacity={0.88}
                        strokeWidth={6}
                      />
                    ))}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="currentColor"
                    strokeOpacity={0.2}
                    strokeWidth={1}
                    dot={{ r: 2, fill: "currentColor", fillOpacity: 0.7, stroke: "none" }}
                    activeDot={{ r: 3, fill: "currentColor", stroke: "none" }}
                    connectNulls
                  />
                </>
              ) : series.kind === "cumulative" ? (
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="currentColor"
                  strokeOpacity={0.9}
                  strokeWidth={1.4}
                  fill="currentColor"
                  fillOpacity={0.12}
                  dot={false}
                  isAnimationActive={false}
                />
              ) : (
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="currentColor"
                  strokeOpacity={0.9}
                  strokeWidth={1.4}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{formatMeasurementValue(minValue, series.unit)}</span>
          <span>{offsetRangeLabel}</span>
          <span>{formatMeasurementValue(maxValue, series.unit)}</span>
        </div>
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

function getWorkoutDataSourceMeta(dataSource: WorkoutDataSource | null) {
  if (!dataSource) {
    return null;
  }

  return WORKOUT_SOURCE_BADGE_META[dataSource];
}

function getWorkoutProviderLabel(provider: WorkoutProvider) {
  return provider === "appleHealth" ? "Apple Health" : "Strava";
}

function getNoteDisplaySource(
  workout: WorkoutNote,
  loadedSources: Partial<Record<WorkoutProvider, WorkoutSourceSummary>> | null,
) {
  if (workout.dataSource === "strava" && loadedSources?.strava) {
    return loadedSources.strava;
  }

  if (workout.dataSource === "apple-health" && loadedSources?.appleHealth) {
    return loadedSources.appleHealth;
  }

  return (
    loadedSources?.strava ??
    loadedSources?.appleHealth ??
    null
  );
}

function WorkoutSourcePanelSkeleton({ providerLabel }: { providerLabel: string }) {
  return (
    <div className="mt-5 rounded-[1rem] border border-foreground/10 bg-background/40 p-5">
      <p className="eyebrow">{providerLabel}</p>
      <p className="mt-3 text-sm text-muted-foreground">Loading provider-specific activity details…</p>
    </div>
  );
}

function WorkoutSourcePanelUnavailable({ providerLabel }: { providerLabel: string }) {
  return (
    <div className="mt-5 rounded-[1rem] border border-foreground/10 bg-background/40 p-5">
      <p className="eyebrow">{providerLabel}</p>
      <p className="mt-3 text-sm text-muted-foreground">
        Provider-specific activity details are not available for this workout in the current generated data.
      </p>
    </div>
  );
}
function getWorkoutWeatherRows(weather: WorkoutWeather | null) {
  if (!weather) {
    return [];
  }

  const rows: Array<{ label: string; value: string }> = [];
  if (weather.summary) {
    rows.push({ label: "Weather", value: weather.summary });
  }

  const temperatureValue = formatTemperatureRange(
    weather.averageTemperatureC,
    weather.startTemperatureC,
    weather.endTemperatureC,
  );
  if (temperatureValue) {
    rows.push({ label: "Temperature", value: temperatureValue });
  }

  const apparentTemperatureValue = formatDegrees(weather.apparentTemperatureC);
  if (apparentTemperatureValue) {
    rows.push({ label: "Feels like", value: apparentTemperatureValue });
  }

  const humidityValue = formatPercent(weather.humidityPercent);
  if (humidityValue) {
    rows.push({ label: "Humidity", value: humidityValue });
  }

  const precipitationValue = formatMillimeters(weather.precipitationMm);
  if (precipitationValue) {
    rows.push({ label: "Rain", value: precipitationValue });
  }

  const windValue = formatWind(weather.windSpeedKph, weather.windGustKph);
  if (windValue) {
    rows.push({ label: "Wind", value: windValue });
  }

  return rows;
}

function formatTemperatureRange(
  averageTemperatureC: number | null,
  startTemperatureC: number | null,
  endTemperatureC: number | null,
) {
  const average = formatDegrees(averageTemperatureC);
  const start = formatDegrees(startTemperatureC);
  const end = formatDegrees(endTemperatureC);

  if (average && start && end) {
    return `${average} avg (${start} to ${end})`;
  }

  return average ?? (start && end ? `${start} to ${end}` : start ?? end ?? null);
}

function formatDegrees(value: number | null) {
  if (value === null) {
    return null;
  }

  return `${trimTrailingZero(value)} C`;
}

function formatPercent(value: number | null) {
  if (value === null) {
    return null;
  }

  return `${trimTrailingZero(value)}%`;
}

function formatMillimeters(value: number | null) {
  if (value === null) {
    return null;
  }

  return `${trimTrailingZero(value)} mm`;
}

function formatWind(speedKph: number | null, gustKph: number | null) {
  const speed = speedKph === null ? null : `${trimTrailingZero(speedKph)} km/h`;
  const gust = gustKph === null ? null : `${trimTrailingZero(gustKph)} km/h gusts`;

  if (speed && gust) {
    return `${speed}, ${gust}`;
  }

  return speed ?? gust ?? null;
}

function formatSourceTimestamp(value: string | null) {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(value: number | null) {
  if (value === null) {
    return null;
  }

  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const seconds = value % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function buildMeasurementChartData(points: AppleHealthMeasurementSeries["points"]) {
  return points.map((point, index) => {
    const previousValue = index > 0 ? points[index - 1]?.value ?? null : null;
    return {
      offsetSeconds: point.offsetSeconds,
      value: point.value,
      previousValue,
      changeValue: previousValue === null ? null : point.value - previousValue,
    };
  });
}

function getMeasurementOffsetDomain(
  points: AppleHealthMeasurementSeries["points"],
  section: AppleHealthMeasurementSeries["section"],
): [number, number] {
  const minOffset = Math.min(...points.map((point) => point.offsetSeconds));
  const maxOffset = Math.max(...points.map((point) => point.offsetSeconds));
  const range = Math.max(maxOffset - minOffset, 1);
  const padding =
    section === "recoveryContext"
      ? Math.max(range * 0.08, 6 * 60 * 60)
      : Math.max(range * 0.02, 30);
  return [minOffset - padding, maxOffset + padding];
}

function getMeasurementValueDomain(
  points: AppleHealthMeasurementSeries["points"],
  kind: AppleHealthMeasurementSeries["kind"],
): [number, number] {
  const minValue = kind === "cumulative" ? 0 : Math.min(...points.map((point) => point.value));
  const maxValue = Math.max(...points.map((point) => point.value));
  const range = Math.max(maxValue - minValue, 1);
  const padding = range * 0.12;
  return [minValue - padding, maxValue + padding];
}

function formatMeasurementAxisOffset(
  value: number | string,
  section: AppleHealthMeasurementSeries["section"],
) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return "";
  }

  if (section === "recoveryContext") {
    return formatRelativeOffset(numericValue);
  }

  return formatDurationLabel(Math.abs(numericValue));
}

function formatMeasurementAxisValue(value: number | string, unit: string) {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return "";
  }

  if (unit === "%" || unit === "h" || unit === "ml/kg/min" || unit === "ms") {
    return trimTrailingZero(numericValue);
  }

  return String(Math.round(numericValue));
}

function MeasurementTooltip({
  active,
  payload,
  series,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{
    payload?: { offsetSeconds: number; value: number; previousValue: number | null; changeValue: number | null };
  }>;
  series: AppleHealthMeasurementSeries;
}) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload;
  if (!point) {
    return null;
  }

  return (
    <div className="rounded-[0.75rem] border border-foreground/10 bg-background/95 px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-foreground">
        {series.section === "recoveryContext"
          ? formatRelativeOffset(point.offsetSeconds)
          : formatDurationLabel(Math.abs(point.offsetSeconds))}
      </p>
      <p className="mt-1 text-muted-foreground">
        {series.label}: {formatMeasurementValue(point.value, series.unit)}
      </p>
      {series.section === "recoveryContext" && point.changeValue !== null ? (
        <p className="text-muted-foreground">
          Change: {formatSignedMeasurementValue(point.changeValue, series.unit)}
        </p>
      ) : null}
    </div>
  );
}

function getMeasurementSummary(series: AppleHealthMeasurementSeries) {
  if (series.kind === "cumulative" && series.totalValue !== null) {
    return `Total ${formatMeasurementValue(series.totalValue, series.unit)}`;
  }

  const average = series.averageValue !== null ? `Avg ${formatMeasurementValue(series.averageValue, series.unit)}` : null;
  const max = series.maxValue !== null ? `Max ${formatMeasurementValue(series.maxValue, series.unit)}` : null;
  return [average, max].filter(Boolean).join(" • ");
}

function formatMeasurementValue(value: number, unit: string) {
  if (unit === "steps") {
    return `${Math.round(value)} ${unit}`;
  }

  if (unit === "%") {
    return `${trimTrailingZero(value)}${unit}`;
  }

  if (unit === "kcal") {
    return `${trimTrailingZero(value)} ${unit}`;
  }

  if (unit === "h" || unit === "ml/kg/min" || unit === "ms") {
    return `${trimTrailingZero(value)} ${unit}`;
  }

  return `${Math.round(value)} ${unit}`;
}

function formatSignedMeasurementValue(value: number, unit: string) {
  const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${prefix}${formatMeasurementValue(Math.abs(value), unit)}`;
}

function formatMeasurementOffsetRange(points: AppleHealthMeasurementSeries["points"]) {
  const minOffset = Math.min(...points.map((point) => point.offsetSeconds));
  const maxOffset = Math.max(...points.map((point) => point.offsetSeconds));

  if (minOffset < 0) {
    return `${formatRelativeOffset(minOffset)} to ${maxOffset === 0 ? "Workout" : formatRelativeOffset(maxOffset)}`;
  }

  return formatDurationLabel(maxOffset);
}

function formatRelativeOffset(totalSeconds: number) {
  const roundedSeconds = Math.round(totalSeconds);
  if (Math.abs(roundedSeconds) < 24 * 60 * 60) {
    const prefix = roundedSeconds < 0 ? "-" : "+";
    return `${prefix}${formatDurationLabel(Math.abs(roundedSeconds))}`;
  }

  const days = Math.round(roundedSeconds / (24 * 60 * 60));
  return days === 0 ? "Workout" : `${days > 0 ? "+" : ""}${days}d`;
}

function formatDurationLabel(totalSeconds: number) {
  const roundedSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  return `${minutes}m`;
}

function normalizeNumericActivityId(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function trimTrailingZero(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "");
}
