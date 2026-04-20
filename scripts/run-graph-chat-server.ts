import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { CodexGraphSessionManager } from "./codex-app-server/session";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const host = process.env.MEASURED_GRAPH_CHAT_HOST ?? "127.0.0.1";
const port = Number(process.env.MEASURED_GRAPH_CHAT_PORT ?? "5177");
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
      response.write(`data: ${JSON.stringify({ type: "status", scope: "session", text: "Codex chat session connected." })}\n\n`);
      if (!manager.addEventClient(sessionId, response)) {
        response.write(`data: ${JSON.stringify({ type: "error", text: "Unknown chat session." })}\n\n`);
        response.end();
      }
      return;
    }

    const messageMatch = url.pathname.match(/^\/api\/graph-chat\/session\/([^/]+)\/message$/u);
    if (request.method === "POST" && messageMatch) {
      const sessionId = decodeURIComponent(messageMatch[1]);
      const body = (await readJsonBody(request)) as { message?: string };
      if (typeof body.message !== "string") {
        return json(response, 400, { error: "Missing chat message payload." });
      }

      await manager.startTurn(sessionId, body.message);
      return json(response, 202, { ok: true });
    }

    const interruptMatch = url.pathname.match(/^\/api\/graph-chat\/session\/([^/]+)\/interrupt$/u);
    if (request.method === "POST" && interruptMatch) {
      manager.interrupt(decodeURIComponent(interruptMatch[1]));
      return json(response, 202, { ok: true });
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
