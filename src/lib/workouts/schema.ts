export const WORKOUT_EVENT_TYPES = ["run", "basketball", "strength", "mobility", "race"] as const;
export const WORKOUT_DATA_SOURCES = ["strava", "apple-health"] as const;
export const WORKOUT_PROVIDERS = ["strava", "appleHealth"] as const;
export const APPLE_HEALTH_ANALYSIS_MEASUREMENTS = ["heartRate", "cadence"] as const;
export const STRAVA_ANALYSIS_MEASUREMENTS = ["pace", "heartRate", "moving", "elevation"] as const;
export const WORKOUT_MEDIA_PROVIDERS = ["spotify", "youtube"] as const;
export const WORKOUT_NOTE_SOURCE_SCHEMA_VERSION = 1 as const;

export type WorkoutEventType = (typeof WORKOUT_EVENT_TYPES)[number];
export type WorkoutDataSource = (typeof WORKOUT_DATA_SOURCES)[number];
export type WorkoutProvider = (typeof WORKOUT_PROVIDERS)[number];
export type AppleHealthAnalysisMeasurement = (typeof APPLE_HEALTH_ANALYSIS_MEASUREMENTS)[number];
export type StravaAnalysisMeasurement = (typeof STRAVA_ANALYSIS_MEASUREMENTS)[number];
export type WorkoutMediaProvider = (typeof WORKOUT_MEDIA_PROVIDERS)[number];
export type WorkoutMarkdown = string;

export interface WorkoutRouteStreams {
  time?: number[] | null;
  latlng: Array<[number, number]> | null;
  altitude: number[] | null;
  distance: number[] | null;
  heartrate: number[] | null;
  velocitySmooth: number[] | null;
  moving: boolean[] | null;
}

export interface WorkoutWeather {
  provider: string;
  lookedUpAt: string;
  startTemperatureC: number | null;
  endTemperatureC: number | null;
  averageTemperatureC: number | null;
  apparentTemperatureC: number | null;
  humidityPercent: number | null;
  precipitationMm: number | null;
  windSpeedKph: number | null;
  windGustKph: number | null;
  weatherCode: number | null;
  summary: string | null;
}

export interface WorkoutActivityRefMap {
  strava?: string;
  appleHealth?: string;
}

export interface WorkoutMediaEmbed {
  provider: WorkoutMediaProvider;
  url: string;
  title?: string;
}

export interface WorkoutNoteMarkdownSection {
  kind: "markdown";
  heading: string;
  markdown: WorkoutMarkdown;
}

export interface WorkoutNoteProgramSection {
  kind: "program";
  markdown: WorkoutMarkdown;
}

export interface WorkoutNoteImportedFromStravaSection {
  kind: "importedFromStrava";
  markdown: WorkoutMarkdown;
}

export interface WorkoutNoteAnalysisNarrativeSection {
  kind: "intention" | "shortTermGoal" | "longTermGoal" | "personalNote";
  markdown: WorkoutMarkdown;
}

export interface WorkoutNoteAnalysisAppleHealthMeasurementSection {
  kind: "appleHealthMeasurement";
  measurement: AppleHealthAnalysisMeasurement;
  markdown: WorkoutMarkdown;
}

export interface WorkoutNoteAnalysisStravaMeasurementSection {
  kind: "stravaMeasurement";
  measurement: StravaAnalysisMeasurement;
  markdown: WorkoutMarkdown;
}

export type WorkoutNoteAnalysisSection =
  | WorkoutNoteAnalysisNarrativeSection
  | WorkoutNoteAnalysisAppleHealthMeasurementSection
  | WorkoutNoteAnalysisStravaMeasurementSection
  | WorkoutNoteMarkdownSection;

export interface WorkoutNoteAnalysisSectionContainer {
  kind: "analysis";
  summaryMarkdown?: WorkoutMarkdown | null;
  sections: WorkoutNoteAnalysisSection[];
}

export type WorkoutNoteSourceSection =
  | WorkoutNoteProgramSection
  | WorkoutNoteImportedFromStravaSection
  | WorkoutNoteAnalysisSectionContainer
  | WorkoutNoteMarkdownSection;

export interface WorkoutNoteSourceDocument {
  schemaVersion: typeof WORKOUT_NOTE_SOURCE_SCHEMA_VERSION;
  title: string;
  allDay: boolean;
  type: string;
  date: string;
  completed: false | string;
  eventType: WorkoutEventType;
  expectedDistance?: string;
  actualDistance?: string;
  stravaId?: number;
  activityRefs?: WorkoutActivityRefMap;
  media?: WorkoutMediaEmbed;
  sections: WorkoutNoteSourceSection[];
}

export interface WorkoutSourceMetadata {
  name: string | null;
  deviceName: string | null;
  deviceModel: string | null;
}

export interface WorkoutGear {
  name: string;
  retired: boolean | null;
}

export interface WorkoutSourceSummary {
  provider: WorkoutProvider;
  activityId: string;
  sportType: string | null;
  startDate: string | null;
  actualDistance: string | null;
  actualDistanceKm: number | null;
  movingTimeSeconds: number | null;
  elapsedTimeSeconds: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  summaryPolyline: string | null;
  hasRouteStreams: boolean;
  routePath: string | null;
  primaryImageUrl: string | null;
  source: WorkoutSourceMetadata | null;
  gear?: WorkoutGear | null;
}

export interface WorkoutSourceDetails {
  sources: Partial<Record<WorkoutProvider, WorkoutSourceSummary>>;
}

export interface WorkoutSourceDetailsPayload {
  generatedAt: string;
  workouts: Record<string, WorkoutSourceDetails>;
}

export interface AppleHealthMeasurementPoint {
  offsetSeconds: number;
  value: number;
}

export interface AppleHealthMeasurementSeries {
  key:
    | "heartRate"
    | "cadence"
    | "restingHeartRate"
    | "heartRateVariabilitySDNN"
    | "oxygenSaturation"
    | "respiratoryRate"
    | "vo2Max"
    | "sleepDuration";
  label: string;
  unit: string;
  kind: "line" | "cumulative";
  section: "duringWorkout" | "recoveryContext";
  sampleCount: number;
  averageValue: number | null;
  minValue: number | null;
  maxValue: number | null;
  totalValue: number | null;
  points: AppleHealthMeasurementPoint[];
}

export interface AppleHealthWorkoutMeasurements {
  workoutSlug: string;
  startDate: string | null;
  elapsedTimeSeconds: number | null;
  series: AppleHealthMeasurementSeries[];
}

export type GradeAdjustedPaceReliability = "high" | "medium" | "low";

export interface WorkoutStravaGradeAdjustedPace {
  modelVersion: "strava-gap-v1";
  source: "strava";
  paceSecondsPerKm: number;
  equivalentFlatTimeSeconds: number;
  actualPaceSecondsPerKm: number;
  distanceIncludedRatio: number;
  splitCount: number;
}

export interface WorkoutMeasuredGradeAdjustedPace {
  modelVersion: "measured-gap-v1";
  source: "measured";
  paceSecondsPerKm: number;
  equivalentFlatTimeSeconds: number;
  actualPaceSecondsPerKm: number;
  reliability: GradeAdjustedPaceReliability;
  distanceIncludedRatio: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
  timeScale: number;
}

export type WorkoutGradeAdjustedPace = WorkoutStravaGradeAdjustedPace | WorkoutMeasuredGradeAdjustedPace;

export interface WorkoutNote {
  slug: string;
  title: string;
  date: string;
  eventType: WorkoutEventType;
  expectedDistance: string | null;
  expectedDistanceKm: number | null;
  actualDistance: string | null;
  actualDistanceKm: number | null;
  completed: string | null;
  stravaId?: number | null;
  dataSource?: WorkoutDataSource | null;
  actualMovingTimeSeconds: number | null;
  actualElapsedTimeSeconds: number | null;
  gradeAdjustedPace?: WorkoutStravaGradeAdjustedPace | null;
  measuredGradeAdjustedPace?: WorkoutMeasuredGradeAdjustedPace | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  summaryPolyline: string | null;
  primaryImageUrl: string | null;
  mediaThumbnailUrl?: string | null;
  shoe?: WorkoutGear | null;
  weather: WorkoutWeather | null;
  hasStravaStreams?: boolean;
  hasRouteStreams: boolean;
  routePath: string | null;
  measurementsPath: string | null;
  allDay: boolean;
  type: string;
  body: string;
  sections?: WorkoutNoteSourceSection[];
  sourcePath: string;
  activityRefs?: WorkoutActivityRefMap;
  sources?: Partial<Record<WorkoutProvider, WorkoutSourceSummary>>;
  media?: WorkoutMediaEmbed | null;
}

export interface PlanDocument {
  title: string;
  body: string;
  sourcePath: string;
  analysisTimeline: PlanAnalysisTimeline | null;
}

export interface PlanAnalysisTimeline {
  schemaVersion: 1;
  updatedAt: string;
  sourceSummary: string | null;
  entries: PlanAnalysisTimelineEntry[];
}

export interface PlanAnalysisTimelineEntry {
  id: string;
  date: string;
  title: string;
  analysis: string;
  category: string | null;
  summary: string | null;
  period: {
    start: string;
    end: string;
  } | null;
  metrics: Record<string, string | number | boolean | null>;
}

export interface GoalNote {
  slug: string;
  title: string;
  emoji: string;
  date: string;
  body: string;
  sourcePath: string;
}

export interface ChangelogEntry {
  slug: string;
  title: string;
  date: string;
  scope: string | null;
  tags: string[];
  affectedFiles: string[];
  body: string;
  sourcePath: string;
}

export interface WorkoutBestEffortEntry {
  elapsedSeconds: number;
  paceSecondsPerKm: number;
  workoutSlug: string;
  workoutTitle: string;
  workoutDate: string;
  workoutActualDistanceKm: number | null;
}

export interface WorkoutBestEffort extends WorkoutBestEffortEntry {
  key: string;
  label: string;
  distanceMeters: number;
  topEfforts: WorkoutBestEffortEntry[];
}

export interface WorkoutBestEffortsSummary {
  eligibleWorkoutCount: number;
  analyzedWorkoutCount: number;
  efforts: WorkoutBestEffort[];
}

export interface WorkoutsData {
  generatedAt: string;
  welcome: PlanDocument;
  goals: PlanDocument;
  heartRate: PlanDocument;
  morningMobility: PlanDocument;
  metaanalysis: PlanDocument[];
  bestEfforts: WorkoutBestEffortsSummary;
  goalNotes: GoalNote[];
  plan: PlanDocument;
  changelog: ChangelogEntry[];
  workouts: WorkoutNote[];
}

export interface WorkoutFilters {
  query: string;
  eventType: WorkoutEventType[];
  status: "all" | "planned" | "completed";
}
