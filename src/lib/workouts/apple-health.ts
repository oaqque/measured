import type { AppleHealthWorkoutMeasurements } from "@/lib/workouts/schema";

const appleHealthMeasurementsPromises = new Map<string, Promise<AppleHealthWorkoutMeasurements | null>>();

export function clearAppleHealthMeasurementsCache() {
  appleHealthMeasurementsPromises.clear();
}

export async function loadAppleHealthWorkoutMeasurements(
  activityId: string,
  versionKey: string,
): Promise<AppleHealthWorkoutMeasurements | null> {
  const cacheKey = `${activityId}:${versionKey}`;
  const cachedPromise = appleHealthMeasurementsPromises.get(cacheKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  const request = fetch(
    `/generated/workout-measurements/appleHealth/${encodeURIComponent(activityId)}.json?v=${encodeURIComponent(versionKey)}`,
    {
      cache: "no-store",
    },
  )
    .then(async (response) => {
      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`Unable to load Apple Health workout measurements for ${activityId}: ${response.status}`);
      }

      return (await response.json()) as AppleHealthWorkoutMeasurements;
    })
    .catch((error) => {
      appleHealthMeasurementsPromises.delete(cacheKey);
      throw error;
    });

  appleHealthMeasurementsPromises.set(cacheKey, request);
  return request;
}
