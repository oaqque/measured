import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const gitDir = path.join(rootDir, ".git");

if (!existsSync(gitDir)) {
  process.exit(0);
}

const unsetResult = spawnSync("git", ["config", "--local", "--unset-all", "core.hooksPath"], {
  cwd: rootDir,
  stdio: "ignore",
});

if (unsetResult.status !== 0 && unsetResult.status !== 5) {
  process.exit(unsetResult.status ?? 1);
}

const result = spawnSync("uv", ["run", "pre-commit", "install", "--install-hooks", "--hook-type", "pre-commit"], {
  cwd: rootDir,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
