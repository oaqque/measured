export const WORKOUT_EVENT_TYPES = ["run", "basketball", "strength", "mobility", "race"] as const;
export const WORKOUT_DATA_SOURCES = ["strava", "apple-health"] as const;

export type WorkoutEventType = (typeof WORKOUT_EVENT_TYPES)[number];
export type WorkoutDataSource = (typeof WORKOUT_DATA_SOURCES)[number];

export interface WorkoutRouteStreams {
  latlng: Array<[number, number]> | null;
  altitude: number[] | null;
  distance: number[] | null;
  heartrate: number[] | null;
  velocitySmooth: number[] | null;
  moving: boolean[] | null;
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
  hasStravaStreams: boolean;
  allDay: boolean;
  type: string;
  body: string;
  sourcePath: string;
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
  eventType: "all" | WorkoutEventType;
  status: "all" | "planned" | "completed";
}
