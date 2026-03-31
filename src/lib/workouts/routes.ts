import type { WorkoutRouteStreams } from "@/lib/workouts/schema";

const routeStreamsPromises = new Map<number, Promise<WorkoutRouteStreams | null>>();

export async function loadRouteStreamsForActivity(activityId: number): Promise<WorkoutRouteStreams | null> {
  const cachedPromise = routeStreamsPromises.get(activityId);
  if (cachedPromise) {
    return cachedPromise;
  }

  const request = fetch(`/generated/workout-routes/${activityId}.json`)
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
      routeStreamsPromises.delete(activityId);
      throw error;
    });

  routeStreamsPromises.set(activityId, request);
  return request;
}
