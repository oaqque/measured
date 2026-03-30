export interface WorkoutNote {
  slug: string;
  title: string;
  date: string;
  eventType: string;
  expectedDistance: string | null;
  expectedDistanceKm: number | null;
  completed: string | null;
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
  plan: PlanDocument;
  workouts: WorkoutNote[];
}

export interface WorkoutFilters {
  query: string;
  eventType: string;
  status: "all" | "planned" | "completed";
}
