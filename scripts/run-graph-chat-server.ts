import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AuthoredGraphLinksDocument, GraphOp, NoteGraphData } from "../src/lib/graph/schema";
import { NOTE_GRAPH_SCHEMA_VERSION } from "../src/lib/graph/schema";
import { CodexGraphSessionManager } from "./codex-app-server/session";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const host = process.env.MEASURED_GRAPH_CHAT_HOST ?? "127.0.0.1";
const port = Number(process.env.MEASURED_GRAPH_CHAT_PORT ?? "5177");
const graphLinksPath = path.resolve(rootDir, "data/training/graph-links.json");
const generatedGraphPath = path.resolve(rootDir, "src/generated/note-graph.json");
const manager = new CodexGraphSessionManager(rootDir);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/api/graph-chat/health") {
      const health = await manager.health();
      return json(response, 200, health);
    }

    if (request.method === "POST" && url.pathname === "/api/graph-chat/session") {
      const sessionId = crypto.randomUUID();
      await manager.createSession(sessionId);
      return json(response, 200, { sessionId });
    }

    const eventMatch = url.pathname.match(/^\/api\/graph-chat\/session\/([^/]+)\/events$/u);
    if (request.method === "GET" && eventMatch) {
      const sessionId = decodeURIComponent(eventMatch[1]);
      response.writeHead(200, {
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      });
      response.write(`data: ${JSON.stringify({ type: "status", text: "Graph session connected." })}\n\n`);
      if (!manager.addEventClient(sessionId, response)) {
        response.write(`data: ${JSON.stringify({ type: "error", text: "Unknown graph session." })}\n\n`);
        response.end();
      }
      return;
    }

    const messageMatch = url.pathname.match(/^\/api\/graph-chat\/session\/([^/]+)\/message$/u);
    if (request.method === "POST" && messageMatch) {
      const sessionId = decodeURIComponent(messageMatch[1]);
      const body = (await readJsonBody(request)) as {
        graphContext?: {
          authoredLinkCount?: number;
          clusterMode?: string;
          linkCount?: number;
          nodeCount?: number;
          selectedNodeSlug?: string | null;
        };
        message?: string;
      };
      if (typeof body.message !== "string" || !body.graphContext) {
        return json(response, 400, { error: "Missing graph message payload." });
      }

      await manager.startTurn(sessionId, body.message, {
        authoredLinkCount: body.graphContext.authoredLinkCount ?? 0,
        clusterMode: body.graphContext.clusterMode ?? "eventType",
        linkCount: body.graphContext.linkCount ?? 0,
        nodeCount: body.graphContext.nodeCount ?? 0,
        selectedNodeSlug: body.graphContext.selectedNodeSlug ?? null,
      });
      return json(response, 202, { ok: true });
    }

    const interruptMatch = url.pathname.match(/^\/api\/graph-chat\/session\/([^/]+)\/interrupt$/u);
    if (request.method === "POST" && interruptMatch) {
      manager.interrupt(decodeURIComponent(interruptMatch[1]));
      return json(response, 202, { ok: true });
    }

    if (request.method === "POST" && url.pathname === "/api/graph-chat/graph/ops/apply") {
      const body = (await readJsonBody(request)) as { ops?: GraphOp[] };
      if (!Array.isArray(body.ops)) {
        return json(response, 400, { error: "Missing graph ops array." });
      }

      await applyGraphOps(body.ops);
      const graph = JSON.parse(await fs.readFile(generatedGraphPath, "utf8")) as NoteGraphData;
      return json(response, 200, { ok: true, graph });
    }

    response.writeHead(404).end("Not found");
  } catch (error) {
    json(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected graph chat server error.",
    });
  }
});

server.listen(port, host, () => {
  console.log(`Measured graph chat server listening on http://${host}:${port}`);
});

process.on("SIGINT", () => {
  manager.close();
  server.close(() => {
    process.exit(0);
  });
});

async function applyGraphOps(ops: GraphOp[]) {
  const document = JSON.parse(await fs.readFile(graphLinksPath, "utf8")) as AuthoredGraphLinksDocument;
  if (document.schemaVersion !== NOTE_GRAPH_SCHEMA_VERSION) {
    throw new Error(`Unsupported graph-links schema version: ${document.schemaVersion}`);
  }

  const nextLinks = [...document.links];

  for (const op of ops) {
    if (op.op === "createLink") {
      const nextEntry = {
        sourceSlug: op.sourceSlug,
        targetSlug: op.targetSlug,
        kind: op.kind,
        weight: op.strength ?? 0.9,
        label: op.label ?? null,
      };
      const existingIndex = nextLinks.findIndex(
        (entry) =>
          samePair(entry.sourceSlug, entry.targetSlug, op.sourceSlug, op.targetSlug) && entry.kind === op.kind,
      );
      if (existingIndex === -1) {
        nextLinks.push(nextEntry);
      } else {
        nextLinks[existingIndex] = nextEntry;
      }
      continue;
    }

    if (op.op === "removeLink") {
      const nextFilteredLinks = nextLinks.filter((entry) => {
        if (typeof op.linkId === "string") {
          const linkId = createLinkId(entry.sourceSlug, entry.targetSlug, entry.kind);
          return linkId !== op.linkId;
        }

        if (!op.sourceSlug || !op.targetSlug) {
          return true;
        }

        return !samePair(entry.sourceSlug, entry.targetSlug, op.sourceSlug, op.targetSlug) || (op.kind ? entry.kind !== op.kind : false);
      });
      nextLinks.length = 0;
      nextLinks.push(...nextFilteredLinks);
    }
  }

  await fs.writeFile(
    graphLinksPath,
    `${JSON.stringify(
      {
        schemaVersion: NOTE_GRAPH_SCHEMA_VERSION,
        links: nextLinks,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  await execFileAsync("pnpm", ["run", "graph:build:data"], {
    cwd: rootDir,
  });
}

function samePair(leftSource: string, leftTarget: string, rightSource: string, rightTarget: string) {
  return (
    (leftSource === rightSource && leftTarget === rightTarget) ||
    (leftSource === rightTarget && leftTarget === rightSource)
  );
}

function createLinkId(sourceSlug: string, targetSlug: string, kind: string) {
  const [source, target] = [sourceSlug, targetSlug].sort((left, right) => left.localeCompare(right));
  return `${kind}:${source}:${target}`;
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as unknown) : {};
}

function json(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}
