export interface WorkoutRouteStreams {
  latlng: Array<[number, number]> | null;
  distance: number[] | null;
  heartrate: number[] | null;
  velocitySmooth: number[] | null;
  moving: boolean[] | null;
}

export interface WorkoutNote {
  slug: string;
  title: string;
  date: string;
  eventType: string;
  expectedDistance: string | null;
  expectedDistanceKm: number | null;
  actualDistance: string | null;
  actualDistanceKm: number | null;
  completed: string | null;
  stravaId: number | null;
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

export interface WorkoutsData {
  generatedAt: string;
  welcome: PlanDocument;
  plan: PlanDocument;
  workouts: WorkoutNote[];
}

export interface WorkoutFilters {
  query: string;
  eventType: string;
  status: "all" | "planned" | "completed";
}
