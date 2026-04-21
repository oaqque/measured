import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";
import { defaultDataDirName, hasConfiguredWorkoutsSource, resolveWorkoutsSourceDir } from "./lib/workouts-source";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const graphLinksPath = path.resolve(rootDir, "data/training/graph-links.json");
const ignoredPaths = ["**/.git/**", "**/node_modules/**", "**/public/generated/**", "**/src/generated/**"];
const debounceMs = 200;

async function main() {
  const args = process.argv.slice(2);
  const workoutsSourceDir = await resolveWorkoutsSourceDir({
    args,
    env: process.env,
    rootDir,
  });
  process.env.WORKOUTS_SOURCE_DIR = workoutsSourceDir;

  const defaultDataDir = path.resolve(rootDir, defaultDataDirName);
  const watchRoot = hasConfiguredWorkoutsSource(args, process.env) ? workoutsSourceDir : defaultDataDir;
  const watchTargets = dedupePaths([watchRoot, graphLinksPath]);
  console.log(`[watch:data] Watching ${watchTargets.join(", ")}`);

  let buildRunning = false;
  let buildQueued = false;
  let debounceTimer: NodeJS.Timeout | null = null;
  let closed = false;

  const watcher = chokidar.watch(watchTargets, {
    awaitWriteFinish: {
      pollInterval: 100,
      stabilityThreshold: 200,
    },
    ignoreInitial: true,
    ignored: ignoredPaths,
  });

  const scheduleRebuild = (reason: string, changedPath: string) => {
    if (closed) {
      return;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }

    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void triggerBuild(`${reason}: ${path.relative(rootDir, changedPath) || changedPath}`);
    }, debounceMs);
  };

  const triggerBuild = async (reason: string) => {
    if (closed) {
      return;
    }

    if (buildRunning) {
      buildQueued = true;
      console.log(`[watch:data] Queued rebuild while build is running (${reason})`);
      return;
    }

    buildRunning = true;
    try {
      console.log(`[watch:data] Rebuilding data (${reason})`);
      await runBuildData();
      console.log("[watch:data] Rebuild complete");
    } catch (error) {
      console.error(`[watch:data] Rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      buildRunning = false;
      if (buildQueued && !closed) {
        buildQueued = false;
        void triggerBuild("queued changes");
      }
    }
  };

  watcher.on("add", (changedPath) => scheduleRebuild("add", changedPath));
  watcher.on("change", (changedPath) => scheduleRebuild("change", changedPath));
  watcher.on("unlink", (changedPath) => scheduleRebuild("unlink", changedPath));
  watcher.on("addDir", (changedPath) => scheduleRebuild("addDir", changedPath));
  watcher.on("unlinkDir", (changedPath) => scheduleRebuild("unlinkDir", changedPath));
  watcher.on("error", (error) => {
    console.error(`[watch:data] Watcher error: ${error instanceof Error ? error.message : String(error)}`);
  });

  const shutdown = async (signal: NodeJS.Signals) => {
    if (closed) {
      return;
    }

    closed = true;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    console.log(`[watch:data] Shutting down (${signal})`);
    await watcher.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

function runBuildData() {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", ["run", "build:data"], {
      cwd: rootDir,
      env: {
        ...process.env,
      },
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`pnpm run build:data exited from signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`pnpm run build:data exited with code ${code ?? "unknown"}`));
        return;
      }

      resolve();
    });
  });
}

function dedupePaths(paths: string[]) {
  return [...new Set(paths)];
}

void main().catch((error) => {
  console.error(`[watch:data] Failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
