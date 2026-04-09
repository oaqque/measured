import type { WorkoutRouteStreams } from "@/lib/workouts/schema";

const routeStreamsPromises = new Map<string, Promise<WorkoutRouteStreams | null>>();
const generatedRoutePathCandidates = [
  (activityId: number) => `/generated/workout-routes/strava/${activityId}.json`,
  (activityId: number) => `/generated/workout-routes/${activityId}.json`,
];

export function clearRouteStreamsCache() {
  routeStreamsPromises.clear();
}

export async function loadRouteStreamsForActivity(
  activityId: number,
  versionKey: string,
): Promise<WorkoutRouteStreams | null> {
  return loadRouteStreamsForPaths(
    generatedRoutePathCandidates.map((buildRoutePath) => buildRoutePath(activityId)),
    versionKey,
  );
}

export async function loadRouteStreamsForPath(
  routePath: string,
  versionKey: string,
): Promise<WorkoutRouteStreams | null> {
  const routePaths = [routePath];
  const legacyStravaMatch = routePath.match(/^\/generated\/workout-routes\/strava\/(\d+)\.json$/u);
  if (legacyStravaMatch) {
    routePaths.push(`/generated/workout-routes/${legacyStravaMatch[1]}.json`);
  }

  return loadRouteStreamsForPaths(routePaths, versionKey);
}

async function loadRouteStreamsForPaths(
  routePaths: string[],
  versionKey: string,
): Promise<WorkoutRouteStreams | null> {
  const cacheKey = `${routePaths.join("|")}:${versionKey}`;
  const cachedPromise = routeStreamsPromises.get(cacheKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  const request = loadRouteStreams(routePaths, versionKey)
    .catch((error) => {
      routeStreamsPromises.delete(cacheKey);
      throw error;
    });

  routeStreamsPromises.set(cacheKey, request);
  return request;
}

async function loadRouteStreams(routePaths: string[], versionKey: string): Promise<WorkoutRouteStreams | null> {
  for (const routePath of routePaths) {
    const response = await fetch(`${routePath}?v=${encodeURIComponent(versionKey)}`, {
      cache: "no-store",
    });

    if (response.status === 404) {
      continue;
    }

    if (!response.ok) {
      throw new Error(`Unable to load workout route streams from ${routePath}: ${response.status}`);
    }

    return (await response.json()) as WorkoutRouteStreams;
  }

  return null;
}
