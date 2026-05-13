import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowLeft,
  BadgeCheck,
  CalendarCheck,
  CalendarDays,
  CloudSun,
  Clock,
  Droplets,
  FileText,
  Footprints,
  Gauge,
  HeartPulse,
  Info,
  Mountain,
  Route,
  Ruler,
  Thermometer,
  Timer,
  Umbrella,
  Wind,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
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
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { WorkoutShareButton } from "@/components/WorkoutShareButton";
import { resolveWorkoutMediaEmbed } from "@/lib/workouts/media";
import { loadAppleHealthWorkoutMeasurements } from "@/lib/workouts/apple-health";
import { LTHR_HEART_RATE_ZONE_BANDS, getLthrHeartRateZoneColor } from "@/lib/workouts/heart-rate-zones";
import {
  formatCompletedTimestamp,
  formatDisplayDate,
  formatDistance,
  generatedAt,
} from "@/lib/workouts/load";
import type {
  AppleHealthAnalysisMeasurement,
  AppleHealthMeasurementSeries,
  AppleHealthWorkoutMeasurements,
  StravaAnalysisMeasurement,
  WorkoutGradeAdjustedPace,
  WorkoutEventType,
  WorkoutGear,
  WorkoutNoteAnalysisSection,
  WorkoutNote,
  WorkoutNoteSourceSection,
  WorkoutWeather,
} from "@/lib/workouts/schema";
import { cn } from "@/lib/utils";

type WorkoutDetailTab = "note" | "measurements" | "recovery";

const WORKOUT_EVENT_TYPE_LABELS: Record<WorkoutEventType, string> = {
  basketball: "Basketball",
  mobility: "Mobility",
  race: "Race",
  run: "Run",
  strength: "Strength",
};

const WORKOUT_PANE_MAX_WIDTH_CLASS = "max-w-[80rem]";
const HEART_RATE_ZONE_CHART_TARGET_BUCKETS = 44;
const HEART_RATE_ZONE_SMOOTHING_WINDOW_SECONDS = 75;

const ANALYSIS_SECTION_HEADINGS: Record<string, string> = {
  intention: "Intention",
  shortTermGoal: "Short-Term Goal",
  longTermGoal: "Long-Term Goal",
  personalNote: "Personal Note",
};

const STRAVA_MEASUREMENT_CARD_META: Record<
  StravaAnalysisMeasurement,
  { icon: typeof Gauge; title: string }
> = {
  pace: {
    icon: Gauge,
    title: "Pace",
  },
  heartRate: {
    icon: HeartPulse,
    title: "Heart Rate",
  },
  moving: {
    icon: Activity,
    title: "Moving",
  },
  elevation: {
    icon: Mountain,
    title: "Elevation",
  },
};

export default function WorkoutNotePane({
  backLabel = "Back to calendar",
  workout,
  onBack,
  onLinkClick,
}: {
  backLabel?: string;
  workout: WorkoutNote;
  onBack: () => void;
  onLinkClick: (href: string) => boolean;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [activeTab, setActiveTab] = useState<WorkoutDetailTab>("note");
  const closeTimeoutRef = useRef<number | null>(null);

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
          aria-label={backLabel}
          className="size-9 rounded-[0.35rem] p-0"
          type="button"
          variant="secondary"
          onClick={handleBack}
        >
          <ArrowLeft className="size-4" />
          <span className="sr-only">{backLabel}</span>
        </Button>
      </div>

      <div className="app-scroll-pane min-h-0 flex-1 overflow-y-auto">
        <WorkoutDetailPanel
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          workout={workout}
          onLinkClick={onLinkClick}
        />
      </div>
    </div>
  );
}

function WorkoutDetailPanel({
  activeTab,
  setActiveTab,
  workout,
  onLinkClick,
}: {
  activeTab: WorkoutDetailTab;
  setActiveTab: (tab: WorkoutDetailTab) => void;
  workout: WorkoutNote;
  onLinkClick: (href: string) => boolean;
}) {
  const showMeasurementTabs = Boolean(workout.measurementsPath);

  return (
    <div className={cn("mx-auto flex h-full w-full flex-col", WORKOUT_PANE_MAX_WIDTH_CLASS)}>
      <div className="flex items-start justify-between gap-4 border-b border-foreground/10 pb-4">
        <div className="min-w-0">
          <p className="eyebrow">Workout Note</p>
          <h2 className="mt-2 text-2xl font-black">{workout.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{formatDisplayDate(workout.date)}</p>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <WorkoutShareButton slug={workout.slug} title={workout.title} />
        </div>
      </div>

      {showMeasurementTabs ? (
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
            aria-pressed={activeTab === "measurements"}
            className={cn(
              "rounded-[0.45rem] px-3 py-2 text-sm font-semibold transition-colors",
              activeTab === "measurements" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            type="button"
            onClick={() => setActiveTab("measurements")}
          >
            Measurements
          </button>
          <button
            aria-pressed={activeTab === "recovery"}
            className={cn(
              "rounded-[0.45rem] px-3 py-2 text-sm font-semibold transition-colors",
              activeTab === "recovery" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            type="button"
            onClick={() => setActiveTab("recovery")}
          >
            Recovery
          </button>
        </div>
      ) : null}

      {activeTab === "measurements" && showMeasurementTabs ? (
        <WorkoutMeasurementsPanel measurementSection="duringWorkout" workout={workout} />
      ) : activeTab === "recovery" && showMeasurementTabs ? (
        <WorkoutMeasurementsPanel measurementSection="recoveryContext" workout={workout} />
      ) : (
        <WorkoutNarrativePanel workout={workout} onLinkClick={onLinkClick} />
      )}
    </div>
  );
}

function WorkoutNarrativePanel({
  workout,
  onLinkClick,
}: {
  workout: WorkoutNote;
  onLinkClick: (href: string) => boolean;
}) {
  const narrativeContent = buildWorkoutNarrativeMarkdown(workout);
  const stravaAnalysisSections = getStravaMeasurementAnalysisSections(workout);
  const routePolyline = workout.summaryPolyline;
  const hasRouteStreams = workout.hasRouteStreams;
  const imageUrl = workout.primaryImageUrl;
  const hasRoutePanel = routePolyline !== null || (hasRouteStreams && workout.routePath !== null);
  const routeMapKey = buildRouteMapKey(workout.routePath, generatedAt);
  const mediaEmbed = resolveWorkoutMediaEmbed(workout.media);
  const mediaItems: ReactNode[] = [];

  if (imageUrl) {
    mediaItems.push(
      <article
        className="overflow-hidden rounded-[0.85rem] border border-foreground/10 bg-surface-elevated"
        key="workout-image"
      >
        <img
          alt={`Workout image for ${workout.title}`}
          className="block max-h-[32rem] w-full object-contain"
          loading="lazy"
          src={imageUrl}
        />
      </article>,
    );
  }

  if (mediaEmbed) {
    mediaItems.push(<WorkoutMediaEmbedCard key="linked-media" mediaEmbed={mediaEmbed} />);
  }

  return (
    <>
      <div className="mt-5 lg:hidden">
        {hasRoutePanel ? (
          <div className="mt-5 border-b border-foreground/10 pb-5">
            <RouteMap
              activityId={null}
              generatedAt={generatedAt}
              hasRouteStreams={hasRouteStreams}
              key={routeMapKey}
              polyline={routePolyline ?? ""}
              routePath={workout.routePath}
              title={workout.title}
            />
          </div>
        ) : null}

        <WorkoutMetadataGrid className={cn(hasRoutePanel ? "mt-5" : "mt-0")} workout={workout} />

        <div className="markdown-prose mt-5 flex-1">
          <MarkdownContent content={narrativeContent} onLinkClick={onLinkClick} />
        </div>
        {mediaItems.length > 0 ? <WorkoutMediaSection className="mt-5" items={mediaItems} /> : null}
        {stravaAnalysisSections.length > 0 ? (
          <StravaAnalysisSectionGrid className="mt-5" sections={stravaAnalysisSections} onLinkClick={onLinkClick} />
        ) : null}
      </div>

      <div className="hidden lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <div className="min-w-0">
          <div className="markdown-prose">
            <MarkdownContent content={narrativeContent} onLinkClick={onLinkClick} />
          </div>
          {stravaAnalysisSections.length > 0 ? (
            <StravaAnalysisSectionGrid className="mt-6" sections={stravaAnalysisSections} onLinkClick={onLinkClick} />
          ) : null}
        </div>

        <aside className="space-y-5 pt-6">
          {hasRoutePanel ? (
            <section>
              <RouteMap
                activityId={null}
                generatedAt={generatedAt}
                hasRouteStreams={hasRouteStreams}
                key={routeMapKey}
                polyline={routePolyline ?? ""}
                routePath={workout.routePath}
                title={workout.title}
              />
            </section>
          ) : null}

          {mediaItems.length > 0 ? <WorkoutMediaSection items={mediaItems} /> : null}

          <section>
            <WorkoutMetadataGrid className="pt-0" workout={workout} />
          </section>
        </aside>
      </div>
    </>
  );
}

function WorkoutMediaSection({
  className,
  items,
}: {
  className?: string;
  items: ReactNode[];
}) {
  const scrollable = items.length > 1;

  return (
    <section className={className}>
      <div
        className={cn(
          "space-y-3",
          scrollable && "max-h-[min(72vh,56rem)] overflow-y-auto",
        )}
      >
        {items}
      </div>
    </section>
  );
}

function WorkoutMediaEmbedCard({
  mediaEmbed,
}: {
  mediaEmbed: NonNullable<ReturnType<typeof resolveWorkoutMediaEmbed>>;
}) {
  return (
    <div className={cn("overflow-hidden rounded-[0.85rem] bg-black", mediaEmbed.shape === "video" ? "aspect-video" : "h-[352px]")}>
      <iframe
        allow={mediaEmbed.provider === "spotify" ? "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" : "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"}
        allowFullScreen
        className="block h-full w-full border-0"
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        src={mediaEmbed.embedUrl}
        title={mediaEmbed.iframeTitle}
      />
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
  const weatherDetails = getWorkoutWeatherDetails(workout.weather);

  return (
    <div className={cn("space-y-3 pt-1 text-sm", className)}>
      <SessionMetadataGroup workout={workout} />
      <DistancePaceMetadataGroup workout={workout} />
      <ShoeMetadataGroup shoe={workout.shoe} />
      <HeartRateMetadataGroup workout={workout} />
      {weatherDetails ? <WeatherMetadataGroup details={weatherDetails} /> : null}
      <MetadataGroup
        icon={FileText}
        rows={[{ label: "Source file", value: workout.sourcePath }]}
        title="Source"
      />
    </div>
  );
}

function WorkoutMeasurementsPanel({
  measurementSection,
  workout,
}: {
  measurementSection: AppleHealthMeasurementSeries["section"];
  workout: WorkoutNote;
}) {
  const measurementsPath = workout.measurementsPath;
  const [measurementResult, setMeasurementResult] = useState<{
    measurements: AppleHealthWorkoutMeasurements | null;
    path: string;
  } | null>(null);
  const measurements = measurementResult?.path === measurementsPath ? measurementResult.measurements : null;
  const measurementsLoaded = !measurementsPath || measurementResult?.path === measurementsPath;

  useEffect(() => {
    if (!measurementsPath) {
      return;
    }

    let cancelled = false;

    loadAppleHealthWorkoutMeasurements(measurementsPath, generatedAt)
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setMeasurementResult({ measurements: payload, path: measurementsPath });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setMeasurementResult({ measurements: null, path: measurementsPath });
      });

    return () => {
      cancelled = true;
    };
  }, [measurementsPath]);

  return (
    <div className="mt-5">
      <AppleHealthMeasurementsSection
        measurements={measurements}
        measurementsLoaded={measurementsLoaded}
        section={measurementSection}
        workout={workout}
      />
    </div>
  );
}

function AppleHealthMeasurementsSection({
  measurements,
  measurementsLoaded,
  section,
  workout,
}: {
  measurements: AppleHealthWorkoutMeasurements | null;
  measurementsLoaded: boolean;
  section: AppleHealthMeasurementSeries["section"];
  workout: WorkoutNote;
}) {
  const visibleSeries = measurements?.series.filter((item) => item.section === section) ?? [];
  const analysisByMeasurement = getAppleHealthMeasurementAnalysisMap(workout);

  if (!measurementsLoaded) {
    return (
      <section className="rounded-[1rem] border border-foreground/10 bg-background/40 p-5">
        <p className="eyebrow">Measurements</p>
        <p className="mt-3 text-sm text-muted-foreground">Loading workout samples...</p>
      </section>
    );
  }

  if (!measurements || measurements.series.length === 0) {
    return (
      <section className="rounded-[1rem] border border-foreground/10 bg-background/40 p-5">
        <p className="eyebrow">Measurements</p>
        <p className="mt-3 text-sm text-muted-foreground">
          {section === "recoveryContext"
            ? "No recovery samples were linked to this workout."
            : "No measurement samples were linked to this workout window."}
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
            <AppleHealthMeasurementChart
              key={series.key}
              analysisMarkdown={getAppleHealthMeasurementAnalysis(series, analysisByMeasurement)}
              series={series}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function AppleHealthMeasurementChart({
  analysisMarkdown,
  series,
}: {
  analysisMarkdown: string | null;
  series: AppleHealthMeasurementSeries;
}) {
  const minValue = series.minValue ?? Math.min(...series.points.map((point) => point.value));
  const maxValue = series.maxValue ?? Math.max(...series.points.map((point) => point.value));
  const offsetRangeLabel = formatMeasurementOffsetRange(series.points);
  const chartData = buildMeasurementChartData(series.points);
  const offsetDomain = getMeasurementOffsetDomain(series.points, series.section);
  const valueDomain = getMeasurementValueDomain(series);
  const heartRateSegments =
    series.section === "duringWorkout" && series.key === "heartRate"
      ? buildMeasurementZoneSegments(series.points)
      : [];

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{series.label}</h4>
          <p className="mt-1 text-xs text-muted-foreground">{getMeasurementSummary(series)}</p>
        </div>
        <div className="flex items-start gap-2">
          {analysisMarkdown ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  aria-label={`Open ${series.label} analysis`}
                  className="shrink-0 rounded-full px-3"
                  size="sm"
                  type="button"
                  variant="secondary"
                >
                  <Info className="size-3.5" />
                  Analysis
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
                <div className="border-b border-foreground/10 px-4 py-3">
                  <p className="eyebrow">Measurement analysis</p>
                  <h5 className="mt-1 text-sm font-semibold text-foreground">{series.label}</h5>
                </div>
                <div className="max-h-[min(28rem,60vh)] overflow-y-auto px-4 py-3">
                  <div className="markdown-prose text-sm">
                    <MarkdownContent content={analysisMarkdown} />
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          ) : null}
          <p className="text-right text-[11px] text-muted-foreground">{series.sampleCount} samples</p>
        </div>
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
              ) : heartRateSegments.length > 0 ? (
                <>
                  {heartRateSegments.map((segment) => (
                    <ReferenceLine
                      key={`${series.key}-${segment.startOffsetSeconds}-${segment.endOffsetSeconds}`}
                      ifOverflow="extendDomain"
                      segment={[
                        { x: segment.startOffsetSeconds, y: segment.startValue },
                        { x: segment.endOffsetSeconds, y: segment.endValue },
                      ]}
                      stroke={segment.color}
                      strokeLinecap="round"
                      strokeOpacity={0.96}
                      strokeWidth={3}
                    />
                  ))}
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="currentColor"
                    strokeOpacity={0.18}
                    strokeWidth={1}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                </>
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
        {series.section === "duringWorkout" && series.key === "heartRate" ? (
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
            {LTHR_HEART_RATE_ZONE_BANDS.map((band) => (
              <span
                key={band.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-background/70 px-2 py-1"
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: band.color }}
                />
                {band.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface MetadataRowData {
  label: string;
  value: string;
}

interface MetadataMetricData extends MetadataRowData {
  icon: LucideIcon;
}

interface WeatherMetadataDetails {
  metrics: MetadataMetricData[];
  summary: string | null;
  temperature: string | null;
  temperatureContext: string | null;
}

interface HeartRateZoneBarDatum {
  color: string;
  endOffsetSeconds: number;
  offsetSeconds: number;
  startOffsetSeconds: number;
  zoneLabel: string;
  zoneLevel: number;
}

function MetadataSectionHeader({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-foreground/10 pb-2">
      <span className="grid size-7 place-items-center rounded-[0.4rem] bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    </div>
  );
}

function SessionMetadataGroup({ workout }: { workout: WorkoutNote }) {
  const statusDetails = getWorkoutStatusDetails(workout.completed);
  const sessionMetrics: MetadataMetricData[] = [
    { icon: Info, label: "Type", value: workout.type },
    { icon: CalendarDays, label: "All day", value: workout.allDay ? "Yes" : "No" },
  ];

  return (
    <section className="rounded-[0.5rem] border border-foreground/10 bg-background/40 p-3">
      <MetadataSectionHeader icon={CalendarCheck} title="Session" />

      <div className="mt-3 grid grid-cols-1 items-end gap-3 border-b border-foreground/10 pb-3 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="eyebrow">Event</p>
          <p className="mt-1 break-words text-base font-semibold leading-snug text-foreground">
            {WORKOUT_EVENT_TYPE_LABELS[workout.eventType]}
          </p>
        </div>
        <div className="min-w-0 sm:text-right">
          <p className="eyebrow">Status</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold leading-snug text-foreground sm:justify-end">
            <BadgeCheck className="size-4 shrink-0 text-muted-foreground" />
            <span>{statusDetails.label}</span>
          </p>
          {statusDetails.context ? (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">{statusDetails.context}</p>
          ) : null}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {sessionMetrics.map((metric) => (
          <MetadataMetric key={metric.label} metric={metric} />
        ))}
      </dl>
    </section>
  );
}

function DistancePaceMetadataGroup({ workout }: { workout: WorkoutNote }) {
  const movingPace = formatWorkoutPace(workout.actualMovingTimeSeconds, workout.actualDistanceKm);
  const gradeAdjustedPace = formatGradeAdjustedPace(workout.gradeAdjustedPace);
  const primaryDistanceKm = workout.actualDistanceKm ?? workout.expectedDistanceKm;
  const primaryDistanceLabel = workout.actualDistanceKm !== null ? "Actual distance" : "Expected distance";
  const paceLabel = movingPace ? "Moving pace" : gradeAdjustedPace ? "Grade-adjusted pace" : "Pace";
  const paceValue = movingPace ?? gradeAdjustedPace ?? "Pace TBD";
  const metrics = getDistancePaceMetrics(workout, movingPace, gradeAdjustedPace);

  return (
    <section className="rounded-[0.5rem] border border-foreground/10 bg-background/40 p-3">
      <MetadataSectionHeader icon={Route} title="Distance & pace" />

      <div className="mt-3 grid grid-cols-1 items-end gap-3 border-b border-foreground/10 pb-3 sm:grid-cols-2">
        <div className="min-w-0">
          <p className="eyebrow">{primaryDistanceLabel}</p>
          <p className="mt-1 break-words text-xl font-black leading-none text-foreground">
            {formatDistance(primaryDistanceKm)}
          </p>
        </div>
        <div className="min-w-0 sm:text-right">
          <p className="eyebrow">{paceLabel}</p>
          <p className="mt-1 break-words text-xl font-black leading-none text-foreground">{paceValue}</p>
        </div>
      </div>

      {metrics.length > 0 ? (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {metrics.map((metric) => (
            <MetadataMetric key={metric.label} metric={metric} />
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function ShoeMetadataGroup({ shoe }: { shoe?: WorkoutGear | null }) {
  if (!shoe) {
    return null;
  }

  const status = shoe.retired === null ? null : shoe.retired ? "Retired" : "Active";

  return (
    <section className="rounded-[0.5rem] border border-foreground/10 bg-background/40 p-3">
      <MetadataSectionHeader icon={Footprints} title="Shoe" />

      <div className="mt-3 grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="eyebrow">Model</p>
          <p className="mt-1 break-words text-base font-semibold leading-snug text-foreground">
            {shoe.name}
          </p>
        </div>
        {status ? (
          <div className="min-w-0 sm:text-right">
            <p className="eyebrow">Status</p>
            <p className="mt-1 text-sm font-semibold leading-snug text-foreground">{status}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function HeartRateMetadataGroup({ workout }: { workout: WorkoutNote }) {
  const measurementsPath = workout.measurementsPath;
  const [measurementResult, setMeasurementResult] = useState<{
    measurements: AppleHealthWorkoutMeasurements | null;
    path: string;
  } | null>(null);
  const measurements = measurementResult?.path === measurementsPath ? measurementResult.measurements : null;
  const measurementsLoaded = !measurementsPath || measurementResult?.path === measurementsPath;
  const heartRateSeries =
    measurements?.series.find((series) => series.section === "duringWorkout" && series.key === "heartRate") ?? null;

  useEffect(() => {
    if (!measurementsPath) {
      return;
    }

    let cancelled = false;

    loadAppleHealthWorkoutMeasurements(measurementsPath, generatedAt)
      .then((payload) => {
        if (cancelled) {
          return;
        }

        setMeasurementResult({ measurements: payload, path: measurementsPath });
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setMeasurementResult({ measurements: null, path: measurementsPath });
      });

    return () => {
      cancelled = true;
    };
  }, [measurementsPath]);

  if (workout.averageHeartrate === null && workout.maxHeartrate === null && !measurementsPath) {
    return null;
  }

  return (
    <section className="rounded-[0.5rem] border border-foreground/10 bg-background/40 p-3">
      <MetadataSectionHeader icon={HeartPulse} title="Heart rate" />

      <div className="mt-3 grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
        <HeartRateSummaryValue
          heartRate={workout.averageHeartrate}
          label="Average"
        />
        <HeartRateSummaryValue
          align="right"
          heartRate={workout.maxHeartrate}
          label="Max"
        />
      </div>

      <HeartRateZoneBarChart
        measurementsLoaded={measurementsLoaded}
        series={heartRateSeries}
        workoutElapsedTimeSeconds={workout.actualElapsedTimeSeconds}
      />
    </section>
  );
}

function HeartRateSummaryValue({
  align = "left",
  heartRate,
  label,
}: {
  align?: "left" | "right";
  heartRate: number | null;
  label: string;
}) {
  const zone = heartRate !== null ? getHeartRateZoneDetails(heartRate) : null;

  return (
    <div className={cn("min-w-0", align === "right" && "sm:text-right")}>
      <p className="eyebrow">{label}</p>
      <p className="mt-1 break-words text-xl font-black leading-none text-foreground">
        {formatHeartRate(heartRate) ?? "No data"}
      </p>
      {zone ? (
        <p
          className={cn(
            "mt-2 flex items-center gap-1.5 text-xs leading-snug text-muted-foreground",
            align === "right" && "sm:justify-end",
          )}
        >
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: zone.color }}
          />
          <span>{zone.label}</span>
        </p>
      ) : null}
    </div>
  );
}

function HeartRateZoneBarChart({
  measurementsLoaded,
  series,
  workoutElapsedTimeSeconds,
}: {
  measurementsLoaded: boolean;
  series: AppleHealthMeasurementSeries | null;
  workoutElapsedTimeSeconds: number | null;
}) {
  if (!measurementsLoaded) {
    return (
      <p className="mt-3 border-t border-foreground/10 pt-3 text-xs text-muted-foreground">
        Loading HR zones...
      </p>
    );
  }

  if (!series || series.points.length === 0) {
    return null;
  }

  const chartData = buildHeartRateZoneBarData(series.points, workoutElapsedTimeSeconds);
  if (chartData.length === 0) {
    return null;
  }

  const xDomain: [number, number] = [
    chartData[0]?.startOffsetSeconds ?? 0,
    chartData.at(-1)?.endOffsetSeconds ?? 1,
  ];

  return (
    <div className="mt-4 border-t border-foreground/10 pt-3">
      <div className="h-28 min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart data={chartData} margin={{ top: 6, right: 4, bottom: 2, left: 0 }}>
            <CartesianGrid vertical={false} stroke="currentColor" strokeOpacity={0.08} />
            <XAxis
              type="number"
              dataKey="offsetSeconds"
              domain={xDomain}
              tickFormatter={(value) => formatDurationLabel(Math.abs(Number(value)))}
              tick={{ fill: "currentColor", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              minTickGap={10}
              stroke="currentColor"
              strokeOpacity={0.2}
            />
            <YAxis
              type="number"
              domain={[0, LTHR_HEART_RATE_ZONE_BANDS.length + 0.5]}
              ticks={LTHR_HEART_RATE_ZONE_BANDS.map((_, index) => index + 1)}
              tickFormatter={(value) => formatHeartRateZoneAxisTick(Number(value))}
              tick={{ fill: "currentColor", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              interval={0}
              width={28}
              stroke="currentColor"
              strokeOpacity={0.2}
            />
            <Tooltip
              cursor={{ fill: "currentColor", fillOpacity: 0.05 }}
              content={(props) => <HeartRateZoneTooltip {...props} />}
            />
            <Bar dataKey="zoneLevel" barSize={4} isAnimationActive={false} radius={[2, 2, 0, 0]}>
              {chartData.map((bar) => (
                <Cell key={`${bar.startOffsetSeconds}-${bar.endOffsetSeconds}`} fill={bar.color} />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function HeartRateZoneTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: HeartRateZoneBarDatum }>;
}) {
  const datum = payload?.[0]?.payload;
  if (!active || !datum) {
    return null;
  }

  return (
    <div className="rounded-[0.65rem] border border-foreground/10 bg-background/95 px-3 py-2 text-xs shadow-sm">
      <p className="font-medium text-foreground">
        {formatDurationLabel(datum.startOffsetSeconds)}-{formatDurationLabel(datum.endOffsetSeconds)}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-muted-foreground">
        <span
          aria-hidden="true"
          className="size-2 rounded-full"
          style={{ backgroundColor: datum.color }}
        />
        {datum.zoneLabel}
      </p>
    </div>
  );
}

function MetadataGroup({
  icon: Icon,
  rows,
  title,
}: {
  icon: LucideIcon;
  rows: MetadataRowData[];
  title: string;
}) {
  return (
    <section className="rounded-[0.5rem] border border-foreground/10 bg-background/40 p-3">
      <MetadataSectionHeader icon={Icon} title={title} />
      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {rows.map((row) => (
          <MetadataRow key={row.label} label={row.label} value={row.value} />
        ))}
      </dl>
    </section>
  );
}

function WeatherMetadataGroup({ details }: { details: WeatherMetadataDetails }) {
  const hasLead = details.summary || details.temperature;

  return (
    <section className="rounded-[0.5rem] border border-foreground/10 bg-background/40 p-3">
      <MetadataSectionHeader icon={CloudSun} title="Weather" />

      {hasLead ? (
        <div className="mt-3 grid grid-cols-1 items-end gap-3 border-b border-foreground/10 pb-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <p className="eyebrow">Condition</p>
            <p className="mt-1 break-words text-base font-semibold leading-snug text-foreground">
              {details.summary ?? "Weather recorded"}
            </p>
          </div>
          {details.temperature ? (
            <div className="sm:text-right">
              <p className="eyebrow">Temp</p>
              <p className="mt-1 text-xl font-black leading-none text-foreground">{details.temperature}</p>
              {details.temperatureContext ? (
                <p className="mt-1 max-w-28 text-xs leading-snug text-muted-foreground">
                  {details.temperatureContext}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {details.metrics.length > 0 ? (
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {details.metrics.map((metric) => (
            <MetadataMetric key={metric.label} metric={metric} />
          ))}
        </dl>
      ) : null}
    </section>
  );
}

function MetadataMetric({ metric }: { metric: MetadataMetricData }) {
  const Icon = metric.icon;

  return (
    <div className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2">
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="eyebrow">{metric.label}</dt>
        <dd className="mt-1 break-words text-sm font-medium leading-snug text-foreground">{metric.value}</dd>
      </div>
    </div>
  );
}

function MetadataRow({ label, value }: MetadataRowData) {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="eyebrow">{label}</dt>
      <dd className="break-words text-sm font-medium leading-snug text-foreground">{value}</dd>
    </div>
  );
}

function StravaAnalysisSectionGrid({
  className,
  sections,
  onLinkClick,
}: {
  className?: string;
  sections: Array<{ measurement: StravaAnalysisMeasurement; markdown: string }>;
  onLinkClick: (href: string) => boolean;
}) {
  return (
    <section className={className}>
      <p className="eyebrow">Activity Analysis</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {sections.map((section) => {
          const meta = STRAVA_MEASUREMENT_CARD_META[section.measurement];
          const Icon = meta.icon;
          return (
            <article
              key={section.measurement}
              className="relative overflow-hidden rounded-[1rem] border border-foreground/10 bg-surface-panel-alt/70 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <h4 className="text-sm font-semibold text-foreground">{meta.title}</h4>
                <div className="rounded-full border border-foreground/10 bg-background/80 p-2 text-muted-foreground">
                  <Icon className="size-4" />
                </div>
              </div>
              <div className="markdown-prose mt-3 text-sm">
                <MarkdownContent content={section.markdown} onLinkClick={onLinkClick} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function buildWorkoutNarrativeMarkdown(workout: WorkoutNote) {
  if (!workout.sections || workout.sections.length === 0) {
    return workout.body;
  }

  const renderedSections = workout.sections
    .map((section) => renderNarrativeSection(section))
    .filter((section): section is string => section !== null && section.trim().length > 0);

  return renderedSections.join("\n\n");
}

function renderNarrativeSection(section: WorkoutNoteSourceSection) {
  if (section.kind === "program") {
    return renderMarkdownSection("Program", section.markdown, 2);
  }

  if (section.kind === "importedFromStrava") {
    return renderMarkdownSection("Imported Activity", section.markdown, 2);
  }

  if (section.kind === "markdown") {
    return renderMarkdownSection(section.heading, section.markdown, 2);
  }

  if (section.kind !== "analysis") {
    return null;
  }

  const parts: string[] = [];
  if (section.summaryMarkdown) {
    parts.push(section.summaryMarkdown.trim());
  }

  for (const analysisSection of section.sections) {
    const renderedSection = renderNarrativeAnalysisSection(analysisSection);
    if (renderedSection) {
      parts.push(renderedSection);
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return renderMarkdownSection("Analysis", parts.join("\n\n"), 2);
}

function renderNarrativeAnalysisSection(section: WorkoutNoteAnalysisSection) {
  if (section.kind === "appleHealthMeasurement" || section.kind === "stravaMeasurement") {
    return null;
  }

  if (section.kind === "markdown") {
    return renderMarkdownSection(section.heading, section.markdown, 3);
  }

  return renderMarkdownSection(ANALYSIS_SECTION_HEADINGS[section.kind] ?? "Analysis", section.markdown, 3);
}

function renderMarkdownSection(heading: string, markdown: string, level: 2 | 3) {
  const normalizedMarkdown = markdown.trim();
  if (normalizedMarkdown.length === 0) {
    return `${"#".repeat(level)} ${heading}`;
  }

  return `${"#".repeat(level)} ${heading}\n\n${normalizedMarkdown}`;
}

function getAppleHealthMeasurementAnalysisMap(workout: WorkoutNote) {
  const sections = workout.sections ?? [];
  const analyses = new Map<AppleHealthAnalysisMeasurement, string>();

  for (const section of sections) {
    if (section.kind !== "analysis") {
      continue;
    }

    for (const analysisSection of section.sections) {
      if (analysisSection.kind !== "appleHealthMeasurement") {
        continue;
      }

      analyses.set(analysisSection.measurement, analysisSection.markdown);
    }
  }

  return analyses;
}

function getAppleHealthMeasurementAnalysis(
  series: AppleHealthMeasurementSeries,
  analysisByMeasurement: Map<AppleHealthAnalysisMeasurement, string>,
) {
  if (series.key === "heartRate" || series.key === "cadence") {
    return analysisByMeasurement.get(series.key) ?? null;
  }

  return null;
}

function getStravaMeasurementAnalysisSections(workout: WorkoutNote) {
  const sections = workout.sections ?? [];
  const measurements: Array<{ measurement: StravaAnalysisMeasurement; markdown: string }> = [];

  for (const section of sections) {
    if (section.kind !== "analysis") {
      continue;
    }

    for (const analysisSection of section.sections) {
      if (analysisSection.kind !== "stravaMeasurement") {
        continue;
      }

      measurements.push({
        measurement: analysisSection.measurement,
        markdown: analysisSection.markdown,
      });
    }
  }

  return measurements;
}

function getWorkoutStatusDetails(completed: string | null) {
  if (!completed) {
    return { context: null, label: "Planned" };
  }

  return { context: formatCompletedTimestamp(completed), label: "Completed" };
}

function getHeartRateZoneDetails(heartRate: number) {
  return LTHR_HEART_RATE_ZONE_BANDS[getHeartRateZoneIndex(heartRate)] ?? LTHR_HEART_RATE_ZONE_BANDS[0];
}

function getHeartRateZoneIndex(heartRate: number) {
  for (let index = LTHR_HEART_RATE_ZONE_BANDS.length - 1; index >= 0; index -= 1) {
    const band = LTHR_HEART_RATE_ZONE_BANDS[index];
    if (heartRate >= band.minimum) {
      return index;
    }
  }

  return 0;
}

function buildHeartRateZoneBarData(
  points: AppleHealthMeasurementSeries["points"],
  workoutElapsedTimeSeconds: number | null,
): HeartRateZoneBarDatum[] {
  const sortedPoints = [...points]
    .filter((point) => Number.isFinite(point.offsetSeconds) && Number.isFinite(point.value))
    .sort((left, right) => left.offsetSeconds - right.offsetSeconds);
  if (sortedPoints.length === 0) {
    return [];
  }

  const smoothedPoints = smoothHeartRatePoints(sortedPoints);
  const firstOffsetSeconds = Math.min(0, smoothedPoints[0]?.offsetSeconds ?? 0);
  const lastPointOffsetSeconds = smoothedPoints.at(-1)?.offsetSeconds ?? firstOffsetSeconds;
  const lastOffsetSeconds = Math.max(workoutElapsedTimeSeconds ?? 0, lastPointOffsetSeconds, firstOffsetSeconds + 1);
  const durationSeconds = Math.max(lastOffsetSeconds - firstOffsetSeconds, 1);
  const bucketCount = Math.min(
    HEART_RATE_ZONE_CHART_TARGET_BUCKETS,
    Math.max(8, Math.ceil(durationSeconds / 60)),
  );
  const bucketDurationSeconds = durationSeconds / bucketCount;
  const chartData: HeartRateZoneBarDatum[] = [];

  for (let index = 0; index < bucketCount; index += 1) {
    const startOffsetSeconds = firstOffsetSeconds + index * bucketDurationSeconds;
    const endOffsetSeconds =
      index === bucketCount - 1 ? lastOffsetSeconds : firstOffsetSeconds + (index + 1) * bucketDurationSeconds;
    const bucketPoints = smoothedPoints.filter(
      (point) =>
        point.offsetSeconds >= startOffsetSeconds &&
        (index === bucketCount - 1 ? point.offsetSeconds <= endOffsetSeconds : point.offsetSeconds < endOffsetSeconds),
    );

    if (bucketPoints.length === 0) {
      continue;
    }

    const averageHeartRate = average(bucketPoints.map((point) => point.value));
    const zoneIndex = getHeartRateZoneIndex(averageHeartRate);
    const zone = LTHR_HEART_RATE_ZONE_BANDS[zoneIndex] ?? LTHR_HEART_RATE_ZONE_BANDS[0];
    chartData.push({
      color: zone.color,
      endOffsetSeconds: Math.round(endOffsetSeconds),
      offsetSeconds: Math.round((startOffsetSeconds + endOffsetSeconds) / 2),
      startOffsetSeconds: Math.round(startOffsetSeconds),
      zoneLabel: zone.label,
      zoneLevel: zoneIndex + 1,
    });
  }

  return chartData;
}

function smoothHeartRatePoints(points: AppleHealthMeasurementSeries["points"]) {
  return points.map((point) => {
    const windowStart = point.offsetSeconds - HEART_RATE_ZONE_SMOOTHING_WINDOW_SECONDS / 2;
    const windowEnd = point.offsetSeconds + HEART_RATE_ZONE_SMOOTHING_WINDOW_SECONDS / 2;
    const windowPoints = points.filter(
      (candidate) => candidate.offsetSeconds >= windowStart && candidate.offsetSeconds <= windowEnd,
    );

    return {
      offsetSeconds: point.offsetSeconds,
      value: average(windowPoints.map((candidate) => candidate.value)),
    };
  });
}

function getDistancePaceMetrics(
  workout: WorkoutNote,
  movingPace: string | null,
  gradeAdjustedPace: string | null,
): MetadataMetricData[] {
  const metrics: MetadataMetricData[] = [];
  if (workout.actualDistanceKm !== null && workout.expectedDistanceKm !== null) {
    metrics.push({ icon: Ruler, label: "Expected", value: formatDistance(workout.expectedDistanceKm) });
  }

  const movingTime = formatWorkoutDuration(workout.actualMovingTimeSeconds);
  if (movingTime) {
    metrics.push({ icon: Timer, label: "Moving time", value: movingTime });
  }

  const elapsedTime = formatWorkoutDuration(workout.actualElapsedTimeSeconds);
  if (elapsedTime && workout.actualElapsedTimeSeconds !== workout.actualMovingTimeSeconds) {
    metrics.push({ icon: Clock, label: "Elapsed time", value: elapsedTime });
  }

  if (movingPace && gradeAdjustedPace) {
    metrics.push({ icon: Mountain, label: "Grade-adjusted", value: gradeAdjustedPace });
  }

  return metrics;
}

function getWorkoutWeatherDetails(weather: WorkoutWeather | null): WeatherMetadataDetails | null {
  if (!weather) {
    return null;
  }

  const temperatureValue =
    formatDegrees(weather.averageTemperatureC) ??
    formatDegrees(weather.startTemperatureC) ??
    formatDegrees(weather.endTemperatureC);
  const temperatureContext = formatTemperatureContext(
    weather.averageTemperatureC,
    weather.startTemperatureC,
    weather.endTemperatureC,
  );
  const metrics: MetadataMetricData[] = [];
  const apparentTemperatureValue = formatDegrees(weather.apparentTemperatureC);
  if (apparentTemperatureValue) {
    metrics.push({ icon: Thermometer, label: "Feels like", value: apparentTemperatureValue });
  }

  const humidityValue = formatPercent(weather.humidityPercent);
  if (humidityValue) {
    metrics.push({ icon: Droplets, label: "Humidity", value: humidityValue });
  }

  const precipitationValue = formatMillimeters(weather.precipitationMm);
  if (precipitationValue) {
    metrics.push({ icon: Umbrella, label: "Rain", value: precipitationValue });
  }

  const windValue = formatWind(weather.windSpeedKph, weather.windGustKph);
  if (windValue) {
    metrics.push({ icon: Wind, label: "Wind", value: windValue });
  }

  if (!weather.summary && !temperatureValue && metrics.length === 0) {
    return null;
  }

  return {
    metrics,
    summary: weather.summary,
    temperature: temperatureValue,
    temperatureContext,
  };
}

function formatTemperatureContext(
  averageTemperatureC: number | null,
  startTemperatureC: number | null,
  endTemperatureC: number | null,
) {
  const start = formatDegrees(startTemperatureC);
  const end = formatDegrees(endTemperatureC);

  if (averageTemperatureC !== null && start && end && start !== end) {
    return `${start} to ${end}`;
  }

  if (averageTemperatureC === null && start && end && start !== end) {
    return `${start} to ${end}`;
  }

  return null;
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
  series: AppleHealthMeasurementSeries,
): [number, number] {
  const points = series.points;
  const minValue =
    series.kind === "cumulative"
      ? 0
      : series.minValue ?? Math.min(...points.map((point) => point.value));
  const maxValue = series.maxValue ?? Math.max(...points.map((point) => point.value));
  const range = Math.max(maxValue - minValue, 1);
  const padding = range * 0.12;
  return [minValue - padding, maxValue + padding];
}

function buildMeasurementZoneSegments(points: AppleHealthMeasurementSeries["points"]) {
  const segments: Array<{
    color: string;
    endOffsetSeconds: number;
    endValue: number;
    startOffsetSeconds: number;
    startValue: number;
  }> = [];

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const zoneColor = getLthrHeartRateZoneColor((previous.value + current.value) / 2);
    segments.push({
      color: zoneColor,
      endOffsetSeconds: current.offsetSeconds,
      endValue: current.value,
      startOffsetSeconds: previous.offsetSeconds,
      startValue: previous.value,
    });
  }

  return segments;
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

function formatWorkoutDuration(totalSeconds: number | null) {
  if (!totalSeconds) {
    return null;
  }

  return formatDurationLabel(totalSeconds);
}

function formatHeartRate(value: number | null) {
  if (value === null) {
    return null;
  }

  return `${Math.round(value)} bpm`;
}

function formatHeartRateZoneAxisTick(value: number) {
  return `Z${Math.round(value)}`;
}

function formatWorkoutPace(movingTimeSeconds: number | null, distanceKm: number | null) {
  if (!movingTimeSeconds || !distanceKm) {
    return null;
  }

  return `${formatPaceSeconds(movingTimeSeconds / distanceKm)} /km`;
}

function formatGradeAdjustedPace(gradeAdjustedPace: WorkoutGradeAdjustedPace | null | undefined) {
  if (!gradeAdjustedPace) {
    return null;
  }

  return `${formatPaceSeconds(gradeAdjustedPace.paceSecondsPerKm)} /km (${gradeAdjustedPace.reliability})`;
}

function formatPaceSeconds(secondsPerKm: number) {
  const roundedSeconds = Math.max(0, Math.round(secondsPerKm));
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((total, value) => total + value, 0) / values.length;
}

function buildRouteMapKey(routePath: string | null | undefined, versionKey: string) {
  return `${routePath ?? "no-path"}:${versionKey}`;
}
function trimTrailingZero(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/u, "");
}
