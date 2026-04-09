import { buildOrderedActivityRefs, findWorkoutNote, getCliFlagValue, writeWorkoutNote } from "./workout-source-utils";
import { WORKOUT_PROVIDERS, type WorkoutProvider } from "../src/lib/workouts/schema";

async function main() {
  const noteTarget = getCliFlagValue("--note") ?? getCliFlagValue("--slug");
  const provider = getCliFlagValue("--provider") as WorkoutProvider | null;
  const activityId = getCliFlagValue("--activity-id");
  const clear = process.argv.includes("--clear");

  if (!noteTarget) {
    throw new Error("Missing required --note <path|slug> or --slug <slug> argument");
  }

  if (!provider || !WORKOUT_PROVIDERS.includes(provider)) {
    throw new Error(`Missing or invalid --provider. Expected one of ${WORKOUT_PROVIDERS.join(", ")}`);
  }

  if (!clear && !activityId) {
    throw new Error("Missing required --activity-id <id> argument unless --clear is provided");
  }

  const note = await findWorkoutNote(noteTarget);
  if (!note) {
    throw new Error(`Unable to find workout note for ${noteTarget}`);
  }

  const nextData = { ...note.data };
  const nextActivityRefs = { ...note.activityRefs };

  if (clear) {
    delete nextActivityRefs[provider];
  } else {
    nextActivityRefs[provider] = activityId as string;
  }

  const orderedActivityRefs = buildOrderedActivityRefs(nextActivityRefs);
  if (Object.keys(orderedActivityRefs).length === 0) {
    delete nextData.activityRefs;
  } else {
    nextData.activityRefs = orderedActivityRefs;
  }

  if (provider === "strava") {
    if (clear) {
      delete nextData.stravaId;
    } else {
      const numericValue = Number.parseInt(activityId as string, 10);
      if (!Number.isFinite(numericValue) || numericValue <= 0) {
        throw new Error("Strava activity ids must be positive integers");
      }
      nextData.stravaId = numericValue;
    }
  }

  await writeWorkoutNote(note, nextData);
  console.log(
    clear
      ? `Cleared ${provider} activity link from ${note.sourcePath}`
      : `Linked ${provider} activity ${activityId} to ${note.sourcePath}`,
  );
}

await main();
