import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getWorkoutNoteBaseName,
  parseWorkoutNoteSourceDocument,
  serializeWorkoutNoteSourceDocument,
} from "../src/lib/workouts/source-note";
import {
  WORKOUT_PROVIDERS,
  type WorkoutActivityRefMap,
  type WorkoutNoteSourceDocument,
  type WorkoutProvider,
} from "../src/lib/workouts/schema";

export const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
export const defaultWorkoutsDir = path.resolve(rootDir, "data/training");
export const defaultNotesDir = path.resolve(defaultWorkoutsDir, "notes");
export const defaultProviderCacheExportPaths: Record<WorkoutProvider, string> = {
  strava: path.resolve(rootDir, "vault/strava/cache-export.json"),
  appleHealth: path.resolve(rootDir, "vault/apple-health/cache-export.json"),
};

export interface ProviderCachedActivity {
  activityId: string | number;
  sportType?: string | null;
  startDate?: string | null;
  distanceMeters?: number | null;
  distanceKm?: number | null;
  movingTimeSeconds?: number | null;
  elapsedTimeSeconds?: number | null;
  averageHeartrate?: number | null;
  maxHeartrate?: number | null;
  summaryPolyline?: string | null;
  detailFetchedAt?: string | null;
  hasStreams?: boolean;
  routeStreams?: unknown;
  source?: Record<string, unknown> | null;
}

export interface ProviderCacheSnapshot {
  generatedAt: string;
  provider: WorkoutProvider;
  activities: Record<string, ProviderCachedActivity>;
  deletedActivityIds: string[];
}

export interface WorkoutNoteFile {
  activityRefs: WorkoutActivityRefMap;
  document: WorkoutNoteSourceDocument;
  fileName: string;
  filePath: string;
  slug: string;
  sourcePath: string;
}

export function getCliFlagValue(flag: string) {
  const flagIndex = process.argv.findIndex((argument) => argument === flag);
  if (flagIndex === -1) {
    return null;
  }

  const nextValue = process.argv[flagIndex + 1];
  if (!nextValue || nextValue.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return nextValue;
}

export function hasCliFlag(flag: string) {
  return process.argv.includes(flag);
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export async function resolveNotesDir() {
  const configuredPath = getCliFlagValue("--notes-dir") ?? defaultNotesDir;
  const resolvedPath = path.resolve(rootDir, configuredPath);
  const stats = await fs.stat(resolvedPath);
  if (!stats.isDirectory()) {
    throw new Error(`Workout notes path is not a directory: ${resolvedPath}`);
  }

  return resolvedPath;
}

export async function readProviderCacheSnapshot(
  provider: WorkoutProvider,
  explicitPath?: string,
): Promise<ProviderCacheSnapshot> {
  const cachePath = path.resolve(rootDir, explicitPath ?? defaultProviderCacheExportPaths[provider]);

  try {
    if (provider === "appleHealth") {
      return readAppleHealthProviderCacheSnapshot(cachePath);
    }

    const fileContent = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(fileContent) as Partial<ProviderCacheSnapshot>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.activities !== "object") {
      throw new Error("expected activities object");
    }

    return {
      generatedAt:
        typeof parsed.generatedAt === "string" && parsed.generatedAt.length > 0
          ? parsed.generatedAt
          : new Date(0).toISOString(),
      provider,
      activities: parsed.activities as Record<string, ProviderCachedActivity>,
      deletedActivityIds: Array.isArray(parsed.deletedActivityIds)
        ? parsed.deletedActivityIds
            .map((item) => normalizeNullableString(item))
            .filter((item): item is string => item !== null)
        : [],
    };
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError?.code === "ENOENT") {
      return {
        generatedAt: new Date(0).toISOString(),
        provider,
        activities: {},
        deletedActivityIds: [],
      };
    }

    throw new Error(
      `Unable to read ${provider} cache export at ${cachePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function readAppleHealthProviderCacheSnapshot(cachePath: string): Promise<ProviderCacheSnapshot> {
  const fileHandle = await fs.open(cachePath, "r");

  try {
    const [generatedAtJson, activitiesJson, deletedActivityIdsJson] = await Promise.all([
      extractPropertyJson(fileHandle, "generatedAt", 0x22),
      extractPropertyJson(fileHandle, "activities", 0x7b),
      extractPropertyJson(fileHandle, "deletedActivityIds", 0x5b),
    ]);

    const parsedActivities = activitiesJson ? (JSON.parse(activitiesJson) as Record<string, ProviderCachedActivity>) : {};
    const parsedDeletedActivityIds = deletedActivityIdsJson ? (JSON.parse(deletedActivityIdsJson) as unknown) : [];

    return {
      generatedAt:
        generatedAtJson && typeof JSON.parse(generatedAtJson) === "string"
          ? (JSON.parse(generatedAtJson) as string)
          : new Date(0).toISOString(),
      provider: "appleHealth",
      activities: parsedActivities,
      deletedActivityIds: Array.isArray(parsedDeletedActivityIds)
        ? parsedDeletedActivityIds
            .map((item) => normalizeNullableString(item))
            .filter((item): item is string => item !== null)
        : [],
    };
  } finally {
    await fileHandle.close();
  }
}

async function extractPropertyJson(
  fileHandle: fs.FileHandle,
  propertyKey: string,
  openingByte: number,
) {
  const keyPattern = Buffer.from(`${JSON.stringify(propertyKey)}:`, "utf8");
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
      const valueStart = absoluteMatchIndex + keyPattern.length;
      return readJsonValueAt(fileHandle, valueStart, openingByte);
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

export async function readProviderCaches() {
  const caches = await Promise.all(
    WORKOUT_PROVIDERS.map(async (provider) => [provider, await readProviderCacheSnapshot(provider)] as const),
  );

  return Object.fromEntries(caches) as Record<WorkoutProvider, ProviderCacheSnapshot>;
}

export async function readWorkoutNotes(notesDir?: string): Promise<WorkoutNoteFile[]> {
  const resolvedNotesDir = notesDir ?? (await resolveNotesDir());
  const fileNames = listWorkoutNoteFileNames(await fs.readdir(resolvedNotesDir));

  return Promise.all(
    fileNames.map(async (fileName) => {
      const filePath = path.join(resolvedNotesDir, fileName);
      return readWorkoutNoteFile(filePath, resolvedNotesDir);
    }),
  );
}

export async function readWorkoutNoteFile(filePath: string, notesDir = path.dirname(filePath)): Promise<WorkoutNoteFile> {
  const fileContent = await fs.readFile(filePath, "utf8");
  const fileName = path.basename(filePath);
  const document = parseWorkoutNoteSourceDocument(fileName, fileContent);

  return {
    activityRefs: normalizeActivityRefs(document, fileName),
    document,
    fileName,
    filePath,
    slug: slugify(getWorkoutNoteBaseName(fileName)),
    sourcePath: path.relative(path.dirname(notesDir), filePath).replaceAll("\\", "/"),
  };
}

export async function findWorkoutNote(target: string, notesDir?: string) {
  const resolvedNotesDir = notesDir ?? (await resolveNotesDir());
  const resolvedTarget = path.resolve(rootDir, target);
  try {
    const stats = await fs.stat(resolvedTarget);
    if (stats.isFile()) {
      return readWorkoutNoteFile(resolvedTarget, resolvedNotesDir);
    }
  } catch {
    // Ignore missing explicit path and fall back to slug lookup.
  }

  const notes = await readWorkoutNotes(resolvedNotesDir);
  return notes.find((note) => note.slug === target || note.fileName === target) ?? null;
}

export async function writeWorkoutNote(note: WorkoutNoteFile, nextData: Record<string, unknown>) {
  const nextDocument: WorkoutNoteSourceDocument = {
    ...note.document,
    ...nextData,
  } as WorkoutNoteSourceDocument;
  await fs.writeFile(note.filePath, serializeWorkoutNoteSourceDocument(nextDocument), "utf8");
}

export function buildOrderedActivityRefs(activityRefs: WorkoutActivityRefMap) {
  const ordered: WorkoutActivityRefMap = {};
  for (const provider of WORKOUT_PROVIDERS) {
    if (activityRefs[provider]) {
      ordered[provider] = activityRefs[provider];
    }
  }
  return ordered;
}

function normalizeActivityRefs(data: { activityRefs?: unknown; stravaId?: unknown }, fileName: string): WorkoutActivityRefMap {
  const refs: WorkoutActivityRefMap = {};
  const rawActivityRefs = data.activityRefs;

  if (rawActivityRefs !== null && rawActivityRefs !== undefined) {
    if (typeof rawActivityRefs !== "object" || Array.isArray(rawActivityRefs)) {
      throw new Error(`${fileName}: activityRefs must be an object map of provider ids`);
    }

    const candidate = rawActivityRefs as Record<string, unknown>;
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
  }

  const stravaId = normalizeOptionalInteger(data.stravaId, fileName, "stravaId");
  if (stravaId !== null) {
    const normalizedValue = String(stravaId);
    if (refs.strava !== undefined && refs.strava !== normalizedValue) {
      throw new Error(`${fileName}: stravaId and activityRefs.strava must match when both are set`);
    }
    refs.strava ??= normalizedValue;
  }

  return refs;
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

function normalizeOptionalActivityId(value: unknown, fileName: string, field: string) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  throw new Error(`${fileName}: ${field} must be a string or number`);
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
