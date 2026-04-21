import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveWorkoutsSourceDir } from "./lib/workouts-source";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sharedArgs = process.argv.slice(2);

async function main() {
  const workoutsSourceDir = await resolveWorkoutsSourceDir({
    args: sharedArgs,
    env: process.env,
    rootDir,
  });
  const sharedEnv = {
    ...process.env,
    WORKOUTS_SOURCE_DIR: workoutsSourceDir,
  };

  await runStage("Build data", "pnpm", ["run", "build:data"], sharedEnv);
  await runStage("Build WASM graph", "pnpm", ["run", "graph:build:wasm"], sharedEnv);

  const children = new Set<ChildProcess>();
  let shuttingDown = false;

  const stopChildren = (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const child of children) {
      if (child.killed || child.exitCode !== null) {
        continue;
      }

      child.kill(signal);
    }
  };

  const spawnManaged = (label: string, command: string, args: string[]) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: sharedEnv,
      shell: process.platform === "win32",
      stdio: "inherit",
    });
    children.add(child);

    child.on("exit", (code, signal) => {
      children.delete(child);
      if (shuttingDown) {
        return;
      }

      stopChildren("SIGTERM");
      if (signal) {
        console.error(`[dev] ${label} exited from signal ${signal}`);
        process.exit(1);
        return;
      }

      process.exit(code ?? 0);
    });

    child.on("error", (error) => {
      children.delete(child);
      if (shuttingDown) {
        return;
      }

      stopChildren("SIGTERM");
      console.error(`[dev] ${label} failed to start: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });

    return child;
  };

  process.on("SIGINT", () => {
    stopChildren("SIGINT");
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    stopChildren("SIGTERM");
    process.exit(0);
  });

  spawnManaged("data watcher", "pnpm", ["run", "dev:watch-data"]);
  spawnManaged("vite", "pnpm", ["run", "dev:vite"]);
}

function runStage(label: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
  console.log(`[dev] ${label}`);
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${label} exited from signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${label} exited with code ${code ?? "unknown"}`));
        return;
      }

      resolve();
    });
  });
}

void main().catch((error) => {
  console.error(`[dev] Failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
