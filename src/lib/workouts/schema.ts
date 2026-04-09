export const WORKOUT_EVENT_TYPES = ["run", "basketball", "strength", "mobility", "race"] as const;
export const WORKOUT_DATA_SOURCES = ["strava", "apple-health"] as const;
export const WORKOUT_PROVIDERS = ["strava", "appleHealth"] as const;

export type WorkoutEventType = (typeof WORKOUT_EVENT_TYPES)[number];
export type WorkoutDataSource = (typeof WORKOUT_DATA_SOURCES)[number];
export type WorkoutProvider = (typeof WORKOUT_PROVIDERS)[number];

export interface WorkoutRouteStreams {
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

export interface WorkoutSourceMetadata {
  name: string | null;
  deviceName: string | null;
  deviceModel: string | null;
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
  activityId: string;
  startDate: string | null;
  elapsedTimeSeconds: number | null;
  series: AppleHealthMeasurementSeries[];
}
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
  stravaId: number | null;
  dataSource: WorkoutDataSource | null;
  actualMovingTimeSeconds: number | null;
  actualElapsedTimeSeconds: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  summaryPolyline: string | null;
  primaryImageUrl: string | null;
  weather: WorkoutWeather | null;
  hasStravaStreams: boolean;
  allDay: boolean;
  type: string;
  body: string;
  sourcePath: string;
  activityRefs?: WorkoutActivityRefMap;
  sources?: Partial<Record<WorkoutProvider, WorkoutSourceSummary>>;
}

export interface PlanDocument {
  title: string;
  body: string;
  sourcePath: string;
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

export interface WorkoutsData {
  generatedAt: string;
  welcome: PlanDocument;
  goals: PlanDocument;
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
