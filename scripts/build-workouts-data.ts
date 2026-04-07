import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import type {
  ChangelogEntry,
  GoalNote,
  PlanDocument,
  WorkoutDataSource,
  WorkoutNote,
  WorkoutRouteStreams,
  WorkoutEventType,
  WorkoutsData,
} from "../src/lib/workouts/schema";
import { WORKOUT_DATA_SOURCES, WORKOUT_EVENT_TYPES } from "../src/lib/workouts/schema";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const generatedPath = path.resolve(rootDir, "src/generated/workouts.json");
const generatedRouteStreamsDir = path.resolve(rootDir, "public/generated/workout-routes");
const generatedWorkoutImagesDir = path.resolve(rootDir, "public/generated/workout-images");
const legacyGeneratedRouteStreamsPath = path.resolve(rootDir, "public/generated/workout-route-streams.json");
const defaultWorkoutsDir = path.resolve(rootDir, "data/training");
const defaultStravaCacheExportPath = path.resolve(rootDir, "vault/strava/cache-export.json");
const defaultStravaCacheImagesDir = path.resolve(rootDir, "vault/strava/cache-images");
const changelogDirName = "changelog";
const goalsDirName = "goals";
const notesDirName = "notes";

interface StravaCacheSnapshot {
  generatedAt: string;
  activities: Record<string, StravaCachedActivity>;
}

interface GeneratedWorkoutFallback {
  actualDistance: string | null;
  actualDistanceKm: number | null;
  actualMovingTimeSeconds: number | null;
  actualElapsedTimeSeconds: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  summaryPolyline: string | null;
  primaryImageUrl: string | null;
  hasStravaStreams: boolean;
  stravaId: number | null;
}

interface StravaCachedActivity {
  activityId: number;
  name: string | null;
  sportType: string | null;
  startDate: string | null;
  distanceMeters: number | null;
  distanceKm: number | null;
  movingTimeSeconds: number | null;
  elapsedTimeSeconds: number | null;
  totalElevationGainMeters: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  summaryPolyline: string | null;
  primaryImageFileName: string | null;
  detailFetchedAt: string | null;
  hasStreams: boolean;
  routeStreams: StravaCachedRouteStreams | null;
}

interface StravaCachedRouteStreams {
  latlng: Array<[number, number]> | null;
  altitude: number[] | null;
  distance: number[] | null;
  heartrate: number[] | null;
  velocitySmooth: number[] | null;
  moving: boolean[] | null;
}

async function main() {
  const dataDir = await resolveWorkoutsDir();
  const notesDir = path.join(dataDir, notesDirName);
  const goalsDir = path.join(dataDir, goalsDirName);
  const changelogDir = path.join(dataDir, changelogDirName);
  await assertNotesDirectory(notesDir);
  await assertGoalNotesDirectory(goalsDir);
  const stravaCache = await readStravaCacheSnapshot();
  const existingGeneratedData = await readExistingGeneratedData();
  const fileNames = (await fs.readdir(notesDir))
    .filter((fileName) => fileName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));
  const goalFileNames = (await fs.readdir(goalsDir))
    .filter((fileName) => fileName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));
  const changelogEntries = await readChangelogEntries(changelogDir, dataDir);
  const existingWorkoutFallbacks = new Map(
    (existingGeneratedData?.workouts ?? []).map((workout) => [
      workout.sourcePath,
      {
        actualDistance: workout.actualDistance,
        actualDistanceKm: workout.actualDistanceKm,
        actualMovingTimeSeconds: workout.actualMovingTimeSeconds,
        actualElapsedTimeSeconds: workout.actualElapsedTimeSeconds,
        averageHeartrate: workout.averageHeartrate,
        maxHeartrate: workout.maxHeartrate,
        summaryPolyline: workout.summaryPolyline,
        primaryImageUrl: workout.primaryImageUrl,
        hasStravaStreams: workout.hasStravaStreams,
        stravaId: workout.stravaId,
      } satisfies GeneratedWorkoutFallback,
    ]),
  );

  const workouts: WorkoutNote[] = [];
  const goalNotes: GoalNote[] = [];
  let welcome: PlanDocument | null = null;
  let goals: PlanDocument | null = null;
  let plan: PlanDocument | null = null;

  welcome = await readDocument(path.join(dataDir, "WELCOME.md"), dataDir);
  goals = await readDocument(path.join(dataDir, "GOALS.md"), dataDir);
  plan = await readDocument(path.join(dataDir, "PLAN.md"), dataDir);

  for (const fileName of fileNames) {
    const filePath = path.join(notesDir, fileName);
    const sourcePath = path.relative(dataDir, filePath).replaceAll("\\", "/");
    const fileContent = await fs.readFile(filePath, "utf8");

    workouts.push(
      buildWorkoutNote(
        fileName,
        fileContent,
        sourcePath,
        stravaCache.activities,
        existingWorkoutFallbacks.get(sourcePath) ?? null,
      ),
    );
  }

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

  workouts.sort((left, right) =>
    left.date === right.date ? left.slug.localeCompare(right.slug) : left.date.localeCompare(right.date),
  );

  const payload: WorkoutsData = {
    generatedAt: new Date().toISOString(),
    welcome,
    goals,
    goalNotes,
    plan,
    changelog: changelogEntries,
    workouts,
  };
  const routeStreamsPayload = buildRouteStreamsPayload(stravaCache.activities);

  await fs.mkdir(path.dirname(generatedPath), { recursive: true });
  await fs.writeFile(generatedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await writeRouteStreamFiles(routeStreamsPayload);
  await writeWorkoutImageFiles(stravaCache.activities);
  console.log(`Generated ${workouts.length} workout notes at ${generatedPath}`);
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

async function readStravaCacheSnapshot(): Promise<StravaCacheSnapshot> {
  try {
    const fileContent = await fs.readFile(defaultStravaCacheExportPath, "utf8");
    const parsed = JSON.parse(fileContent) as Partial<StravaCacheSnapshot>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.activities !== "object") {
      throw new Error("expected activities object");
    }

    return {
      generatedAt:
        typeof parsed.generatedAt === "string" && parsed.generatedAt.length > 0
          ? parsed.generatedAt
          : new Date(0).toISOString(),
      activities: parsed.activities as Record<string, StravaCachedActivity>,
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return {
        generatedAt: new Date(0).toISOString(),
        activities: {},
      };
    }

    throw new Error(
      `Unable to read Strava cache export at ${defaultStravaCacheExportPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
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
        `Expected structure: <data-root>/${notesDirName}/*.md with PLAN.md, WELCOME.md, GOALS.md, AGENTS.md, and goals/*.md in <data-root>`,
        `Details: ${detail}`,
      ].join("\n"),
    );
  }
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
    body: fileContent.trim(),
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
    body: parsed.content.trim(),
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
    body: parsed.content.trim(),
    sourcePath,
  };
}

function buildWorkoutNote(
  fileName: string,
  fileContent: string,
  sourcePath: string,
  stravaActivities: Record<string, StravaCachedActivity>,
  existingFallback: GeneratedWorkoutFallback | null,
): WorkoutNote {
  const parsed = matter(fileContent);
  const data = parsed.data;
  const stravaId = normalizeOptionalInteger(data.stravaId, fileName, "stravaId");
  const notedDataSource = normalizeWorkoutDataSource(data.dataSource, fileName);
  const validFallback =
    existingFallback && existingFallback.stravaId === stravaId ? existingFallback : null;
  const importedFromStrava =
    stravaId !== null && /(^|\n)##\s+Imported from Strava\b/u.test(parsed.content);
  if (stravaId !== null && notedDataSource !== null && notedDataSource !== "strava") {
    throw new Error(`${fileName}: dataSource must be "strava" when stravaId is present`);
  }
  const notedExpectedDistance = normalizeNullableString(data.expectedDistance);
  const notedActualDistance = normalizeNullableString(data.actualDistance);
  const cachedActivity = stravaId !== null ? stravaActivities[String(stravaId)] ?? null : null;
  const dataSource = stravaId !== null ? "strava" : notedDataSource;
  const expectedDistance =
    importedFromStrava && notedActualDistance === null ? null : notedExpectedDistance;
  const expectedDistanceKm = normalizeDistanceKm(expectedDistance);
  const actualDistance =
    normalizeCachedDistanceLabel(cachedActivity) ??
    validFallback?.actualDistance ??
    notedActualDistance ??
    (importedFromStrava ? notedExpectedDistance : null);
  const actualDistanceKm =
    normalizeCachedDistanceKm(cachedActivity) ??
    validFallback?.actualDistanceKm ??
    normalizeDistanceKm(notedActualDistance) ??
    (importedFromStrava ? normalizeDistanceKm(notedExpectedDistance) : null);

  return {
    slug: slugify(fileName.replace(/\.md$/u, "")),
    title: expectString(data.title, fileName, "title"),
    date: normalizeDate(data.date, fileName, "date"),
    eventType: normalizeEventType(data.eventType, fileName),
    expectedDistance,
    expectedDistanceKm,
    actualDistance,
    actualDistanceKm,
    completed: normalizeCompleted(data.completed, fileName),
    stravaId,
    dataSource,
    actualMovingTimeSeconds: normalizeCachedInteger(cachedActivity?.movingTimeSeconds) ?? validFallback?.actualMovingTimeSeconds ?? null,
    actualElapsedTimeSeconds:
      normalizeCachedInteger(cachedActivity?.elapsedTimeSeconds) ?? validFallback?.actualElapsedTimeSeconds ?? null,
    averageHeartrate: normalizeCachedNumber(cachedActivity?.averageHeartrate) ?? validFallback?.averageHeartrate ?? null,
    maxHeartrate: normalizeCachedNumber(cachedActivity?.maxHeartrate) ?? validFallback?.maxHeartrate ?? null,
    summaryPolyline: normalizeNullableString(cachedActivity?.summaryPolyline) ?? validFallback?.summaryPolyline ?? null,
    primaryImageUrl: normalizeCachedImageUrl(cachedActivity) ?? validFallback?.primaryImageUrl ?? null,
    hasStravaStreams: cachedActivity?.hasStreams === true || validFallback?.hasStravaStreams === true,
    allDay: expectBoolean(data.allDay, fileName, "allDay"),
    type: expectString(data.type, fileName, "type"),
    body: parsed.content.trim(),
    sourcePath,
  };
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

function normalizeWorkoutDataSource(value: unknown, fileName: string): WorkoutDataSource | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error(`${fileName}: dataSource must be one of ${WORKOUT_DATA_SOURCES.join(", ")}`);
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  if (WORKOUT_DATA_SOURCES.includes(normalized as WorkoutDataSource)) {
    return normalized as WorkoutDataSource;
  }

  throw new Error(`${fileName}: dataSource must be one of ${WORKOUT_DATA_SOURCES.join(", ")}`);
}

function normalizeCachedDistanceKm(activity: StravaCachedActivity | null) {
  if (!activity) {
    return null;
  }

  return normalizeCachedNumber(activity.distanceKm);
}

function normalizeCachedDistanceLabel(activity: StravaCachedActivity | null) {
  const distanceKm = normalizeCachedDistanceKm(activity);
  if (distanceKm === null) {
    return null;
  }

  return `${trimTrailingZero(distanceKm)} km`;
}

function normalizeCachedImageUrl(activity: StravaCachedActivity | null) {
  const fileName = normalizeNullableString(activity?.primaryImageFileName);
  if (!fileName) {
    return null;
  }

  return `/generated/workout-images/${encodeURIComponent(fileName)}`;
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

function normalizeRouteStreams(value: unknown): StravaCachedRouteStreams | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<StravaCachedRouteStreams>;
  return {
    latlng: normalizeCoordinateSeries(candidate.latlng),
    altitude: normalizeNumberSeries(candidate.altitude),
    distance: normalizeNumberSeries(candidate.distance),
    heartrate: normalizeNumberSeries(candidate.heartrate),
    velocitySmooth: normalizeNumberSeries(candidate.velocitySmooth),
    moving: normalizeBooleanSeries(candidate.moving),
  };
}

function buildRouteStreamsPayload(activities: Record<string, StravaCachedActivity>) {
  return Object.fromEntries(
    Object.entries(activities)
      .map(([activityId, activity]) => [activityId, normalizeRouteStreams(activity.routeStreams)] as const)
      .filter((entry): entry is [string, WorkoutRouteStreams] => entry[1] !== null),
  );
}

async function writeRouteStreamFiles(routeStreamsByActivity: Record<string, WorkoutRouteStreams>) {
  if (Object.keys(routeStreamsByActivity).length === 0) {
    try {
      const stats = await fs.stat(generatedRouteStreamsDir);
      if (stats.isDirectory()) {
        return;
      }
    } catch {
      // Fall through and recreate the directory if there is no existing payload to preserve.
    }
  }

  await fs.rm(legacyGeneratedRouteStreamsPath, { force: true });
  await fs.rm(generatedRouteStreamsDir, { force: true, recursive: true });
  await fs.mkdir(generatedRouteStreamsDir, { recursive: true });

  await Promise.all(
    Object.entries(routeStreamsByActivity).map(async ([activityId, routeStreams]) => {
      const outputPath = path.join(generatedRouteStreamsDir, `${activityId}.json`);
      await fs.writeFile(outputPath, `${JSON.stringify(routeStreams, null, 2)}\n`, "utf8");
    }),
  );
}

async function writeWorkoutImageFiles(activities: Record<string, StravaCachedActivity>) {
  const imageFileNames = Array.from(
    new Set(
      Object.values(activities)
        .map((activity) => normalizeNullableString(activity.primaryImageFileName))
        .filter((fileName): fileName is string => fileName !== null),
    ),
  );

  await fs.rm(generatedWorkoutImagesDir, { force: true, recursive: true });
  if (imageFileNames.length === 0) {
    return;
  }

  await fs.mkdir(generatedWorkoutImagesDir, { recursive: true });
  await Promise.all(
    imageFileNames.map(async (fileName) => {
      const sourcePath = path.join(defaultStravaCacheImagesDir, fileName);
      const outputPath = path.join(generatedWorkoutImagesDir, fileName);

      try {
        await fs.copyFile(sourcePath, outputPath);
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError?.code === "ENOENT") {
          throw new Error(
            `Expected cached Strava image at ${sourcePath} because cache-export.json references ${fileName}`,
          );
        }

        throw error;
      }
    }),
  );
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
