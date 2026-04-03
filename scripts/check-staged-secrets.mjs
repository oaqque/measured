import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const allowMarker = "secret-scan: allow";

const secretRules = [
  {
    name: "Private key block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  },
  {
    name: "OpenAI key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/u,
  },
  {
    name: "GitHub token",
    pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{20,}\b/u,
  },
  {
    name: "AWS access key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u,
  },
  {
    name: "Slack token",
    pattern: /\bxox(?:a|b|p|o|s|r)-[A-Za-z0-9-]{10,}\b/u,
  },
  {
    name: "Generic secret assignment",
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|client[_-]?secret|password|passwd)\b\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{16,}/iu,
  },
];

if (process.argv.includes("--self-test")) {
  runSelfTest();
  process.exit(0);
}

const stagedFiles = getStagedFiles();
const findings = [];

for (const filePath of stagedFiles) {
  const content = getStagedFileContent(filePath);
  if (content === null || shouldSkipBinary(content)) {
    continue;
  }

  const lines = content.split(/\r?\n/u);
  for (const rule of secretRules) {
    const match = rule.pattern.exec(content);
    if (!match) {
      continue;
    }

    const lineNumber = getLineNumberFromIndex(content, match.index);
    const line = lines[lineNumber - 1] ?? "";
    if (line.includes(allowMarker)) {
      continue;
    }

    const candidate = match[0];
    if (looksLikePlaceholder(candidate)) {
      continue;
    }

    if (findings.some((finding) => finding.filePath === filePath && finding.lineNumber === lineNumber)) {
      continue;
    }

    findings.push({
      filePath,
      lineNumber,
      ruleName: rule.name,
      preview: redactLine(line.trim()),
    });
  }
}

if (findings.length > 0) {
  console.error("Secret scan failed. Remove the secret or mark an intentional false positive with `secret-scan: allow`.");
  for (const finding of findings) {
    console.error(`- ${finding.filePath}:${finding.lineNumber} ${finding.ruleName}`);
    console.error(`  ${finding.preview}`);
  }
  process.exit(1);
}

function runSelfTest() {
  const safe = scanContent('const example = "sk-example-placeholder"; // secret-scan: allow');
  const fakeGitHubToken = ["ghp", "123456789012345678901234567890123456"].join("_");
  const unsafe = scanContent(`const token = "${fakeGitHubToken}";`);

  if (safe.length !== 0) {
    throw new Error("expected allowlisted sample to pass");
  }

  if (unsafe.length === 0) {
    throw new Error("expected sample token to be detected");
  }
}

function scanContent(content) {
  const lines = content.split(/\r?\n/u);
  const localFindings = [];
  for (const rule of secretRules) {
    const match = rule.pattern.exec(content);
    if (!match) {
      continue;
    }

    const lineNumber = getLineNumberFromIndex(content, match.index);
    const line = lines[lineNumber - 1] ?? "";
    if (line.includes(allowMarker) || looksLikePlaceholder(match[0])) {
      continue;
    }

    localFindings.push(rule.name);
  }

  return localFindings;
}

function getStagedFiles() {
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
    cwd: rootDir,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || "unable to list staged files");
  }

  return result.stdout.split("\0").filter(Boolean);
}

function getStagedFileContent(filePath) {
  const result = spawnSync("git", ["show", `:${filePath}`], {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout;
}

function shouldSkipBinary(content) {
  return content.includes("\u0000");
}

function getLineNumberFromIndex(content, index) {
  return content.slice(0, index).split("\n").length;
}

function looksLikePlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("example") ||
    normalized.includes("placeholder") ||
    normalized.includes("your_") ||
    normalized.includes("your-") ||
    normalized.includes("xxx") ||
    normalized.includes("dummy")
  );
}

function redactLine(line) {
  return line.replace(/[A-Za-z0-9_./+=-]{12,}/gu, (value) => {
    if (looksLikePlaceholder(value)) {
      return value;
    }

    return `${value.slice(0, 4)}...${value.slice(-4)}`;
  });
}
