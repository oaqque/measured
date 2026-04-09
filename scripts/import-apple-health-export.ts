import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importAppleHealthSource } from "./apple-health-import-lib";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultOutputRoot = path.resolve(rootDir, "vault/apple-health");

interface AppleHealthExportManifestCopy {
  exportedAt: string;
  workoutCount: number;
  routeCount: number;
  collectionCount?: number;
  sampleCount?: number;
}

function getCliFlagValue(flag: string) {
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

async function main() {
  const from = getCliFlagValue("--from");
  if (!from) {
    throw new Error("Missing required --from <path> argument");
  }

  const sourcePath = path.resolve(rootDir, from);
  const outputRoot = path.resolve(rootDir, getCliFlagValue("--output-root") ?? defaultOutputRoot);

  const normalizedExport = await resolveNormalizedExport(sourcePath);
  if (normalizedExport) {
    await copyNormalizedExport(normalizedExport.snapshotPath, normalizedExport.manifestPath, outputRoot);
    const manifest = await readManifest(normalizedExport.manifestPath);
    logImportSummary(normalizedExport.snapshotPath, outputRoot, manifest);
    return;
  }

  const { manifest, snapshot } = await importAppleHealthSource(sourcePath);
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.writeFile(
    path.join(outputRoot, "cache-export.json"),
    `${JSON.stringify(snapshot, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(outputRoot, "export-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  console.log(
    [
      `Imported Apple Health data from ${manifest.sourcePath}`,
      `Workouts: ${manifest.workoutCount}`,
      `Routes: ${manifest.routeCount}`,
      `Output: ${path.join(outputRoot, "cache-export.json")}`,
      manifest.warnings.length > 0 ? `Warnings: ${manifest.warnings.length}` : "Warnings: 0",
    ].join("\n"),
  );

  if (manifest.warnings.length > 0) {
    for (const warning of manifest.warnings) {
      console.warn(`- ${warning}`);
    }
  }
}

async function resolveNormalizedExport(sourcePath: string) {
  const stats = await fs.stat(sourcePath);

  if (stats.isDirectory()) {
    const snapshotPath = path.join(sourcePath, "cache-export.json");
    const manifestPath = path.join(sourcePath, "export-manifest.json");
    if ((await pathExists(snapshotPath)) && (await pathExists(manifestPath))) {
      return { snapshotPath, manifestPath };
    }
    return null;
  }

  if (!sourcePath.endsWith(".json")) {
    return null;
  }

  const directory = path.dirname(sourcePath);
  const manifestFileName = resolveNormalizedManifestFileName(path.basename(sourcePath));
  if (!manifestFileName) {
    return null;
  }
  const manifestPath = path.join(directory, manifestFileName);

  if (!(await pathExists(manifestPath))) {
    return null;
  }

  return {
    snapshotPath: sourcePath,
    manifestPath,
  };
}

function resolveNormalizedManifestFileName(snapshotFileName: string) {
  if (/^export-manifest\.json$/iu.test(snapshotFileName)) {
    return null;
  }

  if (/^cache-export\.json$/iu.test(snapshotFileName) || /^apple-health-export\.json$/iu.test(snapshotFileName)) {
    return "export-manifest.json";
  }

  const replacedFileName = snapshotFileName.replace(/cache-export/iu, "export-manifest");
  return replacedFileName === snapshotFileName ? null : replacedFileName;
}

async function copyNormalizedExport(snapshotPath: string, manifestPath: string, outputRoot: string) {
  await fs.mkdir(outputRoot, { recursive: true });
  await fs.copyFile(snapshotPath, path.join(outputRoot, "cache-export.json"));
  await fs.copyFile(manifestPath, path.join(outputRoot, "export-manifest.json"));
}

async function readManifest(manifestPath: string): Promise<AppleHealthExportManifestCopy> {
  const fileContent = await fs.readFile(manifestPath, "utf8");
  return JSON.parse(fileContent) as AppleHealthExportManifestCopy;
}

function logImportSummary(
  sourcePath: string,
  outputRoot: string,
  manifest: AppleHealthExportManifestCopy,
) {
  console.log(
    [
      `Imported Apple Health data from ${sourcePath}`,
      `Workouts: ${manifest.workoutCount}`,
      `Routes: ${manifest.routeCount}`,
      manifest.collectionCount !== undefined ? `Collections: ${manifest.collectionCount}` : null,
      manifest.sampleCount !== undefined ? `Samples: ${manifest.sampleCount}` : null,
      `Output: ${path.join(outputRoot, "cache-export.json")}`,
      "Warnings: 0",
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
  );
}

async function pathExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

await main();
