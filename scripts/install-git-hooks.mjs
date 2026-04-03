import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const gitDir = path.join(rootDir, ".git");

if (!existsSync(gitDir)) {
  process.exit(0);
}

const result = spawnSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  cwd: rootDir,
  stdio: "inherit",
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
