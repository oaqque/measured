import type { WorkoutRouteStreams } from "@/lib/workouts/schema";

const routeStreamsPromises = new Map<string, Promise<WorkoutRouteStreams | null>>();

export function clearRouteStreamsCache() {
  routeStreamsPromises.clear();
}

export async function loadRouteStreamsForActivity(
  activityId: number,
  versionKey: string,
): Promise<WorkoutRouteStreams | null> {
  const cacheKey = `${activityId}:${versionKey}`;
  const cachedPromise = routeStreamsPromises.get(cacheKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  const request = fetch(
    `/generated/workout-routes/${activityId}.json?v=${encodeURIComponent(versionKey)}`,
    { cache: "no-store" },
  )
    .then(async (response) => {
      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`Unable to load workout route streams for ${activityId}: ${response.status}`);
      }

      return (await response.json()) as WorkoutRouteStreams;
    })
    .catch((error) => {
      routeStreamsPromises.delete(cacheKey);
      throw error;
    });

  routeStreamsPromises.set(cacheKey, request);
  return request;
}
