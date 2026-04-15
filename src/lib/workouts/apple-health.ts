import type { AppleHealthWorkoutMeasurements } from "@/lib/workouts/schema";

const appleHealthMeasurementsPromises = new Map<string, Promise<AppleHealthWorkoutMeasurements | null>>();

export function clearAppleHealthMeasurementsCache() {
  appleHealthMeasurementsPromises.clear();
}

export async function loadAppleHealthWorkoutMeasurements(
  measurementsPath: string,
  versionKey: string,
): Promise<AppleHealthWorkoutMeasurements | null> {
  const cacheKey = `${measurementsPath}:${versionKey}`;
  const cachedPromise = appleHealthMeasurementsPromises.get(cacheKey);
  if (cachedPromise) {
    return cachedPromise;
  }

  const request = fetch(`${measurementsPath}?v=${encodeURIComponent(versionKey)}`, {
    cache: "no-store",
  })
    .then(async (response) => {
      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(`Unable to load workout measurements from ${measurementsPath}: ${response.status}`);
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
