import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import cliProgress from "cli-progress";
import matter from "gray-matter";
import {
  getWorkoutNoteBaseName,
  hasImportedFromStravaSection,
  parseWorkoutNoteSourceDocument,
  renderWorkoutNoteSourceDocumentBody,
} from "../src/lib/workouts/source-note";
import { resolveWorkoutMediaThumbnail } from "../src/lib/workouts/media";
import type {
  AppleHealthMeasurementPoint,
  AppleHealthMeasurementSeries,
  AppleHealthWorkoutMeasurements,
  ChangelogEntry,
  GoalNote,
  PlanDocument,
  WorkoutActivityRefMap,
  WorkoutEventType,
  WorkoutNote,
  WorkoutNoteAnalysisSection,
  WorkoutNoteSourceDocument,
  WorkoutNoteSourceSection,
  WorkoutProvider,
  WorkoutRouteStreams,
  WorkoutSourceDetailsPayload,
  WorkoutSourceMetadata,
  WorkoutSourceSummary,
  WorkoutWeather,
  WorkoutsData,
} from "../src/lib/workouts/schema";
import { WORKOUT_EVENT_TYPES, WORKOUT_PROVIDERS } from "../src/lib/workouts/schema";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const execFileAsync = promisify(execFile);
const generatedPath = path.resolve(rootDir, "src/generated/workouts.json");
const generatedWorkoutSourceDetailsPath = path.resolve(rootDir, "public/generated/workout-source-details.json");
const generatedWorkoutMeasurementsDir = path.resolve(rootDir, "public/generated/workout-measurements");
const generatedRouteStreamsDir = path.resolve(rootDir, "public/generated/workout-routes");
const generatedWorkoutImagesDir = path.resolve(rootDir, "public/generated/workout-images");
const legacyGeneratedRouteStreamsPath = path.resolve(rootDir, "public/generated/workout-route-streams.json");
const defaultWorkoutsDir = path.resolve(rootDir, "data/training");
const defaultCacheExportPaths: Record<WorkoutProvider, string> = {
  strava: path.resolve(rootDir, "vault/strava/cache-export.json"),
  appleHealth: path.resolve(rootDir, "vault/apple-health/cache-export.json"),
};
const defaultStravaCacheImagesDir = path.resolve(rootDir, "vault/strava/cache-images");
const providerDisplayOrder: WorkoutProvider[] = ["strava", "appleHealth"];
const appleHealthPublicIdSalt = normalizeNullableString(process.env.APPLE_HEALTH_PUBLIC_ID_SALT);
const changelogDirName = "changelog";
const goalsDirName = "goals";
const notesDirName = "notes";

interface ProviderCacheSnapshot {
  appleHealthCollectionSamples: Record<AppleHealthMeasurementKey, AppleHealthCollectionSampleRecord[]> | null;
  cacheAvailable: boolean;
  deletedActivityIds: Set<string>;
  generatedAt: string;
  provider: WorkoutProvider;
  activities: Record<string, ProviderCachedActivity>;
}

interface ProviderCachedActivity {
  activityId: string | number;
  name?: string | null;
  sportType?: string | null;
  startDate?: string | null;
  distanceMeters?: number | null;
  distanceKm?: number | null;
  movingTimeSeconds?: number | null;
  elapsedTimeSeconds?: number | null;
  totalElevationGainMeters?: number | null;
  averageHeartrate?: number | null;
  maxHeartrate?: number | null;
  summaryPolyline?: string | null;
  detailFetchedAt?: string | null;
  weather?: unknown;
  hasStreams?: boolean;
  routeStreams?: unknown;
  source?: Partial<WorkoutSourceMetadata> | null;
}

type AppleHealthMeasurementKey =
  | "heartRate"
  | "stepCount"
  | "restingHeartRate"
  | "heartRateVariabilitySDNN"
  | "oxygenSaturation"
  | "respiratoryRate"
  | "vo2Max"
  | "sleepAnalysis";

const appleHealthMeasurementKeys: AppleHealthMeasurementKey[] = [
  "heartRate",
  "stepCount",
  "restingHeartRate",
  "heartRateVariabilitySDNN",
  "oxygenSaturation",
  "respiratoryRate",
  "vo2Max",
  "sleepAnalysis",
];

interface AppleHealthCollectionSampleRecord {
  startDate: string | null;
  endDate: string | null;
  numericValue: number | null;
  categoryValue?: number | null;
  metadata?: Record<string, unknown> | null;
  source?: Partial<WorkoutSourceMetadata> | null;
}

interface AppleHealthActivityWindow {
  activityId: string;
  elapsedTimeSeconds: number;
  endMs: number;
  source: WorkoutSourceMetadata | null;
  startDate: string;
  startMs: number;
  workoutSlug: string;
}

interface GeneratedWorkoutFallback {
  actualDistance: string | null;
  actualDistanceKm: number | null;
  activityRefs: WorkoutActivityRefMap;
  weather: WorkoutWeather | null;
  sources: Partial<Record<WorkoutProvider, WorkoutSourceSummary>>;
}

interface LegacyGeneratedWorkoutShape {
  activityRefs?: WorkoutActivityRefMap;
  sources?: Partial<Record<WorkoutProvider, WorkoutSourceSummary>>;
  weather?: WorkoutWeather | null;
  stravaId?: number | null;
  primaryImageUrl?: string | null;
  actualMovingTimeSeconds?: number | null;
  actualElapsedTimeSeconds?: number | null;
  averageHeartrate?: number | null;
  maxHeartrate?: number | null;
  summaryPolyline?: string | null;
  hasStravaStreams?: boolean;
}

async function main() {
  const progress = createProgressTracker(8);
  progress.step("Scanning training files");
  const dataDir = await resolveWorkoutsDir();
  const notesDir = path.join(dataDir, notesDirName);
  const goalsDir = path.join(dataDir, goalsDirName);
  const changelogDir = path.join(dataDir, changelogDirName);
  await assertNotesDirectory(notesDir);
  await assertGoalNotesDirectory(goalsDir);
  const fileNames = listWorkoutNoteFileNames(await fs.readdir(notesDir));
  const goalFileNames = (await fs.readdir(goalsDir))
    .filter((fileName) => fileName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));
  const noteInputs = await Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = path.join(notesDir, fileName);
      const fileContent = await fs.readFile(filePath, "utf8");
      return {
        fileName,
        filePath,
        sourcePath: path.relative(dataDir, filePath).replaceAll("\\", "/"),
        document: parseWorkoutNoteSourceDocument(fileName, fileContent),
      };
    }),
  );
  const mediaThumbnailsBySourcePath = new Map(
    await Promise.all(
      noteInputs.map(async (noteInput) => [
        noteInput.sourcePath,
        await resolveWorkoutMediaThumbnail(noteInput.document.media ?? null),
      ] as const),
    ),
  );

  progress.step("Loading provider caches");
  const referencedActivityIds = collectReferencedActivityIds(noteInputs);
  const providerCaches = await readProviderCaches(referencedActivityIds);

  progress.step("Reading generated fallbacks");
  const existingGeneratedData = await readExistingGeneratedData();
  const existingWorkoutSourceDetails = await readExistingWorkoutSourceDetails();
  const changelogEntries = await readChangelogEntries(changelogDir, dataDir);
  const existingWorkoutFallbacks = new Map(
    (existingGeneratedData?.workouts ?? []).map((workout) => {
      const detailSources = existingWorkoutSourceDetails?.workouts[workout.slug]?.sources;
      return [
        workout.sourcePath,
        buildGeneratedWorkoutFallback({
          ...workout,
          ...(detailSources ? { sources: detailSources } : {}),
        } as WorkoutNote),
      ] as const;
    }),
  );

  const workouts: WorkoutNote[] = [];
  const goalNotes: GoalNote[] = [];
  let welcome: PlanDocument | null = null;
  let goals: PlanDocument | null = null;
  let heartRate: PlanDocument | null = null;
  let morningMobility: PlanDocument | null = null;
  let plan: PlanDocument | null = null;

  progress.step("Reading plan documents");
  welcome = await readDocument(path.join(dataDir, "WELCOME.md"), dataDir);
  goals = await readDocument(path.join(dataDir, "GOALS.md"), dataDir);
  heartRate = await readDocument(path.join(dataDir, "metaanalysis", "HEART_RATE.md"), dataDir);
  morningMobility = await readDocument(path.join(dataDir, "metaanalysis", "MORNING_MOBILITY.md"), dataDir);
  plan = await readDocument(path.join(dataDir, "PLAN.md"), dataDir);

  progress.step("Building workout payload");
  for (const noteInput of noteInputs) {
    workouts.push(
      buildWorkoutNote(
        noteInput.fileName,
        noteInput.document,
        noteInput.sourcePath,
        providerCaches,
        existingWorkoutFallbacks.get(noteInput.sourcePath) ?? null,
        mediaThumbnailsBySourcePath.get(noteInput.sourcePath) ?? null,
      ),
    );
  }

  progress.step("Building goal payload");
  for (const fileName of goalFileNames) {
    const filePath = path.join(goalsDir, fileName);
    const sourcePath = path.relative(dataDir, filePath).replaceAll("\\", "/");
    const fileContent = await fs.readFile(filePath, "utf8");

    goalNotes.push(buildGoalNote(fileName, fileContent, sourcePath));
  }

  if (!welcome) {
    throw new Error(`Missing WELCOME.md in workouts source directory: ${dataDir}`);
  }

  if (!plan) {
    throw new Error(`Missing PLAN.md in workouts source directory: ${dataDir}`);
  }

  if (!goals) {
    throw new Error(`Missing GOALS.md in workouts source directory: ${dataDir}`);
  }

  if (!heartRate) {
    throw new Error(`Missing metaanalysis/HEART_RATE.md in workouts source directory: ${dataDir}`);
  }

  if (!morningMobility) {
    throw new Error(`Missing metaanalysis/MORNING_MOBILITY.md in workouts source directory: ${dataDir}`);
  }

  workouts.sort((left, right) =>
    left.date === right.date ? left.slug.localeCompare(right.slug) : left.date.localeCompare(right.date),
  );

  const generatedAt = new Date().toISOString();
  const payload: WorkoutsData = {
    generatedAt,
    welcome,
    goals,
    heartRate,
    morningMobility,
    goalNotes,
    plan,
    changelog: changelogEntries,
    workouts: workouts.map((workout) => toPublicWorkoutNote(workout)),
  };

  progress.step("Writing summary files");
  await fs.mkdir(path.dirname(generatedPath), { recursive: true });
  await fs.writeFile(generatedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rm(generatedWorkoutSourceDetailsPath, { force: true });

  progress.step("Writing generated assets");
  await writeRouteStreamFiles(workouts, providerCaches);
  await writeAppleHealthMeasurementFiles(
    workouts,
    providerCaches.appleHealth,
    providerCaches.appleHealth.appleHealthCollectionSamples,
  );
  await writeWorkoutImageFiles(workouts, providerCaches.strava.cacheAvailable);
  progress.finish(`Generated ${workouts.length} workout notes at ${generatedPath}`);
  console.log(`Generated ${workouts.length} workout notes at ${generatedPath}`);
}

function createProgressTracker(totalSteps: number) {
  if (!process.stdout.isTTY) {
    return {
      step(label: string) {
        console.log(`[build:data] ${label}`);
      },
      finish(label: string) {
        console.log(`[build:data] ${label}`);
      },
    };
  }

  const bar = new cliProgress.SingleBar(
    {
      clearOnComplete: false,
      format: "[{bar}] {value}/{total} {stage}",
      hideCursor: true,
    },
    cliProgress.Presets.shades_classic,
  );

  bar.start(totalSteps, 0, { stage: "Starting data build..." });

  return {
    step(label: string) {
      bar.increment(1, { stage: label });
    },
    finish(label: string) {
      bar.update(totalSteps, { stage: label });
      bar.stop();
    },
  };
}

async function resolveWorkoutsDir() {
  const flagValue = getCliFlagValue("--source");
  const configuredPath = flagValue ?? process.env.WORKOUTS_SOURCE_DIR ?? defaultWorkoutsDir;
  const resolvedPath = path.resolve(rootDir, configuredPath);

  try {
    const stats = await fs.stat(resolvedPath);
    if (!stats.isDirectory()) {
      throw new Error(`Workout source path is not a directory: ${resolvedPath}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Unable to read workout source directory: ${resolvedPath}`,
        "Set WORKOUTS_SOURCE_DIR=/absolute/path/to/workouts or run:",
        "pnpm run build:data -- --source /absolute/path/to/workouts",
        `Default fallback checked: ${defaultWorkoutsDir}`,
        `Details: ${detail}`,
      ].join("\n"),
    );
  }

  return resolvedPath;
}

async function readProviderCaches(
  referencedActivityIds: Record<WorkoutProvider, Set<string>>,
): Promise<Record<WorkoutProvider, ProviderCacheSnapshot>> {
  const caches = await Promise.all(
    WORKOUT_PROVIDERS.map(
      async (provider) =>
        [provider, await readProviderCacheSnapshot(provider, referencedActivityIds[provider])] as const,
    ),
  );
  return Object.fromEntries(caches) as Record<WorkoutProvider, ProviderCacheSnapshot>;
}

async function readProviderCacheSnapshot(
  provider: WorkoutProvider,
  referencedActivityIds: Set<string>,
): Promise<ProviderCacheSnapshot> {
  if (referencedActivityIds.size === 0) {
    return {
      appleHealthCollectionSamples: null,
      cacheAvailable: false,
      deletedActivityIds: new Set<string>(),
      generatedAt: new Date(0).toISOString(),
      provider,
      activities: {},
    };
  }

  const cachePath = defaultCacheExportPaths[provider];

  try {
    if (provider === "appleHealth") {
      const appleHealthSnapshot = await readAppleHealthCacheSnapshot(cachePath, referencedActivityIds);
      return {
        appleHealthCollectionSamples: appleHealthSnapshot.collectionSamples,
        cacheAvailable: true,
        deletedActivityIds: appleHealthSnapshot.deletedActivityIds,
        generatedAt: new Date(0).toISOString(),
        provider,
        activities: appleHealthSnapshot.activities,
      };
    }

    const fileContent = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(fileContent) as Partial<ProviderCacheSnapshot>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.activities !== "object") {
      throw new Error("expected activities object");
    }

    const rawDeletedActivityIds = (parsed as Record<string, unknown>).deletedActivityIds;

    return {
      appleHealthCollectionSamples: null,
      cacheAvailable: true,
      deletedActivityIds: new Set(
        Array.isArray(rawDeletedActivityIds)
          ? rawDeletedActivityIds.filter(
              (activityId): activityId is string => typeof activityId === "string" && activityId.length > 0,
            )
          : [],
      ),
      generatedAt:
        typeof parsed.generatedAt === "string" && parsed.generatedAt.length > 0
          ? parsed.generatedAt
          : new Date(0).toISOString(),
      provider,
      activities: Object.fromEntries(
        Object.entries(parsed.activities as Record<string, ProviderCachedActivity>).filter(([activityId]) =>
          referencedActivityIds.has(activityId),
        ),
      ),
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return {
        appleHealthCollectionSamples: null,
        cacheAvailable: false,
        deletedActivityIds: new Set<string>(),
        generatedAt: new Date(0).toISOString(),
        provider,
        activities: {},
      };
    }

    throw new Error(
      `Unable to read ${provider} cache export at ${cachePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function collectReferencedActivityIds(
  noteInputs: Array<{ fileName: string; document: WorkoutNoteSourceDocument }>,
): Record<WorkoutProvider, Set<string>> {
  const references = Object.fromEntries(
    WORKOUT_PROVIDERS.map((provider) => [provider, new Set<string>()]),
  ) as Record<WorkoutProvider, Set<string>>;

  for (const noteInput of noteInputs) {
    const legacyStravaId = normalizeOptionalInteger(noteInput.document.stravaId, noteInput.fileName, "stravaId");
    const activityRefs = normalizeActivityRefs(noteInput.document.activityRefs, noteInput.fileName);
    if (legacyStravaId !== null) {
      activityRefs.strava ??= String(legacyStravaId);
    }

    for (const provider of WORKOUT_PROVIDERS) {
      const activityId = activityRefs[provider];
      if (activityId) {
        references[provider].add(activityId);
      }
    }
  }

  return references;
}

async function readSelectedActivitiesFromLargeJson(
  cachePath: string,
  referencedActivityIds: Set<string>,
): Promise<Record<string, ProviderCachedActivity>> {
  if (referencedActivityIds.size === 0) {
    return {};
  }

  try {
    return await readSelectedActivitiesFromLargeJsonWithJq(cachePath, referencedActivityIds);
  } catch {
    // Fall back to the in-process scanner if jq is unavailable.
  }

  const fileHandle = await fs.open(cachePath, "r");
  try {
    const activitiesJson = await extractPropertyJson(fileHandle, "activities", 0x7b);
    if (!activitiesJson) {
      return {};
    }

    const parsedActivities = JSON.parse(activitiesJson) as Record<string, ProviderCachedActivity>;
    return Object.fromEntries(
      Object.entries(parsedActivities).filter(([activityId]) => referencedActivityIds.has(activityId)),
    );
  } finally {
    await fileHandle.close();
  }
}

async function readAppleHealthCacheSnapshot(
  cachePath: string,
  referencedActivityIds: Set<string>,
): Promise<{
  activities: Record<string, ProviderCachedActivity>;
  collectionSamples: Record<AppleHealthMeasurementKey, AppleHealthCollectionSampleRecord[]>;
  deletedActivityIds: Set<string>;
}> {
  try {
    return await readAppleHealthCacheSnapshotWithJq(cachePath, referencedActivityIds);
  } catch {
    // Fall back to the existing multi-pass readers if jq is unavailable.
  }

  return {
    activities: await readSelectedActivitiesFromLargeJson(cachePath, referencedActivityIds),
    collectionSamples: await readAppleHealthCollectionSamples(cachePath, appleHealthMeasurementKeys),
    deletedActivityIds: await readDeletedActivityIdsFromLargeJson(cachePath),
  };
}

async function readDeletedActivityIdsFromLargeJson(cachePath: string): Promise<Set<string>> {
  try {
    return await readDeletedActivityIdsFromLargeJsonWithJq(cachePath);
  } catch {
    // Fall back to the in-process scanner if jq is unavailable.
  }

  const fileHandle = await fs.open(cachePath, "r");
  try {
    const arrayJson = await extractPropertyJson(fileHandle, "deletedActivityIds", 0x5b);
    if (!arrayJson) {
      return new Set<string>();
    }

    const parsed = JSON.parse(arrayJson) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }

    return new Set(
      parsed.filter((activityId): activityId is string => typeof activityId === "string" && activityId.length > 0),
    );
  } finally {
    await fileHandle.close();
  }
}

async function readSelectedActivitiesFromLargeJsonWithJq(
  cachePath: string,
  referencedActivityIds: Set<string>,
): Promise<Record<string, ProviderCachedActivity>> {
  const idsJson = JSON.stringify(Array.from(referencedActivityIds));
  const { stdout } = await execFileAsync(
    "jq",
    [
      "-c",
      "--argjson",
      "ids",
      idsJson,
      ".activities as $activities | reduce $ids[] as $id ({}; if $activities[$id] then . + {($id): $activities[$id]} else . end)",
      cachePath,
    ],
    { maxBuffer: 1024 * 1024 * 1024 },
  );

  return JSON.parse(stdout) as Record<string, ProviderCachedActivity>;
}

async function readAppleHealthCacheSnapshotWithJq(
  cachePath: string,
  referencedActivityIds: Set<string>,
): Promise<{
  activities: Record<string, ProviderCachedActivity>;
  collectionSamples: Record<AppleHealthMeasurementKey, AppleHealthCollectionSampleRecord[]>;
  deletedActivityIds: Set<string>;
}> {
  const idsJson = JSON.stringify(Array.from(referencedActivityIds));
  const keysJson = JSON.stringify(appleHealthMeasurementKeys);
  const { stdout } = await execFileAsync(
    "jq",
    [
      "-c",
      "--argjson",
      "ids",
      idsJson,
      "--argjson",
      "keys",
      keysJson,
      `{
        deletedActivityIds: (.deletedActivityIds // []),
        activities: (.activities as $activities | reduce $ids[] as $id ({}; if $activities[$id] then . + {($id): $activities[$id]} else . end)),
        collections: (.collections as $collections | reduce $keys[] as $key ({}; .[$key] = ($collections[$key].samples // [])))
      }`,
      cachePath,
    ],
    { maxBuffer: 1024 * 1024 * 1024 },
  );

  const parsed = JSON.parse(stdout) as {
    activities?: Record<string, ProviderCachedActivity>;
    collections?: Partial<Record<AppleHealthMeasurementKey, AppleHealthCollectionSampleRecord[]>>;
    deletedActivityIds?: unknown;
  };

  return {
    activities: parsed.activities ?? {},
    collectionSamples: {
      heartRate: parsed.collections?.heartRate ?? [],
      stepCount: parsed.collections?.stepCount ?? [],
      restingHeartRate: parsed.collections?.restingHeartRate ?? [],
      heartRateVariabilitySDNN: parsed.collections?.heartRateVariabilitySDNN ?? [],
      oxygenSaturation: parsed.collections?.oxygenSaturation ?? [],
      respiratoryRate: parsed.collections?.respiratoryRate ?? [],
      vo2Max: parsed.collections?.vo2Max ?? [],
      sleepAnalysis: parsed.collections?.sleepAnalysis ?? [],
    },
    deletedActivityIds: new Set(
      Array.isArray(parsed.deletedActivityIds)
        ? parsed.deletedActivityIds.filter(
            (activityId): activityId is string => typeof activityId === "string" && activityId.length > 0,
          )
        : [],
    ),
  };
}

async function readDeletedActivityIdsFromLargeJsonWithJq(cachePath: string): Promise<Set<string>> {
  const { stdout } = await execFileAsync("jq", ["-c", ".deletedActivityIds // []", cachePath], {
    maxBuffer: 16 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) {
    return new Set<string>();
  }

  return new Set(
    parsed.filter((activityId): activityId is string => typeof activityId === "string" && activityId.length > 0),
  );
}

async function extractPropertyJson(
  fileHandle: fs.FileHandle,
  propertyKey: string | Buffer,
  openingByte: number,
) {
  const keyPattern =
    typeof propertyKey === "string"
      ? Buffer.from(`${JSON.stringify(propertyKey)}:`, "utf8")
      : propertyKey;
  const chunkSize = 1024 * 1024;
  const buffer = Buffer.alloc(chunkSize);
  let position = 0;
  let tail = Buffer.alloc(0);

  while (true) {
    const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, position);
    if (bytesRead === 0) {
      return null;
    }

    const current = buffer.subarray(0, bytesRead);
    const haystack = tail.length > 0 ? Buffer.concat([tail, current]) : current;
    const relativeMatchIndex = haystack.indexOf(keyPattern);
    if (relativeMatchIndex !== -1) {
      const absoluteMatchIndex = position - tail.length + relativeMatchIndex;
      const objectStart = absoluteMatchIndex + keyPattern.length;
      return readJsonValueAt(fileHandle, objectStart, openingByte);
    }

    tail = haystack.subarray(Math.max(0, haystack.length - keyPattern.length));
    position += bytesRead;
  }
}

async function readJsonValueAt(fileHandle: fs.FileHandle, startPosition: number, openingByte: number) {
  const chunkSize = 256 * 1024;
  const buffer = Buffer.alloc(chunkSize);
  let position = startPosition;
  let depth = 0;
  let inString = false;
  let isEscaped = false;
  let hasStarted = false;
  const output: Buffer[] = [];

  while (true) {
    const { bytesRead } = await fileHandle.read(buffer, 0, chunkSize, position);
    if (bytesRead === 0) {
      throw new Error(`Reached end of file while reading JSON object at byte ${startPosition}`);
    }

    const chunk = buffer.subarray(0, bytesRead);
    for (let index = 0; index < chunk.length; index += 1) {
      const byte = chunk[index];

      if (!hasStarted) {
        if (byte !== openingByte) {
          continue;
        }
        hasStarted = true;
        depth = 1;
      } else if (inString) {
        if (isEscaped) {
          isEscaped = false;
        } else if (byte === 0x5c) {
          isEscaped = true;
        } else if (byte === 0x22) {
          inString = false;
        }
      } else if (byte === 0x22) {
        inString = true;
      } else if (byte === 0x7b || byte === 0x5b) {
        depth += 1;
      } else if (byte === 0x7d || byte === 0x5d) {
        depth -= 1;
      }

      if (hasStarted) {
        output.push(chunk.subarray(index, index + 1));
      }

      if (hasStarted && depth === 0) {
        return Buffer.concat(output).toString("utf8");
      }
    }

    position += bytesRead;
  }
}

async function readExistingGeneratedData(): Promise<WorkoutsData | null> {
  try {
    const fileContent = await fs.readFile(generatedPath, "utf8");
    return JSON.parse(fileContent) as WorkoutsData;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return null;
    }

    throw new Error(
      `Unable to read existing generated workouts at ${generatedPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function readExistingWorkoutSourceDetails(): Promise<WorkoutSourceDetailsPayload | null> {
  try {
    const fileContent = await fs.readFile(generatedWorkoutSourceDetailsPath, "utf8");
    return JSON.parse(fileContent) as WorkoutSourceDetailsPayload;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return null;
    }

    throw new Error(
      `Unable to read existing generated workout source details at ${generatedWorkoutSourceDetailsPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function assertNotesDirectory(notesDir: string) {
  try {
    const stats = await fs.stat(notesDir);
    if (!stats.isDirectory()) {
      throw new Error(`Workout notes path is not a directory: ${notesDir}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Unable to read workout notes directory: ${notesDir}`,
        `Expected structure: <data-root>/${notesDirName}/*.json with PLAN.md, WELCOME.md, GOALS.md, AGENTS.md, goals/*.md, metaanalysis/HEART_RATE.md, and metaanalysis/MORNING_MOBILITY.md in <data-root>`,
        `Details: ${detail}`,
      ].join("\n"),
    );
  }
}

function listWorkoutNoteFileNames(fileNames: string[]) {
  const preferredByBaseName = new Map<string, string>();

  for (const fileName of [...fileNames].sort((left, right) => left.localeCompare(right))) {
    if (!fileName.endsWith(".json") && !fileName.endsWith(".md")) {
      continue;
    }

    const baseName = getWorkoutNoteBaseName(fileName);
    const existing = preferredByBaseName.get(baseName);
    if (!existing || fileName.endsWith(".json")) {
      preferredByBaseName.set(baseName, fileName);
    }
  }

  return [...preferredByBaseName.values()].sort((left, right) => left.localeCompare(right));
}

async function assertGoalNotesDirectory(goalsDir: string) {
  try {
    const stats = await fs.stat(goalsDir);
    if (!stats.isDirectory()) {
      throw new Error(`Goal notes path is not a directory: ${goalsDir}`);
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Unable to read goal notes directory: ${goalsDir}`,
        `Expected structure: <data-root>/${goalsDirName}/*.md`,
        `Details: ${detail}`,
      ].join("\n"),
    );
  }
}

async function readDocument(filePath: string, rootPath: string) {
  const fileContent = await fs.readFile(filePath, "utf8");
  const sourcePath = path.relative(rootPath, filePath).replaceAll("\\", "/");
  return buildPlanDocument(fileContent, sourcePath);
}

async function readChangelogEntries(changelogDir: string, rootPath: string): Promise<ChangelogEntry[]> {
  try {
    const stats = await fs.stat(changelogDir);
    if (!stats.isDirectory()) {
      throw new Error(`Changelog path is not a directory: ${changelogDir}`);
    }
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const fileNames = (await fs.readdir(changelogDir))
    .filter((fileName) => fileName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));

  const entries = await Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = path.join(changelogDir, fileName);
      const sourcePath = path.relative(rootPath, filePath).replaceAll("\\", "/");
      const fileContent = await fs.readFile(filePath, "utf8");
      return buildChangelogEntry(fileName, fileContent, sourcePath);
    }),
  );

  return entries.sort((left, right) =>
    left.date === right.date ? right.slug.localeCompare(left.slug) : right.date.localeCompare(left.date),
  );
}

function getCliFlagValue(flag: string) {
  const flagIndex = process.argv.findIndex((argument) => argument === flag);
  if (flagIndex === -1) {
    return null;
  }

  const nextValue = process.argv[flagIndex + 1];
  if (!nextValue || nextValue.startsWith("--")) {
    throw new Error(`${flag} requires a path value`);
  }

  return nextValue;
}

function buildPlanDocument(fileContent: string, sourcePath: string): PlanDocument {
  const titleMatch = fileContent.match(/^#\s+(.+)$/m);

  return {
    title: titleMatch?.[1]?.trim() ?? "Training Plan",
    body: sanitizePublicText(fileContent.trim()),
    sourcePath,
  };
}

function buildChangelogEntry(fileName: string, fileContent: string, sourcePath: string): ChangelogEntry {
  const parsed = matter(fileContent);
  const data = parsed.data;

  return {
    slug: slugify(fileName.replace(/\.md$/u, "")),
    title: expectString(data.title, fileName, "title"),
    date: normalizeDate(data.date, fileName, "date"),
    scope: normalizeNullableString(data.scope),
    tags: normalizeStringArray(data.tags, fileName, "tags"),
    affectedFiles: normalizeStringArray(data.affectedFiles, fileName, "affectedFiles"),
    body: sanitizePublicText(parsed.content.trim()),
    sourcePath,
  };
}

function buildGoalNote(fileName: string, fileContent: string, sourcePath: string): GoalNote {
  const parsed = matter(fileContent);
  const data = parsed.data;

  return {
    slug: slugify(fileName.replace(/\.md$/u, "")),
    title: expectString(data.title, fileName, "title"),
    emoji: expectString(data.emoji, fileName, "emoji"),
    date: normalizeDate(data.date, fileName, "date"),
    body: sanitizePublicText(parsed.content.trim()),
    sourcePath,
  };
}

function buildWorkoutNote(
  fileName: string,
  document: WorkoutNoteSourceDocument,
  sourcePath: string,
  providerCaches: Record<WorkoutProvider, ProviderCacheSnapshot>,
  existingFallback: GeneratedWorkoutFallback | null,
  mediaThumbnailUrl: string | null,
): WorkoutNote {
  const legacyStravaId = normalizeOptionalInteger(document.stravaId, fileName, "stravaId");
  const activityRefs = normalizeActivityRefs(document.activityRefs, fileName);
  if (legacyStravaId !== null) {
    const normalizedLegacyStravaId = String(legacyStravaId);
    if (
      activityRefs.strava !== undefined &&
      activityRefs.strava !== normalizedLegacyStravaId
    ) {
      throw new Error(`${fileName}: stravaId and activityRefs.strava must match when both are set`);
    }
    activityRefs.strava ??= normalizedLegacyStravaId;
  }

  const validFallback =
    existingFallback && activityRefsMatch(existingFallback.activityRefs, activityRefs) ? existingFallback : null;
  const hasDeletedLinkedActivity = linkedActivityWasDeleted(activityRefs, providerCaches);
  const importedFromStrava = activityRefs.strava !== undefined && hasImportedFromStravaSection(document);
  const notedExpectedDistance = normalizeNullableString(document.expectedDistance);
  const notedActualDistance = normalizeNullableString(document.actualDistance);
  const sources = buildWorkoutSources(activityRefs, providerCaches, existingFallback);
  const displaySource = selectDisplaySourceSummary(sources, activityRefs);
  const expectedDistance =
    importedFromStrava && notedActualDistance === null ? null : notedExpectedDistance;
  const expectedDistanceKm = normalizeDistanceKm(expectedDistance);
  const actualDistance =
    notedActualDistance ??
    displaySource?.actualDistance ??
    (hasDeletedLinkedActivity ? null : validFallback?.actualDistance) ??
    (importedFromStrava ? notedExpectedDistance : null);
  const actualDistanceKm =
    normalizeDistanceKm(notedActualDistance) ??
    displaySource?.actualDistanceKm ??
    (hasDeletedLinkedActivity ? null : validFallback?.actualDistanceKm) ??
    (importedFromStrava ? normalizeDistanceKm(notedExpectedDistance) : null);
  const slug = slugify(getWorkoutNoteBaseName(fileName));
  const hasRouteStreams = Boolean(displaySource?.hasRouteStreams && displaySource.routePath);
  const hasAppleHealthMeasurements = Boolean(activityRefs.appleHealth);

  return {
    slug,
    title: expectString(document.title, fileName, "title"),
    date: normalizeDate(document.date, fileName, "date"),
    eventType: normalizeEventType(document.eventType, fileName),
    expectedDistance,
    expectedDistanceKm,
    actualDistance,
    actualDistanceKm,
    completed: normalizeCompleted(document.completed, fileName),
    stravaId: activityRefs.strava ? Number(activityRefs.strava) : null,
    dataSource: normalizeLegacyDataSource(displaySource?.provider ?? null),
    actualMovingTimeSeconds: displaySource?.movingTimeSeconds ?? null,
    actualElapsedTimeSeconds: displaySource?.elapsedTimeSeconds ?? null,
    averageHeartrate: displaySource?.averageHeartrate ?? null,
    maxHeartrate: displaySource?.maxHeartrate ?? null,
    summaryPolyline: displaySource?.summaryPolyline ?? null,
    primaryImageUrl: displaySource?.primaryImageUrl
      ? buildPublicWorkoutImagePath(slug, displaySource.primaryImageUrl)
      : null,
    mediaThumbnailUrl,
    weather:
      selectWorkoutWeather(activityRefs, providerCaches) ??
      (hasDeletedLinkedActivity ? null : validFallback?.weather ?? null),
    hasStravaStreams: Boolean(sources.strava?.hasRouteStreams && sources.strava.routePath),
    hasRouteStreams,
    routePath: hasRouteStreams ? buildPublicWorkoutRoutePath(slug) : null,
    measurementsPath: hasAppleHealthMeasurements ? buildPublicWorkoutMeasurementsPath(slug) : null,
    activityRefs,
    sources,
    allDay: expectBoolean(document.allDay, fileName, "allDay"),
    type: expectString(document.type, fileName, "type"),
    body: sanitizePublicText(renderWorkoutNoteSourceDocumentBody(document)),
    media: document.media ?? null,
    sections: sanitizePublicWorkoutSections(document.sections),
    sourcePath,
  };
}

function buildWorkoutSources(
  activityRefs: WorkoutActivityRefMap,
  providerCaches: Record<WorkoutProvider, ProviderCacheSnapshot>,
  existingFallback: GeneratedWorkoutFallback | null,
) {
  const sources: Partial<Record<WorkoutProvider, WorkoutSourceSummary>> = {};

  for (const provider of WORKOUT_PROVIDERS) {
    const activityId = activityRefs[provider];
    if (!activityId) {
      continue;
    }

    const providerCache = providerCaches[provider];
    const cachedActivity = providerCache.activities[activityId] ?? null;
    const cachedSource = buildWorkoutSourceSummary(provider, activityId, cachedActivity);
    const fallbackSource = providerActivityRefMatches(existingFallback?.activityRefs, activityRefs, provider)
      ? existingFallback?.sources[provider] ?? null
      : null;
    const source = providerCache.deletedActivityIds.has(activityId) ? cachedSource : cachedSource ?? fallbackSource;
    if (source) {
      sources[provider] = source;
    }
  }

  return sources;
}

function linkedActivityWasDeleted(
  activityRefs: WorkoutActivityRefMap,
  providerCaches: Record<WorkoutProvider, ProviderCacheSnapshot>,
) {
  return WORKOUT_PROVIDERS.some((provider) => {
    const activityId = activityRefs[provider];
    return activityId ? providerCaches[provider].deletedActivityIds.has(activityId) : false;
  });
}

function buildWorkoutSourceSummary(
  provider: WorkoutProvider,
  activityId: string,
  activity: ProviderCachedActivity | null,
): WorkoutSourceSummary | null {
  if (!activity) {
    return null;
  }

  return {
    provider,
    activityId,
    sportType: normalizeNullableString(activity.sportType),
    startDate: normalizeNullableString(activity.startDate),
    actualDistance: normalizeCachedDistanceLabel(activity),
    actualDistanceKm: normalizeCachedDistanceKm(activity),
    movingTimeSeconds: normalizeCachedInteger(activity.movingTimeSeconds),
    elapsedTimeSeconds: normalizeCachedInteger(activity.elapsedTimeSeconds),
    averageHeartrate: normalizeCachedNumber(activity.averageHeartrate),
    maxHeartrate: normalizeCachedNumber(activity.maxHeartrate),
    summaryPolyline: normalizeNullableString(activity.summaryPolyline),
    hasRouteStreams: activity.hasStreams === true,
    routePath: activity.hasStreams === true ? buildRoutePath(provider, activityId) : null,
    primaryImageUrl: normalizeCachedImageUrl(activity),
    source: normalizeSourceMetadata(activity.source),
  };
}

function buildGeneratedWorkoutFallback(workout: WorkoutNote): GeneratedWorkoutFallback {
  const legacy = workout as WorkoutNote & LegacyGeneratedWorkoutShape;
  const legacyStravaId =
    typeof legacy.stravaId === "number" && Number.isFinite(legacy.stravaId) ? String(legacy.stravaId) : null;
  const activityRefs = normalizeGeneratedActivityRefs(legacy.activityRefs, legacyStravaId);
  const sources = normalizeGeneratedSources(legacy.sources, legacy, activityRefs);

  return {
    actualDistance: normalizeNullableString(workout.actualDistance),
    actualDistanceKm: normalizeCachedNumber(workout.actualDistanceKm),
    activityRefs,
    weather: normalizeCachedWeather(legacy.weather),
    sources,
  };
}

function toPublicWorkoutNote(workout: WorkoutNote): WorkoutNote {
  const publicWorkout: WorkoutNote = { ...workout };
  delete publicWorkout.stravaId;
  delete publicWorkout.dataSource;
  delete publicWorkout.hasStravaStreams;
  delete publicWorkout.activityRefs;
  delete publicWorkout.sources;
  return publicWorkout;
}

function selectWorkoutWeather(
  activityRefs: WorkoutActivityRefMap,
  providerCaches: Record<WorkoutProvider, ProviderCacheSnapshot>,
) {
  for (const provider of providerDisplayOrder) {
    const activityId = activityRefs[provider];
    if (!activityId) {
      continue;
    }

    const weather = normalizeCachedWeather(providerCaches[provider].activities[activityId]?.weather);
    if (weather) {
      return weather;
    }
  }

  for (const provider of WORKOUT_PROVIDERS) {
    const activityId = activityRefs[provider];
    if (!activityId) {
      continue;
    }

    const weather = normalizeCachedWeather(providerCaches[provider].activities[activityId]?.weather);
    if (weather) {
      return weather;
    }
  }

  return null;
}

function normalizeGeneratedActivityRefs(
  value: WorkoutActivityRefMap | undefined,
  legacyStravaId: string | null,
): WorkoutActivityRefMap {
  const refs: WorkoutActivityRefMap = {};

  if (value && typeof value === "object") {
    for (const provider of WORKOUT_PROVIDERS) {
      const normalizedValue = normalizeNullableString(value[provider]);
      if (normalizedValue) {
        refs[provider] = normalizedValue;
      }
    }
  }

  if (legacyStravaId && !refs.strava) {
    refs.strava = legacyStravaId;
  }

  return refs;
}

function normalizeGeneratedSources(
  value: Partial<Record<WorkoutProvider, WorkoutSourceSummary>> | undefined,
  legacy: LegacyGeneratedWorkoutShape,
  activityRefs: WorkoutActivityRefMap,
) {
  const sources: Partial<Record<WorkoutProvider, WorkoutSourceSummary>> = {};

  if (value && typeof value === "object") {
    for (const provider of WORKOUT_PROVIDERS) {
      const source = value[provider];
      if (source) {
        sources[provider] = {
          ...source,
          provider,
          activityId: normalizeNullableString(source.activityId) ?? activityRefs[provider] ?? source.activityId,
          routePath:
            normalizeNullableString(source.routePath) ??
            (source.hasRouteStreams && activityRefs[provider]
              ? buildRoutePath(provider, activityRefs[provider] as string)
              : null),
          primaryImageUrl: normalizeNullableString(source.primaryImageUrl),
        };
      }
    }
  }

  if (!sources.strava && activityRefs.strava) {
    const legacySource = buildLegacyStravaSourceSummary(legacy, activityRefs.strava);
    if (legacySource) {
      sources.strava = legacySource;
    }
  }

  return sources;
}

function buildLegacyStravaSourceSummary(
  legacy: LegacyGeneratedWorkoutShape,
  activityId: string,
): WorkoutSourceSummary | null {
  const summaryPolyline = normalizeNullableString(legacy.summaryPolyline);
  const hasRouteStreams = legacy.hasStravaStreams === true;
  const hasSummaryData =
    summaryPolyline !== null ||
    hasRouteStreams ||
    normalizeCachedInteger(legacy.actualMovingTimeSeconds) !== null ||
    normalizeCachedInteger(legacy.actualElapsedTimeSeconds) !== null ||
    normalizeCachedNumber(legacy.averageHeartrate) !== null ||
    normalizeCachedNumber(legacy.maxHeartrate) !== null;

  if (!hasSummaryData) {
    return null;
  }

  return {
    provider: "strava",
    activityId,
    sportType: null,
    startDate: null,
    actualDistance: null,
    actualDistanceKm: null,
    movingTimeSeconds: normalizeCachedInteger(legacy.actualMovingTimeSeconds),
    elapsedTimeSeconds: normalizeCachedInteger(legacy.actualElapsedTimeSeconds),
    averageHeartrate: normalizeCachedNumber(legacy.averageHeartrate),
    maxHeartrate: normalizeCachedNumber(legacy.maxHeartrate),
    summaryPolyline,
    hasRouteStreams,
    routePath: hasRouteStreams ? buildLegacyStravaRoutePath(activityId) : null,
    primaryImageUrl: normalizeNullableString(legacy.primaryImageUrl),
    source: null,
  };
}

function buildLegacyStravaRoutePath(activityId: string) {
  return `/generated/workout-routes/${activityId}.json`;
}

function normalizeActivityRefs(value: unknown, fileName: string): WorkoutActivityRefMap {
  if (value === null || value === undefined) {
    return {};
  }

  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fileName}: activityRefs must be an object map of provider ids`);
  }

  const candidate = value as Record<string, unknown>;
  const refs: WorkoutActivityRefMap = {};

  for (const key of Object.keys(candidate)) {
    if (!WORKOUT_PROVIDERS.includes(key as WorkoutProvider)) {
      throw new Error(`${fileName}: activityRefs contains unsupported provider "${key}"`);
    }
  }

  for (const provider of WORKOUT_PROVIDERS) {
    const normalizedValue = normalizeOptionalActivityId(candidate[provider], fileName, `activityRefs.${provider}`);
    if (normalizedValue !== null) {
      refs[provider] = normalizedValue;
    }
  }

  return refs;
}

function normalizeOptionalActivityId(value: unknown, fileName: string, field: string) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return null;
    }

    return normalized;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  throw new Error(`${fileName}: ${field} must be a string or number`);
}

function activityRefsMatch(left: WorkoutActivityRefMap, right: WorkoutActivityRefMap) {
  return WORKOUT_PROVIDERS.every((provider) => activityRefValuesMatch(provider, left[provider], right[provider]));
}

function providerActivityRefMatches(
  left: WorkoutActivityRefMap | null | undefined,
  right: WorkoutActivityRefMap,
  provider: WorkoutProvider,
) {
  return activityRefValuesMatch(provider, left?.[provider], right[provider]);
}

function activityRefValuesMatch(
  provider: WorkoutProvider,
  left: string | undefined,
  right: string | undefined,
) {
  return normalizeComparableActivityRef(provider, left) === normalizeComparableActivityRef(provider, right);
}

function normalizeComparableActivityRef(provider: WorkoutProvider, activityId: string | undefined) {
  if (!activityId) {
    return null;
  }

  return provider === "appleHealth" ? toPublicActivityId(provider, activityId) : activityId;
}

function selectDisplaySourceSummary(
  sources: Partial<Record<WorkoutProvider, WorkoutSourceSummary>>,
  activityRefs: WorkoutActivityRefMap,
) {
  for (const provider of providerDisplayOrder) {
    if (activityRefs[provider] && sources[provider]) {
      return sources[provider] ?? null;
    }
  }

  for (const provider of WORKOUT_PROVIDERS) {
    if (sources[provider]) {
      return sources[provider] ?? null;
    }
  }

  return null;
}

function normalizeLegacyDataSource(provider: WorkoutProvider | null) {
  if (provider === "strava") {
    return "strava";
  }

  if (provider === "appleHealth") {
    return "apple-health";
  }

  return null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function expectString(value: unknown, fileName: string, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fileName}: ${field} must be a non-empty string`);
  }

  return value.trim();
}

function expectBoolean(value: unknown, fileName: string, field: string) {
  if (typeof value !== "boolean") {
    throw new Error(`${fileName}: ${field} must be a boolean`);
  }

  return value;
}

function normalizeNullableString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}

function normalizeStringArray(value: unknown, fileName: string, field: string) {
  if (value === null || value === undefined) {
    return [];
  }

  const items = Array.isArray(value) ? value : [value];
  const normalized = items
    .map((item) => {
      if (typeof item !== "string") {
        throw new Error(`${fileName}: ${field} must contain only strings`);
      }

      const trimmed = item.trim();
      if (trimmed.length === 0) {
        throw new Error(`${fileName}: ${field} must not contain empty strings`);
      }

      return trimmed;
    })
    .filter((item, index, allItems) => allItems.indexOf(item) === index);

  return normalized;
}

function normalizeDistanceKm(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const raw = normalizeNullableString(value);
  if (!raw) {
    return null;
  }

  const match = raw.match(/-?\d+(?:\.\d+)?/u);
  return match ? Number.parseFloat(match[0]) : null;
}

function normalizeCachedDistanceKm(activity: ProviderCachedActivity | null) {
  if (!activity) {
    return null;
  }

  const directDistanceKm = normalizeCachedNumber(activity.distanceKm);
  if (directDistanceKm !== null) {
    return directDistanceKm;
  }

  const distanceMeters = normalizeCachedNumber(activity.distanceMeters);
  return distanceMeters === null ? null : distanceMeters / 1000;
}

function normalizeCachedDistanceLabel(activity: ProviderCachedActivity | null) {
  const distanceKm = normalizeCachedDistanceKm(activity);
  if (distanceKm === null) {
    return null;
  }

  return `${trimTrailingZero(distanceKm)} km`;
}

function normalizeCachedImageUrl(activity: ProviderCachedActivity | null) {
  const fileName = normalizeNullableString((activity as unknown as Record<string, unknown> | null)?.primaryImageFileName as string | null);
  if (!fileName) {
    return null;
  }

  return `/generated/workout-images/${encodeURIComponent(fileName)}`;
}

function normalizeCachedWeather(value: unknown): WorkoutWeather | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<WorkoutWeather>;
  const provider = normalizeNullableString(candidate.provider);
  const lookedUpAt = normalizeNullableString(candidate.lookedUpAt);
  if (!provider || !lookedUpAt) {
    return null;
  }

  return {
    provider,
    lookedUpAt,
    startTemperatureC: normalizeCachedNumber(candidate.startTemperatureC),
    endTemperatureC: normalizeCachedNumber(candidate.endTemperatureC),
    averageTemperatureC: normalizeCachedNumber(candidate.averageTemperatureC),
    apparentTemperatureC: normalizeCachedNumber(candidate.apparentTemperatureC),
    humidityPercent: normalizeCachedNumber(candidate.humidityPercent),
    precipitationMm: normalizeCachedNumber(candidate.precipitationMm),
    windSpeedKph: normalizeCachedNumber(candidate.windSpeedKph),
    windGustKph: normalizeCachedNumber(candidate.windGustKph),
    weatherCode: normalizeCachedInteger(candidate.weatherCode),
    summary: normalizeNullableString(candidate.summary),
  };
}

function normalizeCachedNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return value;
}

function normalizeCachedInteger(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}

function normalizeSourceMetadata(value: unknown): WorkoutSourceMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const metadata: WorkoutSourceMetadata = {
    name: normalizeNullableString(candidate.name),
    deviceName: normalizeNullableString(candidate.deviceName),
    deviceModel: normalizeNullableString(candidate.deviceModel),
  };

  return metadata.name || metadata.deviceName || metadata.deviceModel
    ? metadata
    : null;
}

function normalizeRouteStreams(value: unknown): WorkoutRouteStreams | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<WorkoutRouteStreams>;
  return {
    latlng: normalizeCoordinateSeries(candidate.latlng),
    altitude: normalizeNumberSeries(candidate.altitude),
    distance: normalizeNumberSeries(candidate.distance),
    heartrate: normalizeNumberSeries(candidate.heartrate),
    velocitySmooth: normalizeNumberSeries(candidate.velocitySmooth),
    moving: normalizeBooleanSeries(candidate.moving),
  };
}

async function writeRouteStreamFiles(
  workouts: WorkoutNote[],
  providerCaches: Record<WorkoutProvider, ProviderCacheSnapshot>,
) {
  await fs.rm(legacyGeneratedRouteStreamsPath, { force: true });
  await fs.rm(generatedRouteStreamsDir, { force: true, recursive: true });

  const hasAnyAvailableCache = WORKOUT_PROVIDERS.some((provider) => providerCaches[provider].cacheAvailable);
  if (!hasAnyAvailableCache) {
    return;
  }

  const routeStreamsBySlug = new Map<string, WorkoutRouteStreams>();
  for (const workout of workouts) {
    if (!workout.routePath || !workout.sources || !workout.activityRefs) {
      continue;
    }

    const displaySource = selectDisplaySourceSummary(workout.sources, workout.activityRefs);
    if (!displaySource || !displaySource.hasRouteStreams) {
      continue;
    }

    const routeStreams = normalizeRouteStreams(
      providerCaches[displaySource.provider].activities[displaySource.activityId]?.routeStreams,
    );
    if (routeStreams) {
      routeStreamsBySlug.set(workout.slug, routeStreams);
    }
  }

  if (routeStreamsBySlug.size === 0) {
    return;
  }

  await fs.mkdir(generatedRouteStreamsDir, { recursive: true });
  await Promise.all(
    [...routeStreamsBySlug.entries()].map(async ([slug, routeStreams]) => {
      const outputPath = path.join(generatedRouteStreamsDir, `${slug}.json`);
      await fs.writeFile(outputPath, `${JSON.stringify(routeStreams, null, 2)}\n`, "utf8");
    }),
  );
}

async function writeAppleHealthMeasurementFiles(
  workouts: WorkoutNote[],
  appleHealthCache: ProviderCacheSnapshot,
  collectionSamples: Record<AppleHealthMeasurementKey, AppleHealthCollectionSampleRecord[]> | null,
) {
  await fs.rm(generatedWorkoutMeasurementsDir, { force: true, recursive: true });

  if (!collectionSamples) {
    return;
  }

  const activityWindows = buildAppleHealthActivityWindows(workouts, appleHealthCache);
  if (activityWindows.length === 0) {
    return;
  }

  const measurementsByActivity = buildAppleHealthMeasurementsByActivity(activityWindows, collectionSamples);
  if (Object.keys(measurementsByActivity).length === 0) {
    return;
  }

  await fs.mkdir(generatedWorkoutMeasurementsDir, { recursive: true });
  await Promise.all(
    Object.entries(measurementsByActivity).map(async ([slug, measurements]) => {
      const outputPath = path.join(generatedWorkoutMeasurementsDir, `${slug}.json`);
      await fs.writeFile(outputPath, `${JSON.stringify(measurements, null, 2)}\n`, "utf8");
    }),
  );
}

function buildAppleHealthActivityWindows(
  workouts: WorkoutNote[],
  appleHealthCache: ProviderCacheSnapshot,
) {
  const windowsByActivity = new Map<string, AppleHealthActivityWindow>();

  for (const workout of workouts) {
    const activityId = workout.activityRefs?.appleHealth;
    if (!activityId) {
      continue;
    }

    const cachedActivity = appleHealthCache.activities[activityId];
    const startDate = normalizeNullableString(cachedActivity?.startDate);
    const elapsedTimeSeconds = normalizeCachedInteger(cachedActivity?.elapsedTimeSeconds);
    if (!cachedActivity || !startDate || elapsedTimeSeconds === null) {
      continue;
    }

    const startMs = Date.parse(startDate);
    if (!Number.isFinite(startMs)) {
      continue;
    }

    windowsByActivity.set(activityId, {
      activityId,
      elapsedTimeSeconds,
      endMs: startMs + elapsedTimeSeconds * 1000,
      source: normalizeSourceMetadata(cachedActivity.source),
      startDate,
      startMs,
      workoutSlug: workout.slug,
    });
  }

  return [...windowsByActivity.values()].sort((left, right) => left.startMs - right.startMs);
}

async function readAppleHealthCollectionSamples(
  cachePath: string,
  keys: AppleHealthMeasurementKey[],
): Promise<Record<AppleHealthMeasurementKey, AppleHealthCollectionSampleRecord[]>> {
  const keysJson = JSON.stringify(keys);
  const { stdout } = await execFileAsync(
    "jq",
    [
      "-c",
      "--argjson",
      "keys",
      keysJson,
      ".collections as $collections | reduce $keys[] as $key ({}; .[$key] = ($collections[$key].samples // []))",
      cachePath,
    ],
    { maxBuffer: 1024 * 1024 * 1024 },
  );

  const parsed = JSON.parse(stdout) as Partial<Record<AppleHealthMeasurementKey, AppleHealthCollectionSampleRecord[]>>;
  return {
    heartRate: parsed.heartRate ?? [],
    stepCount: parsed.stepCount ?? [],
    restingHeartRate: parsed.restingHeartRate ?? [],
    heartRateVariabilitySDNN: parsed.heartRateVariabilitySDNN ?? [],
    oxygenSaturation: parsed.oxygenSaturation ?? [],
    respiratoryRate: parsed.respiratoryRate ?? [],
    vo2Max: parsed.vo2Max ?? [],
    sleepAnalysis: parsed.sleepAnalysis ?? [],
  };
}

function buildAppleHealthMeasurementsByActivity(
  activityWindows: AppleHealthActivityWindow[],
  collectionSamples: Record<AppleHealthMeasurementKey, AppleHealthCollectionSampleRecord[]>,
) {
  const heartRateByActivity = matchAppleHealthSamplesToActivityWindows(activityWindows, collectionSamples.heartRate);
  const stepCountByActivity = matchAppleHealthSamplesToActivityWindows(activityWindows, collectionSamples.stepCount);
  const measurementsByActivity: Record<string, AppleHealthWorkoutMeasurements> = {};

  for (const window of activityWindows) {
    const series: AppleHealthMeasurementSeries[] = [];
    const heartRateSeries = buildLineMeasurementSeries(
      "heartRate",
      "Heart Rate",
      "bpm",
      window.startMs,
      heartRateByActivity.get(window.activityId) ?? [],
    );
    if (heartRateSeries) {
      series.push(heartRateSeries);
    }

    const cadenceSeries = buildDerivedCadenceMeasurementSeries(
      window.startMs,
      window.endMs,
      stepCountByActivity.get(window.activityId) ?? [],
    );
    if (cadenceSeries) {
      series.push(cadenceSeries);
    }

    const contextSeries = [
      buildContextNumericMeasurementSeries(window, collectionSamples.restingHeartRate, {
        key: "restingHeartRate",
        label: "Resting Heart Rate",
        unit: "bpm",
        lookbackDays: 7,
        lookaheadDays: 0,
      }),
      buildContextNumericMeasurementSeries(window, collectionSamples.heartRateVariabilitySDNN, {
        key: "heartRateVariabilitySDNN",
        label: "HRV",
        unit: "ms",
        lookbackDays: 7,
        lookaheadDays: 0,
      }),
      buildContextNumericMeasurementSeries(window, collectionSamples.oxygenSaturation, {
        key: "oxygenSaturation",
        label: "Blood Oxygen",
        unit: "%",
        lookbackDays: 7,
        lookaheadDays: 0,
        transformValue: (value) => value * 100,
      }),
      buildContextNumericMeasurementSeries(window, collectionSamples.respiratoryRate, {
        key: "respiratoryRate",
        label: "Respiratory Rate",
        unit: "br/min",
        lookbackDays: 7,
        lookaheadDays: 0,
      }),
      buildContextNumericMeasurementSeries(window, collectionSamples.vo2Max, {
        key: "vo2Max",
        label: "VO2 Max",
        unit: "ml/kg/min",
        lookbackDays: 7,
        lookaheadDays: 0,
      }),
      buildSleepDurationSeries(window, collectionSamples.sleepAnalysis),
    ].filter((candidate): candidate is AppleHealthMeasurementSeries => candidate !== null);
    series.push(...contextSeries);

    if (series.length === 0) {
      continue;
    }

    measurementsByActivity[window.workoutSlug] = {
      workoutSlug: window.workoutSlug,
      startDate: window.startDate,
      elapsedTimeSeconds: window.elapsedTimeSeconds,
      series,
    };
  }

  return measurementsByActivity;
}

function matchAppleHealthSamplesToActivityWindows(
  activityWindows: AppleHealthActivityWindow[],
  samples: AppleHealthCollectionSampleRecord[],
) {
  const matches = new Map<string, AppleHealthCollectionSampleRecord[]>();
  for (const window of activityWindows) {
    matches.set(window.activityId, []);
  }

  const sortedSamples = [...samples].sort((left, right) => {
    const leftStart = Date.parse(left.startDate ?? "");
    const rightStart = Date.parse(right.startDate ?? "");
    return leftStart - rightStart;
  });

  let windowIndex = 0;
  for (const sample of sortedSamples) {
    const sampleStartMs = Date.parse(sample.startDate ?? "");
    const sampleEndMs = Date.parse(sample.endDate ?? sample.startDate ?? "");
    if (!Number.isFinite(sampleStartMs) || !Number.isFinite(sampleEndMs)) {
      continue;
    }

    while (windowIndex < activityWindows.length && activityWindows[windowIndex].endMs < sampleStartMs) {
      windowIndex += 1;
    }

    for (
      let candidateIndex = windowIndex;
      candidateIndex < activityWindows.length && activityWindows[candidateIndex].startMs <= sampleEndMs;
      candidateIndex += 1
    ) {
      const window = activityWindows[candidateIndex];
      if (sampleStartMs > window.endMs || sampleEndMs < window.startMs) {
        continue;
      }

      if (!appleHealthSampleMatchesSource(sample, window.source)) {
        continue;
      }

      matches.get(window.activityId)?.push(sample);
    }
  }

  return matches;
}

function appleHealthSampleMatchesSource(
  sample: AppleHealthCollectionSampleRecord,
  activitySource: WorkoutSourceMetadata | null,
) {
  if (isWorkoutHeartRateSample(sample)) {
    return true;
  }

  if (!activitySource || !sample.source) {
    return true;
  }

  const comparableFields: Array<keyof WorkoutSourceMetadata> = ["deviceName", "deviceModel", "name"];
  let comparedAnyField = false;

  for (const field of comparableFields) {
    const sampleValue = normalizeNullableString(sample.source[field]);
    const activityValue = normalizeNullableString(activitySource[field]);
    if (!sampleValue || !activityValue) {
      continue;
    }

    comparedAnyField = true;
    if (sampleValue === activityValue) {
      return true;
    }
  }

  return !comparedAnyField;
}

function isWorkoutHeartRateSample(sample: AppleHealthCollectionSampleRecord) {
  return normalizeNullableString(sample.metadata?.HKMetadataKeyHeartRateMotionContext) === "2";
}

function buildLineMeasurementSeries(
  key: AppleHealthMeasurementSeries["key"],
  label: string,
  unit: string,
  workoutStartMs: number,
  samples: AppleHealthCollectionSampleRecord[],
): AppleHealthMeasurementSeries | null {
  const points: AppleHealthMeasurementPoint[] = [];

  for (const sample of samples) {
    if (typeof sample.numericValue !== "number" || !Number.isFinite(sample.numericValue)) {
      continue;
    }

    const sampleTimeMs = Date.parse(sample.startDate ?? "");
    if (!Number.isFinite(sampleTimeMs)) {
      continue;
    }

    points.push({
      offsetSeconds: Math.max(0, Math.round((sampleTimeMs - workoutStartMs) / 1000)),
      value: roundTo(sample.numericValue, 1),
    });
  }

  if (points.length === 0) {
    return null;
  }

  const normalizedPoints = downsampleMeasurementPoints(
    points.sort((left, right) => left.offsetSeconds - right.offsetSeconds),
    240,
    "line",
  );
  const values = normalizedPoints.map((point) => point.value);

  return {
    key,
    label,
    unit,
    kind: "line",
    section: "duringWorkout",
    sampleCount: points.length,
    averageValue: roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, 1),
    minValue: roundTo(Math.min(...values), 1),
    maxValue: roundTo(Math.max(...values), 1),
    totalValue: null,
    points: normalizedPoints,
  };
}

function buildDerivedCadenceMeasurementSeries(
  workoutStartMs: number,
  workoutEndMs: number,
  samples: AppleHealthCollectionSampleRecord[],
): AppleHealthMeasurementSeries | null {
  const bucketDurationMs = 5_000;
  const sortedSamples = [...samples].sort((left, right) => {
    const leftStart = Date.parse(left.startDate ?? "");
    const rightStart = Date.parse(right.startDate ?? "");
    return leftStart - rightStart;
  });

  const clippedSamples: Array<{ durationMs: number; endMs: number; startMs: number; value: number }> = [];
  let totalSteps = 0;
  for (const sample of sortedSamples) {
    const clippedSample = clipAppleHealthSampleToWorkout(sample, workoutStartMs, workoutEndMs);
    if (!clippedSample || clippedSample.durationMs <= 0) {
      continue;
    }

    totalSteps += clippedSample.value;
    clippedSamples.push(clippedSample);
  }

  if (clippedSamples.length === 0) {
    return null;
  }

  const points: AppleHealthMeasurementPoint[] = [];
  for (let bucketStartMs = workoutStartMs; bucketStartMs < workoutEndMs; bucketStartMs += bucketDurationMs) {
    const bucketEndMs = Math.min(workoutEndMs, bucketStartMs + bucketDurationMs);
    const bucketWindowMs = bucketEndMs - bucketStartMs;
    if (bucketWindowMs <= 0) {
      continue;
    }

    let bucketSteps = 0;
    for (const sample of clippedSamples) {
      if (sample.endMs <= bucketStartMs || sample.startMs >= bucketEndMs) {
        continue;
      }

      const overlapMs = Math.min(sample.endMs, bucketEndMs) - Math.max(sample.startMs, bucketStartMs);
      if (overlapMs <= 0) {
        continue;
      }

      bucketSteps += sample.value * (overlapMs / sample.durationMs);
    }

    const cadenceSpm = Math.min(bucketSteps / (bucketWindowMs / (1000 * 60)), 230);
    if (!Number.isFinite(cadenceSpm)) {
      continue;
    }

    const midpointMs = bucketStartMs + bucketWindowMs / 2;
    points.push({
      offsetSeconds: Math.max(0, Math.round((midpointMs - workoutStartMs) / 1000)),
      value: roundTo(cadenceSpm, 1),
    });
  }

  const normalizedPoints = downsampleMeasurementPoints(points, 240, "line");
  const values = normalizedPoints.map((point) => point.value);
  const workoutDurationMinutes = (workoutEndMs - workoutStartMs) / (1000 * 60);
  const averageCadence = workoutDurationMinutes > 0 ? totalSteps / workoutDurationMinutes : null;
  const displayValues = values.filter((value) => value >= 100);

  return {
    key: "cadence",
    label: "Cadence",
    unit: "spm",
    kind: "line",
    section: "duringWorkout",
    sampleCount: clippedSamples.length,
    averageValue: averageCadence === null ? null : roundTo(averageCadence, 1),
    minValue: roundTo(Math.min(...(displayValues.length > 0 ? displayValues : values)), 1),
    maxValue: roundTo(Math.max(...(displayValues.length > 0 ? displayValues : values)), 1),
    totalValue: roundTo(totalSteps, 0),
    points: normalizedPoints,
  };
}

function buildContextNumericMeasurementSeries(
  window: AppleHealthActivityWindow,
  samples: AppleHealthCollectionSampleRecord[],
  {
    key,
    label,
    unit,
    lookbackDays,
    lookaheadDays,
    transformValue,
  }: {
    key: AppleHealthMeasurementSeries["key"];
    label: string;
    unit: string;
    lookbackDays: number;
    lookaheadDays: number;
    transformValue?: (value: number) => number;
  },
): AppleHealthMeasurementSeries | null {
  const contextSamples = filterContextSamples(window, samples, lookbackDays, lookaheadDays);
  if (contextSamples.length === 0) {
    return null;
  }

  const groupedByDay = new Map<string, { sampleTimesMs: number[]; values: number[]; sampleCount: number }>();
  for (const sample of contextSamples) {
    if (typeof sample.numericValue !== "number" || !Number.isFinite(sample.numericValue)) {
      continue;
    }

    const sampleTimeMs = Date.parse(sample.startDate ?? sample.endDate ?? "");
    if (!Number.isFinite(sampleTimeMs)) {
      continue;
    }

    const value = transformValue ? transformValue(sample.numericValue) : sample.numericValue;
    const dayKey = toSydneyDayKey(sampleTimeMs);
    const existing = groupedByDay.get(dayKey);
    if (existing) {
      existing.sampleTimesMs.push(sampleTimeMs);
      existing.values.push(value);
      existing.sampleCount += 1;
      continue;
    }

    groupedByDay.set(dayKey, {
      sampleTimesMs: [sampleTimeMs],
      values: [value],
      sampleCount: 1,
    });
  }

  const points = [...groupedByDay.values()]
    .sort(
      (left, right) =>
        averageNumber(left.sampleTimesMs) - averageNumber(right.sampleTimesMs),
    )
    .map(({ sampleTimesMs, values }) => ({
      offsetSeconds: Math.round((averageNumber(sampleTimesMs) - window.startMs) / 1000),
      value: roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, unit === "%" ? 1 : 1),
    }));

  if (points.length === 0) {
    return null;
  }

  const values = points.map((point) => point.value);
  const sampleCount = [...groupedByDay.values()].reduce((sum, entry) => sum + entry.sampleCount, 0);
  return {
    key,
    label,
    unit,
    kind: "line",
    section: "recoveryContext",
    sampleCount,
    averageValue: roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, 1),
    minValue: roundTo(Math.min(...values), 1),
    maxValue: roundTo(Math.max(...values), 1),
    totalValue: null,
    points,
  };
}

function buildSleepDurationSeries(
  window: AppleHealthActivityWindow,
  samples: AppleHealthCollectionSampleRecord[],
): AppleHealthMeasurementSeries | null {
  const contextSamples = filterContextSamples(window, samples, 7, 0).filter((sample) =>
    isSleepAsleepCategory(sample.categoryValue),
  );
  if (contextSamples.length === 0) {
    return null;
  }

  const sleepByDay = new Map<string, { anchorTimesMs: number[]; durationHours: number; sampleCount: number }>();
  for (const sample of contextSamples) {
    const sampleStartMs = Date.parse(sample.startDate ?? "");
    const sampleEndMs = Date.parse(sample.endDate ?? sample.startDate ?? "");
    if (!Number.isFinite(sampleStartMs) || !Number.isFinite(sampleEndMs) || sampleEndMs < sampleStartMs) {
      continue;
    }

    const hours = (sampleEndMs - sampleStartMs) / (1000 * 60 * 60);
    const anchorMs = sampleEndMs;
    const dayKey = toSydneyDayKey(anchorMs);
    const existing = sleepByDay.get(dayKey);
    if (existing) {
      existing.anchorTimesMs.push(anchorMs);
      existing.durationHours += hours;
      existing.sampleCount += 1;
      continue;
    }

    sleepByDay.set(dayKey, {
      anchorTimesMs: [anchorMs],
      durationHours: hours,
      sampleCount: 1,
    });
  }

  const points = [...sleepByDay.values()]
    .sort((left, right) => averageNumber(left.anchorTimesMs) - averageNumber(right.anchorTimesMs))
    .map(({ anchorTimesMs, durationHours }) => ({
      offsetSeconds: Math.round((averageNumber(anchorTimesMs) - window.startMs) / 1000),
      value: roundTo(durationHours, 1),
    }));

  if (points.length === 0) {
    return null;
  }

  const values = points.map((point) => point.value);
  const sampleCount = [...sleepByDay.values()].reduce((sum, entry) => sum + entry.sampleCount, 0);
  return {
    key: "sleepDuration",
    label: "Sleep Duration",
    unit: "h",
    kind: "line",
    section: "recoveryContext",
    sampleCount,
    averageValue: roundTo(values.reduce((sum, value) => sum + value, 0) / values.length, 1),
    minValue: roundTo(Math.min(...values), 1),
    maxValue: roundTo(Math.max(...values), 1),
    totalValue: null,
    points,
  };
}

function filterContextSamples(
  window: AppleHealthActivityWindow,
  samples: AppleHealthCollectionSampleRecord[],
  lookbackDays: number,
  lookaheadDays: number,
) {
  const contextStartMs = window.startMs - lookbackDays * 24 * 60 * 60 * 1000;
  const contextEndMs = Math.min(window.startMs, window.endMs + lookaheadDays * 24 * 60 * 60 * 1000);

  return samples.filter((sample) => {
    const sampleStartMs = Date.parse(sample.startDate ?? sample.endDate ?? "");
    const sampleEndMs = Date.parse(sample.endDate ?? sample.startDate ?? "");
    if (!Number.isFinite(sampleStartMs) || !Number.isFinite(sampleEndMs)) {
      return false;
    }

    if (sampleEndMs < contextStartMs || sampleStartMs > contextEndMs) {
      return false;
    }

    if (sampleEndMs > window.startMs) {
      return false;
    }

    return appleHealthSampleMatchesSource(sample, window.source);
  });
}

function isSleepAsleepCategory(categoryValue: number | null | undefined) {
  return categoryValue === 1 || categoryValue === 3 || categoryValue === 4 || categoryValue === 5;
}

function toSydneyDayKey(timestampMs: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Sydney",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestampMs));
}

function averageNumber(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clipAppleHealthSampleToWorkout(
  sample: AppleHealthCollectionSampleRecord,
  workoutStartMs: number,
  workoutEndMs: number,
) {
  if (typeof sample.numericValue !== "number" || !Number.isFinite(sample.numericValue)) {
    return null;
  }

  const sampleStartMs = Date.parse(sample.startDate ?? "");
  const sampleEndMs = Date.parse(sample.endDate ?? sample.startDate ?? "");
  if (!Number.isFinite(sampleStartMs) || !Number.isFinite(sampleEndMs)) {
    return null;
  }

  const clippedStartMs = Math.max(sampleStartMs, workoutStartMs);
  const clippedEndMs = Math.min(sampleEndMs, workoutEndMs);
  if (clippedEndMs < clippedStartMs) {
    return null;
  }

  const sampleDurationMs = Math.max(0, sampleEndMs - sampleStartMs);
  const clippedDurationMs = Math.max(0, clippedEndMs - clippedStartMs);
  if (sampleDurationMs === 0) {
    return {
      durationMs: 0,
      endMs: clippedEndMs,
      startMs: clippedStartMs,
      value: sample.numericValue,
    };
  }

  const fraction = clippedDurationMs / sampleDurationMs;
  return {
    durationMs: clippedDurationMs,
    endMs: clippedEndMs,
    startMs: clippedStartMs,
    value: sample.numericValue * fraction,
  };
}

function downsampleMeasurementPoints(
  points: AppleHealthMeasurementPoint[],
  maxPoints: number,
  strategy: "line" | "cumulative",
) {
  if (points.length <= maxPoints) {
    return points;
  }

  const downsampled: AppleHealthMeasurementPoint[] = [];
  const bucketSize = points.length / maxPoints;

  for (let bucketIndex = 0; bucketIndex < maxPoints; bucketIndex += 1) {
    const startIndex = Math.floor(bucketIndex * bucketSize);
    const endIndex = Math.max(startIndex + 1, Math.floor((bucketIndex + 1) * bucketSize));
    const bucket = points.slice(startIndex, endIndex);
    if (bucket.length === 0) {
      continue;
    }

    if (strategy === "cumulative") {
      downsampled.push(bucket[bucket.length - 1]);
      continue;
    }

    downsampled.push({
      offsetSeconds: bucket[Math.floor(bucket.length / 2)].offsetSeconds,
      value: roundTo(bucket.reduce((sum, point) => sum + point.value, 0) / bucket.length, 1),
    });
  }

  if (downsampled[0]?.offsetSeconds !== points[0]?.offsetSeconds) {
    downsampled.unshift(points[0]);
  }

  const lastPoint = points[points.length - 1];
  if (downsampled[downsampled.length - 1]?.offsetSeconds !== lastPoint?.offsetSeconds) {
    downsampled.push(lastPoint);
  }

  return downsampled;
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function writeWorkoutImageFiles(workouts: WorkoutNote[], cacheAvailable: boolean) {
  await fs.rm(generatedWorkoutImagesDir, { force: true, recursive: true });

  if (!cacheAvailable) {
    return;
  }

  const imageCopies = workouts.flatMap((workout) => {
    if (!workout.primaryImageUrl || !workout.sources || !workout.activityRefs) {
      return [];
    }

    const displaySource = selectDisplaySourceSummary(workout.sources, workout.activityRefs);
    const sourceFileName = extractGeneratedFileName(displaySource?.primaryImageUrl ?? null);
    const outputFileName = extractGeneratedFileName(workout.primaryImageUrl);
    if (!sourceFileName || !outputFileName) {
      return [];
    }

    return [{ outputFileName, sourceFileName }];
  });

  if (imageCopies.length === 0) {
    return;
  }

  await fs.mkdir(generatedWorkoutImagesDir, { recursive: true });
  await Promise.all(
    imageCopies.map(async ({ outputFileName, sourceFileName }) => {
      const sourcePath = path.join(defaultStravaCacheImagesDir, sourceFileName);
      const outputPath = path.join(generatedWorkoutImagesDir, outputFileName);

      try {
        await fs.copyFile(sourcePath, outputPath);
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError?.code === "ENOENT") {
          throw new Error(
            `Expected cached workout image at ${sourcePath} because cache-export.json references ${sourceFileName}`,
          );
        }

        throw error;
      }
    }),
  );
}

function buildRoutePath(provider: WorkoutProvider, activityId: string) {
  return `/generated/workout-routes/${provider}/${activityId}.json`;
}

function buildPublicWorkoutRoutePath(slug: string) {
  return `/generated/workout-routes/${slug}.json`;
}

function buildPublicWorkoutMeasurementsPath(slug: string) {
  return `/generated/workout-measurements/${slug}.json`;
}

function buildPublicWorkoutImagePath(slug: string, sourceImageUrl: string) {
  const sourceFileName = extractGeneratedFileName(sourceImageUrl);
  const extension = sourceFileName ? path.extname(sourceFileName) : "";
  return `/generated/workout-images/${slug}${extension || ".jpg"}`;
}

function extractGeneratedFileName(value: string | null) {
  const normalizedValue = normalizeNullableString(value);
  if (!normalizedValue) {
    return null;
  }

  const fileName = normalizedValue.split("/").pop();
  return fileName ? decodeURIComponent(fileName) : null;
}

function toPublicActivityId(provider: WorkoutProvider, activityId: string) {
  if (provider !== "appleHealth") {
    return activityId;
  }

  if (activityId.startsWith("ah_")) {
    return activityId;
  }

  const digest = createHash("sha256")
    .update("measured.apple-health.public-id", "utf8")
    .update("\0", "utf8")
    .update(appleHealthPublicIdSalt ?? "", "utf8")
    .update("\0", "utf8")
    .update(activityId, "utf8")
    .digest("hex");

  return `ah_${digest.slice(0, 24)}`;
}

function sanitizePublicText(value: string) {
  return value
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
      "[activity id removed]",
    )
    .replace(/\bah_[0-9a-f]{24}\b/giu, "[activity id removed]")
    .replace(/\b\d{10,12}\b/gu, "[activity id removed]");
}

function sanitizePublicWorkoutSections(sections: WorkoutNoteSourceSection[]): WorkoutNoteSourceSection[] {
  return sections.map((section) => {
    if (section.kind === "analysis") {
      return {
        ...section,
        summaryMarkdown: section.summaryMarkdown ? sanitizePublicText(section.summaryMarkdown) : section.summaryMarkdown,
        sections: section.sections.map((analysisSection) => sanitizePublicWorkoutAnalysisSection(analysisSection)),
      };
    }

    return {
      ...section,
      markdown: sanitizePublicText(section.markdown),
    };
  });
}

function sanitizePublicWorkoutAnalysisSection(section: WorkoutNoteAnalysisSection): WorkoutNoteAnalysisSection {
  return {
    ...section,
    markdown: sanitizePublicText(section.markdown),
  };
}

function normalizeCoordinateSeries(value: unknown): Array<[number, number]> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const coordinates = value
    .map((item) => {
      if (!Array.isArray(item) || item.length !== 2) {
        return null;
      }

      const latitude = normalizeCachedNumber(item[0]);
      const longitude = normalizeCachedNumber(item[1]);
      if (latitude === null || longitude === null) {
        return null;
      }

      return [latitude, longitude] as [number, number];
    })
    .filter((item): item is [number, number] => item !== null);

  return coordinates.length > 1 ? coordinates : null;
}

function normalizeNumberSeries(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const items = value
    .map((item) => normalizeCachedNumber(item))
    .filter((item): item is number => item !== null);

  return items.length > 1 ? items : null;
}

function normalizeBooleanSeries(value: unknown): boolean[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const items = value.filter((item): item is boolean => typeof item === "boolean");
  return items.length > 1 ? items : null;
}

function normalizeOptionalInteger(value: unknown, fileName: string, field: string) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && /^\d+$/u.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }

  throw new Error(`${fileName}: ${field} must be a positive integer`);
}

function normalizeEventType(value: unknown, fileName: string): WorkoutEventType {
  const normalized = expectString(value, fileName, "eventType").toLowerCase() as WorkoutEventType;
  if (!WORKOUT_EVENT_TYPES.includes(normalized)) {
    throw new Error(
      `${fileName}: eventType must be one of ${WORKOUT_EVENT_TYPES.join(", ")}`,
    );
  }

  return normalized;
}

function normalizeCompleted(value: unknown, fileName: string) {
  if (value === null || value === undefined || value === false) {
    return null;
  }

  if (value === true) {
    throw new Error(`${fileName}: completed must be false or an ISO timestamp`);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length === 0 || normalized === "false") {
      return null;
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`${fileName}: completed must be a valid ISO timestamp`);
    }

    return parsed.toISOString();
  }

  throw new Error(`${fileName}: completed must be false or an ISO timestamp`);
}

function normalizeDate(value: unknown, fileName: string, field: string) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "string") {
    const normalized = value.trim().replace(/^['"]|['"]$/gu, "");
    if (/^\d{4}-\d{2}-\d{2}$/u.test(normalized)) {
      return normalized;
    }

    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  throw new Error(`${fileName}: ${field} must be a valid date`);
}

function trimTrailingZero(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

await main();
