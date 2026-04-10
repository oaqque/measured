import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  ConflictError,
  DEFAULT_MAX_BATCH_BYTES,
  NotFoundError,
  ValidationError,
  appendReceiverDeltaBatch,
  commitReceiverSession,
  createReceiverSession,
  getReceiverSessionStatus,
  getReceiverStatus,
  type AppleHealthSyncReceiverOptions,
} from "./apple-health-sync-receiver-lib"
import type {
  AppleHealthSyncCommitRequest,
  AppleHealthSyncDeltaBatch,
  AppleHealthSyncSessionCreateRequest,
} from "./apple-health-sync-protocol"

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)))

function getCliFlagValue(flag: string) {
  const flagIndex = process.argv.findIndex((argument) => argument === flag)
  if (flagIndex === -1) {
    return null
  }

  const nextValue = process.argv[flagIndex + 1]
  if (!nextValue || nextValue.startsWith("--")) {
    throw new Error(`${flag} requires a value`)
  }

  return nextValue
}

async function main() {
  const port = Number.parseInt(getCliFlagValue("--port") ?? "8788", 10)
  const host = getCliFlagValue("--host") ?? "0.0.0.0"
  const outputRoot = path.resolve(rootDir, getCliFlagValue("--output-root") ?? "vault/apple-health")
  const stateRoot = path.resolve(rootDir, getCliFlagValue("--state-root") ?? "vault/apple-health-sync-server")

  const options: AppleHealthSyncReceiverOptions = {
    outputRoot,
    stateRoot,
    maxBatchBytes: DEFAULT_MAX_BATCH_BYTES,
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)

      if (request.method === "GET" && url.pathname === "/health-sync/status") {
        await writeJson(response, 200, await getReceiverStatus(options))
        return
      }

      if (request.method === "POST" && url.pathname === "/health-sync/session") {
        const body = await readJsonBody<AppleHealthSyncSessionCreateRequest>(request, options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)
        await writeJson(response, 200, await createReceiverSession(options, body))
        return
      }

      if (request.method === "POST" && url.pathname === "/health-sync/delta") {
        const rawBody = await readRawBody(request, options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)
        const body = JSON.parse(rawBody) as AppleHealthSyncDeltaBatch
        await writeJson(response, 200, await appendReceiverDeltaBatch(options, body, rawBody))
        return
      }

      if (request.method === "POST" && url.pathname === "/health-sync/commit") {
        const body = await readJsonBody<AppleHealthSyncCommitRequest>(request, options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)
        await writeJson(response, 200, await commitReceiverSession(options, body))
        return
      }

      if (request.method === "GET" && /^\/health-sync\/session\/[^/]+$/u.test(url.pathname)) {
        const sessionId = url.pathname.split("/").pop()
        if (!sessionId) {
          throw new NotFoundError("Missing session id.")
        }
        await writeJson(response, 200, await getReceiverSessionStatus(options, sessionId))
        return
      }

      await writeJson(response, 404, { error: "Not found" })
    } catch (error) {
      const statusCode =
        error instanceof ValidationError ? 400 :
          error instanceof ConflictError ? 409 :
            error instanceof NotFoundError ? 404 :
              500

      await writeJson(response, statusCode, {
        error: error instanceof Error ? error.message : "Unknown error",
      })
    }
  })

  server.listen(port, host, () => {
    console.log(
      [
        `Apple Health sync server listening on http://${host}:${port}`,
        `Output root: ${outputRoot}`,
        `State root: ${stateRoot}`,
      ].join("\n"),
    )
  })
}

async function readJsonBody<T>(request: IncomingMessage, maxBytes: number): Promise<T> {
  return JSON.parse(await readRawBody(request, maxBytes)) as T
}

async function readRawBody(request: IncomingMessage, maxBytes: number) {
  const chunks: Buffer[] = []
  let totalLength = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalLength += buffer.length
    if (totalLength > maxBytes) {
      throw new ValidationError(`Request body exceeded ${maxBytes} bytes.`)
    }
    chunks.push(buffer)
  }

  return Buffer.concat(chunks).toString("utf8")
}

async function writeJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: unknown,
) {
  const responseBody = `${JSON.stringify(payload, null, 2)}\n`
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(responseBody, "utf8"),
  })
  response.end(responseBody)
}

await main()
