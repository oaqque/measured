import fs from "node:fs/promises";
import path from "node:path";

export const defaultDataDirName = "data";
export const defaultWorkoutsDirName = "data/training";

export function getCliFlagValue(args: string[], flag: string) {
  const flagIndex = args.findIndex((argument) => argument === flag);
  if (flagIndex === -1) {
    return null;
  }

  const nextValue = args[flagIndex + 1];
  if (!nextValue || nextValue.startsWith("--")) {
    throw new Error(`${flag} requires a path value`);
  }

  return nextValue;
}

export function hasConfiguredWorkoutsSource(args: string[], env: NodeJS.ProcessEnv) {
  return getCliFlagValue(args, "--source") !== null || Boolean(env.WORKOUTS_SOURCE_DIR);
}

export async function resolveWorkoutsSourceDir({
  args,
  env,
  rootDir,
}: {
  args: string[];
  env: NodeJS.ProcessEnv;
  rootDir: string;
}) {
  const defaultWorkoutsDir = path.resolve(rootDir, defaultWorkoutsDirName);
  const flagValue = getCliFlagValue(args, "--source");
  const configuredPath = flagValue ?? env.WORKOUTS_SOURCE_DIR ?? defaultWorkoutsDir;
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
