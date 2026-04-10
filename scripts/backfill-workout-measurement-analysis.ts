import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildAppleHealthMeasurementAnalysisSections, buildStravaMeasurementAnalysisSections } from "../src/lib/workouts/measurement-analysis";
import {
  getWorkoutNoteBaseName,
  parseWorkoutNoteSourceDocument,
  serializeWorkoutNoteSourceDocument,
} from "../src/lib/workouts/source-note";
import type {
  AppleHealthWorkoutMeasurements,
  WorkoutNoteAnalysisSection,
  WorkoutNoteSourceDocument,
  WorkoutRouteStreams,
  WorkoutSourceDetailsPayload,
  WorkoutSourceSummary,
} from "../src/lib/workouts/schema";
import { slugify } from "./workout-source-utils";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const notesDir = path.resolve(rootDir, "data/training/notes");
const workoutSourceDetailsPath = path.resolve(rootDir, "public/generated/workout-source-details.json");
const appleHealthMeasurementsDir = path.resolve(rootDir, "public/generated/workout-measurements/appleHealth");
const publicDir = path.resolve(rootDir, "public");

async function main() {
  const [fileNames, sourceDetails] = await Promise.all([
    fs.readdir(notesDir),
    readJsonFile<WorkoutSourceDetailsPayload>(workoutSourceDetailsPath),
  ]);

  let updatedNotes = 0;
  let createdAnalysisSections = 0;
  let measurementSectionsWritten = 0;
  let skippedNotes = 0;

  for (const fileName of fileNames.filter((candidate) => candidate.endsWith(".json")).sort()) {
    const filePath = path.join(notesDir, fileName);
    const fileContent = await fs.readFile(filePath, "utf8");
    const document = parseWorkoutNoteSourceDocument(fileName, fileContent);
    if (document.eventType !== "run" || document.completed === false) {
      skippedNotes += 1;
      continue;
    }

    const slug = slugify(getWorkoutNoteBaseName(fileName));
    const detailSources = sourceDetails.workouts[slug]?.sources;
    if (!detailSources) {
      skippedNotes += 1;
      continue;
    }

    const generatedSections = await buildMeasurementSections(detailSources);
    if (generatedSections.length === 0) {
      skippedNotes += 1;
      continue;
    }

    const beforeHadAnalysis = document.sections.some((section) => section.kind === "analysis");
    const nextDocument = mergeMeasurementSections(document, generatedSections);
    const serialized = serializeWorkoutNoteSourceDocument(nextDocument);
    if (serialized === fileContent) {
      continue;
    }

    await fs.writeFile(filePath, serialized, "utf8");
    updatedNotes += 1;
    measurementSectionsWritten += generatedSections.length;
    if (!beforeHadAnalysis) {
      createdAnalysisSections += 1;
    }
  }

  console.log(
    JSON.stringify(
      {
        updatedNotes,
        createdAnalysisSections,
        measurementSectionsWritten,
        skippedNotes,
      },
      null,
      2,
    ),
  );
}

async function buildMeasurementSections(detailSources: Partial<Record<"strava" | "appleHealth", WorkoutSourceSummary>>) {
  const sections: WorkoutNoteAnalysisSection[] = [];
  const appleHealthSummary = detailSources.appleHealth;
  if (appleHealthSummary) {
    const appleHealthMeasurements = await readAppleHealthMeasurements(appleHealthSummary.activityId);
    if (appleHealthMeasurements) {
      sections.push(...buildAppleHealthMeasurementAnalysisSections(appleHealthMeasurements));
    }
  }

  const stravaSummary = detailSources.strava;
  if (stravaSummary) {
    const routeStreams = await readRouteStreams(stravaSummary.routePath);
    sections.push(...buildStravaMeasurementAnalysisSections(stravaSummary, routeStreams));
  }

  return sections;
}

async function readAppleHealthMeasurements(activityId: string) {
  const filePath = path.join(appleHealthMeasurementsDir, `${activityId}.json`);
  try {
    return await readJsonFile<AppleHealthWorkoutMeasurements>(filePath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function readRouteStreams(routePath: string | null) {
  if (!routePath) {
    return null;
  }

  const resolvedPath = path.resolve(publicDir, `.${routePath}`);
  try {
    return await readJsonFile<WorkoutRouteStreams>(resolvedPath);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function mergeMeasurementSections(document: WorkoutNoteSourceDocument, generatedSections: WorkoutNoteAnalysisSection[]) {
  const analysisIndex = document.sections.findIndex((section) => section.kind === "analysis");
  if (analysisIndex === -1) {
    return {
      ...document,
      sections: [
        ...document.sections,
        {
          kind: "analysis" as const,
          sections: generatedSections,
        },
      ],
    };
  }

  const analysisSection = document.sections[analysisIndex];
  if (!analysisSection || analysisSection.kind !== "analysis") {
    return document;
  }

  const preservedSections = analysisSection.sections.filter(
    (section) => section.kind !== "appleHealthMeasurement" && section.kind !== "stravaMeasurement",
  );
  const nextAnalysisSection = {
    ...analysisSection,
    sections: [...preservedSections, ...generatedSections],
  };

  const nextSections = [...document.sections];
  nextSections[analysisIndex] = nextAnalysisSection;
  return {
    ...document,
    sections: nextSections,
  };
}

async function readJsonFile<T>(filePath: string) {
  const fileContent = await fs.readFile(filePath, "utf8");
  return JSON.parse(fileContent) as T;
}

await main();
