import { spawn } from "node:child_process";
import cliProgress from "cli-progress";

const stages = [
  { label: "Build data", command: "pnpm", args: ["run", "build:data"] },
  { label: "Build WASM graph", command: "pnpm", args: ["run", "graph:build:wasm"] },
  { label: "TypeScript", command: "pnpm", args: ["exec", "tsc", "-b"] },
  { label: "Vite bundle", command: "pnpm", args: ["exec", "vite", "build"] },
];

const buildStartedAt = Date.now();
const progress = createProgressTracker(stages.length);

for (let index = 0; index < stages.length; index += 1) {
  const stage = stages[index];
  progress.step(`${stage.label}...`);
  await runStage(stage.command, stage.args);
}

progress.finish("Build complete");
console.log(`Build finished in ${formatDurationSeconds((Date.now() - buildStartedAt) / 1000)}.`);

function runStage(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      shell: process.platform === "win32",
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} exited from signal ${signal}`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
        return;
      }

      resolve();
    });
  });
}

function createProgressTracker(totalStages) {
  if (!process.stdout.isTTY) {
    return {
      step(label) {
        console.log(`[build] ${label}`);
      },
      finish(label) {
        console.log(`[build] ${label}`);
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

  bar.start(totalStages, 0, { stage: "Starting build..." });

  return {
    step(label) {
      bar.increment(1, { stage: label });
    },
    finish(label) {
      bar.update(totalStages, { stage: label });
      bar.stop();
    },
  };
}

function formatDurationSeconds(totalSeconds) {
  const roundedSeconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
