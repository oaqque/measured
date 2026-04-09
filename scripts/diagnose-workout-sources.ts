import path from "node:path";
import {
  type WorkoutProvider,
  WORKOUT_PROVIDERS,
} from "../src/lib/workouts/schema";
import {
  getCliFlagValue,
  hasCliFlag,
  readProviderCaches,
  readWorkoutNotes,
  resolveNotesDir,
  rootDir,
  type ProviderCachedActivity,
  type WorkoutNoteFile,
} from "./workout-source-utils";

type DiagnosticActivity = {
  activityId: string;
  distanceKm: number | null;
  elapsedTimeSeconds: number | null;
  linkedNotes: string[];
  notePaths: string[];
  provider: WorkoutProvider;
  sportType: string | null;
  startDate: string | null;
};

type DuplicateCandidate = {
  appleHealthActivityId: string;
  appleHealthLinkedNotes: string[];
  distanceDeltaKm: number | null;
  durationDeltaMinutes: number | null;
  noteSuggestion: {
    notePath: string;
    noteSlug: string;
    providerToAdd: WorkoutProvider;
  } | null;
  sharedLinkedNote: string | null;
  startDeltaMinutes: number;
  stravaActivityId: string;
  stravaLinkedNotes: string[];
};

async function main() {
  const notesDir = await resolveNotesDir();
  const notes = await readWorkoutNotes(notesDir);
  const providerCaches = await readProviderCaches();
  const distanceToleranceKm = parseOptionalFloat(getCliFlagValue("--distance-km-tolerance")) ?? 1.5;
  const durationToleranceMinutes = parseOptionalFloat(getCliFlagValue("--duration-minute-tolerance")) ?? 15;
  const startToleranceMinutes = parseOptionalFloat(getCliFlagValue("--start-minute-tolerance")) ?? 20;

  const linkedActivityIndex = buildLinkedActivityIndex(notes);
  const missingLinks = collectMissingLinks(notes, providerCaches);
  const unlinkedActivities = collectUnlinkedActivities(providerCaches, linkedActivityIndex);
  const duplicateCandidates = findDuplicateCandidates(
    providerCaches.strava.activities,
    providerCaches.appleHealth.activities,
    linkedActivityIndex,
    {
      distanceToleranceKm,
      durationToleranceMinutes,
      startToleranceMinutes,
    },
  );

  if (hasCliFlag("--json")) {
    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          missingLinks,
          unlinkedActivities,
          duplicateCandidates,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(`Workout source diagnostics`);
  console.log(`Notes directory: ${path.relative(rootDir, notesDir)}`);
  console.log(`Missing note links: ${missingLinks.length}`);
  console.log(
    `Unlinked activities: ${WORKOUT_PROVIDERS.map((provider) => `${provider}=${unlinkedActivities[provider].length}`).join(", ")}`,
  );
  console.log(`Duplicate candidates: ${duplicateCandidates.length}`);

  if (missingLinks.length > 0) {
    console.log("\nMissing linked provider activities:");
    for (const item of missingLinks.slice(0, 25)) {
      console.log(`- ${item.noteSlug}: ${item.provider} ${item.activityId} missing from cache`);
    }
  }

  console.log("\nTop duplicate candidates:");
  for (const candidate of duplicateCandidates.slice(0, 20)) {
    const suggestion = candidate.noteSuggestion
      ? ` -> suggest linking ${candidate.noteSuggestion.providerToAdd} on ${candidate.noteSuggestion.noteSlug}`
      : "";
    const sharedNote = candidate.sharedLinkedNote ? ` already linked on ${candidate.sharedLinkedNote}` : "";
    console.log(
      [
        `- strava ${candidate.stravaActivityId}`,
        `appleHealth ${candidate.appleHealthActivityId}`,
        `start Δ ${candidate.startDeltaMinutes.toFixed(1)} min`,
        `distance Δ ${formatNullableNumber(candidate.distanceDeltaKm, "km")}`,
        `duration Δ ${formatNullableNumber(candidate.durationDeltaMinutes, "min")}${sharedNote}${suggestion}`,
      ].join(" | "),
    );
  }

  if (duplicateCandidates.length > 20) {
    console.log(`\nUse --json for the full duplicate candidate list.`);
  }
}

function buildLinkedActivityIndex(notes: WorkoutNoteFile[]) {
  const index = {
    strava: new Map<string, WorkoutNoteFile[]>(),
    appleHealth: new Map<string, WorkoutNoteFile[]>(),
  } as Record<WorkoutProvider, Map<string, WorkoutNoteFile[]>>;

  for (const note of notes) {
    for (const provider of WORKOUT_PROVIDERS) {
      const activityId = note.activityRefs[provider];
      if (!activityId) {
        continue;
      }

      const existing = index[provider].get(activityId) ?? [];
      existing.push(note);
      index[provider].set(activityId, existing);
    }
  }

  return index;
}

function collectMissingLinks(
  notes: WorkoutNoteFile[],
  providerCaches: Awaited<ReturnType<typeof readProviderCaches>>,
) {
  return notes.flatMap((note) =>
    WORKOUT_PROVIDERS.flatMap((provider) => {
      const activityId = note.activityRefs[provider];
      if (!activityId || providerCaches[provider].activities[activityId]) {
        return [];
      }

      return [
        {
          activityId,
          notePath: note.sourcePath,
          noteSlug: note.slug,
          provider,
        },
      ];
    }),
  );
}

function collectUnlinkedActivities(
  providerCaches: Awaited<ReturnType<typeof readProviderCaches>>,
  linkedActivityIndex: Record<WorkoutProvider, Map<string, WorkoutNoteFile[]>>,
) {
  return Object.fromEntries(
    WORKOUT_PROVIDERS.map((provider) => {
      const activities = Object.entries(providerCaches[provider].activities)
        .filter(([activityId]) => !linkedActivityIndex[provider].has(activityId))
        .map(([activityId, activity]) => buildDiagnosticActivity(provider, activityId, activity, []));

      return [provider, activities];
    }),
  ) as Record<WorkoutProvider, DiagnosticActivity[]>;
}

function findDuplicateCandidates(
  stravaActivities: Record<string, ProviderCachedActivity>,
  appleHealthActivities: Record<string, ProviderCachedActivity>,
  linkedActivityIndex: Record<WorkoutProvider, Map<string, WorkoutNoteFile[]>>,
  thresholds: {
    distanceToleranceKm: number;
    durationToleranceMinutes: number;
    startToleranceMinutes: number;
  },
) {
  const candidates: DuplicateCandidate[] = [];

  for (const [stravaActivityId, stravaActivity] of Object.entries(stravaActivities)) {
    const stravaStart = normalizeTime(stravaActivity.startDate);
    if (stravaStart === null) {
      continue;
    }

    for (const [appleHealthActivityId, appleHealthActivity] of Object.entries(appleHealthActivities)) {
      const appleStart = normalizeTime(appleHealthActivity.startDate);
      if (appleStart === null) {
        continue;
      }

      const startDeltaMinutes = Math.abs(stravaStart - appleStart) / (60 * 1000);
      if (startDeltaMinutes > thresholds.startToleranceMinutes) {
        continue;
      }

      const stravaDistanceKm = normalizeDistanceKm(stravaActivity);
      const appleDistanceKm = normalizeDistanceKm(appleHealthActivity);
      const distanceDeltaKm =
        stravaDistanceKm === null || appleDistanceKm === null
          ? null
          : Math.abs(stravaDistanceKm - appleDistanceKm);
      if (distanceDeltaKm !== null && distanceDeltaKm > thresholds.distanceToleranceKm) {
        continue;
      }

      const stravaDurationMinutes = normalizeDurationMinutes(stravaActivity);
      const appleDurationMinutes = normalizeDurationMinutes(appleHealthActivity);
      const durationDeltaMinutes =
        stravaDurationMinutes === null || appleDurationMinutes === null
          ? null
          : Math.abs(stravaDurationMinutes - appleDurationMinutes);
      if (durationDeltaMinutes !== null && durationDeltaMinutes > thresholds.durationToleranceMinutes) {
        continue;
      }

      const stravaLinkedNotes = linkedActivityIndex.strava.get(stravaActivityId) ?? [];
      const appleHealthLinkedNotes = linkedActivityIndex.appleHealth.get(appleHealthActivityId) ?? [];
      const sharedLinkedNote =
        stravaLinkedNotes.find((note) => appleHealthLinkedNotes.some((appleNote) => appleNote.slug === note.slug))
          ?.slug ?? null;

      candidates.push({
        appleHealthActivityId,
        appleHealthLinkedNotes: appleHealthLinkedNotes.map((note) => note.slug),
        distanceDeltaKm,
        durationDeltaMinutes,
        noteSuggestion: deriveNoteSuggestion(stravaLinkedNotes, appleHealthLinkedNotes),
        sharedLinkedNote,
        startDeltaMinutes,
        stravaActivityId,
        stravaLinkedNotes: stravaLinkedNotes.map((note) => note.slug),
      });
    }
  }

  return candidates.sort((left, right) => {
    if (left.sharedLinkedNote && !right.sharedLinkedNote) {
      return 1;
    }
    if (!left.sharedLinkedNote && right.sharedLinkedNote) {
      return -1;
    }

    return scoreCandidate(left) - scoreCandidate(right);
  });
}

function deriveNoteSuggestion(stravaNotes: WorkoutNoteFile[], appleHealthNotes: WorkoutNoteFile[]) {
  if (stravaNotes.length === 1 && appleHealthNotes.length === 0) {
    return {
      notePath: stravaNotes[0].sourcePath,
      noteSlug: stravaNotes[0].slug,
      providerToAdd: "appleHealth" as const,
    };
  }

  if (stravaNotes.length === 0 && appleHealthNotes.length === 1) {
    return {
      notePath: appleHealthNotes[0].sourcePath,
      noteSlug: appleHealthNotes[0].slug,
      providerToAdd: "strava" as const,
    };
  }

  return null;
}

function scoreCandidate(candidate: DuplicateCandidate) {
  return (
    candidate.startDeltaMinutes +
    (candidate.distanceDeltaKm ?? 0) * 10 +
    (candidate.durationDeltaMinutes ?? 0)
  );
}

function buildDiagnosticActivity(
  provider: WorkoutProvider,
  activityId: string,
  activity: ProviderCachedActivity,
  linkedNotes: WorkoutNoteFile[],
): DiagnosticActivity {
  return {
    activityId,
    distanceKm: normalizeDistanceKm(activity),
    elapsedTimeSeconds: normalizeInteger(activity.elapsedTimeSeconds),
    linkedNotes: linkedNotes.map((note) => note.slug),
    notePaths: linkedNotes.map((note) => note.sourcePath),
    provider,
    sportType: normalizeString(activity.sportType),
    startDate: normalizeString(activity.startDate),
  };
}

function normalizeDistanceKm(activity: ProviderCachedActivity) {
  const explicitDistance = normalizeNumber(activity.distanceKm);
  if (explicitDistance !== null) {
    return explicitDistance;
  }

  const distanceMeters = normalizeNumber(activity.distanceMeters);
  return distanceMeters === null ? null : distanceMeters / 1000;
}

function normalizeDurationMinutes(activity: ProviderCachedActivity) {
  const elapsed = normalizeInteger(activity.elapsedTimeSeconds);
  if (elapsed !== null) {
    return elapsed / 60;
  }

  const moving = normalizeInteger(activity.movingTimeSeconds);
  return moving === null ? null : moving / 60;
}

function normalizeTime(value: unknown) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeInteger(value: unknown) {
  const normalized = normalizeNumber(value);
  return normalized === null ? null : Math.trunc(normalized);
}

function normalizeString(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  return null;
}

function parseOptionalFloat(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatNullableNumber(value: number | null, unit: string) {
  return value === null ? "n/a" : `${value.toFixed(2)} ${unit}`;
}

await main();
