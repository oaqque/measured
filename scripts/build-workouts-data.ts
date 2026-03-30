import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import type { PlanDocument, WorkoutNote, WorkoutsData } from "../src/lib/workouts/schema";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const generatedPath = path.resolve(rootDir, "src/generated/workouts.json");
const defaultWorkoutsDir = path.resolve(rootDir, "data/training");
const notesDirName = "notes";

async function main() {
  const dataDir = await resolveWorkoutsDir();
  const notesDir = path.join(dataDir, notesDirName);
  await assertNotesDirectory(notesDir);
  const fileNames = (await fs.readdir(notesDir))
    .filter((fileName) => fileName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));

  const workouts: WorkoutNote[] = [];
  let welcome: PlanDocument | null = null;
  let plan: PlanDocument | null = null;

  welcome = await readDocument(path.join(dataDir, "WELCOME.md"), dataDir);
  plan = await readDocument(path.join(dataDir, "README.md"), dataDir);

  for (const fileName of fileNames) {
    const filePath = path.join(notesDir, fileName);
    const sourcePath = path.relative(dataDir, filePath).replaceAll("\\", "/");
    const fileContent = await fs.readFile(filePath, "utf8");

    workouts.push(buildWorkoutNote(fileName, fileContent, sourcePath));
  }

  if (!welcome) {
    throw new Error(`Missing WELCOME.md in workouts source directory: ${dataDir}`);
  }

  if (!plan) {
    throw new Error(`Missing README.md in workouts source directory: ${dataDir}`);
  }

  workouts.sort((left, right) =>
    left.date === right.date ? left.slug.localeCompare(right.slug) : left.date.localeCompare(right.date),
  );

  const payload: WorkoutsData = {
    generatedAt: new Date().toISOString(),
    welcome,
    plan,
    workouts,
  };

  await fs.mkdir(path.dirname(generatedPath), { recursive: true });
  await fs.writeFile(generatedPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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
        `Expected structure: <data-root>/${notesDirName}/*.md with README.md and WELCOME.md in <data-root>`,
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

function buildWorkoutNote(fileName: string, fileContent: string, sourcePath: string): WorkoutNote {
  const parsed = matter(fileContent);
  const data = parsed.data;

  return {
    slug: slugify(fileName.replace(/\.md$/u, "")),
    title: expectString(data.title, fileName, "title"),
    date: normalizeDate(data.date, fileName, "date"),
    eventType: expectString(data.eventType, fileName, "eventType"),
    expectedDistance: normalizeNullableString(data.expectedDistance),
    expectedDistanceKm: normalizeExpectedDistanceKm(data.expectedDistance),
    completed: normalizeCompleted(data.completed, fileName),
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

function normalizeExpectedDistanceKm(value: unknown) {
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

await main();
