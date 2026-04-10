import fs from "node:fs/promises";
import path from "node:path";
import { getCliFlagValue, resolveNotesDir } from "./workout-source-utils";
import {
  getWorkoutNoteBaseName,
  parseWorkoutNoteSourceDocument,
  serializeWorkoutNoteSourceDocument,
} from "../src/lib/workouts/source-note";

async function main() {
  const explicitNotesDir = getCliFlagValue("--notes-dir");
  const notesDir = explicitNotesDir ? path.resolve(explicitNotesDir) : await resolveNotesDir();
  const keepMarkdown = process.argv.includes("--keep-markdown");
  const fileNames = (await fs.readdir(notesDir))
    .filter((fileName) => fileName.endsWith(".md"))
    .sort((left, right) => left.localeCompare(right));

  let migratedCount = 0;
  for (const fileName of fileNames) {
    const filePath = path.join(notesDir, fileName);
    const fileContent = await fs.readFile(filePath, "utf8");
    const document = parseWorkoutNoteSourceDocument(fileName, fileContent);
    const jsonPath = path.join(notesDir, `${getWorkoutNoteBaseName(fileName)}.json`);

    await fs.writeFile(jsonPath, serializeWorkoutNoteSourceDocument(document), "utf8");
    if (!keepMarkdown) {
      await fs.unlink(filePath);
    }
    migratedCount += 1;
  }

  console.log(
    keepMarkdown
      ? `Converted ${migratedCount} workout notes to JSON alongside existing markdown files`
      : `Migrated ${migratedCount} workout notes from markdown to JSON`,
  );
}

await main();
