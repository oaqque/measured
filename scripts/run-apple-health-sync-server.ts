import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  ConflictError,
  DEFAULT_MAX_BATCH_BYTES,
  DEFAULT_MAX_BLOB_BYTES,
  NotFoundError,
  ValidationError,
  bulkApplyReceiverDocuments,
  commitReceiverManifest,
  getLegacyReceiverStatus,
  getReceiverCheckpoint,
  getReceiverRevsDiff,
  getReceiverStatus,
  planReceiverManifest,
  putReceiverBlob,
  putReceiverCheckpoint,
  type AppleHealthSyncReceiverOptions,
} from "./apple-health-sync-receiver-lib"
import type {
  AppleHealthSyncBulkDocsRequest,
  AppleHealthSyncCheckpointRequest,
  AppleHealthSyncCommitRequest,
  AppleHealthSyncPlanRequest,
  AppleHealthSyncRevsDiffRequest,
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
    maxBlobBytes: DEFAULT_MAX_BLOB_BYTES,
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
      const isCanonicalV3Path = url.pathname === "/health-sync"
      const isVersionedV3Path = url.pathname === "/health-sync-v3"
      const isV3RootPath = isCanonicalV3Path || isVersionedV3Path

      if (request.method === "GET" && url.pathname === "/health-sync-v2") {
        await writeJson(response, 200, await getLegacyReceiverStatus(options))
        return
      }

      if (request.method === "GET" && isV3RootPath) {
        await writeJson(response, 200, await getReceiverStatus(options))
        return
      }

      if (request.method === "GET" && /^\/health-sync-v2\/_local\/[^/]+$/u.test(url.pathname)) {
        const replicationId = decodeURIComponent(url.pathname.split("/").pop() ?? "")
        await writeJson(response, 200, await getReceiverCheckpoint(options, replicationId))
        return
      }

      if (request.method === "GET" && /^\/health-sync(?:-v3)?\/_local\/[^/]+$/u.test(url.pathname)) {
        const replicationId = decodeURIComponent(url.pathname.split("/").pop() ?? "")
        await writeJson(response, 200, await getReceiverCheckpoint(options, replicationId))
        return
      }

      if (request.method === "PUT" && /^\/health-sync-v2\/_local\/[^/]+$/u.test(url.pathname)) {
        const replicationId = decodeURIComponent(url.pathname.split("/").pop() ?? "")
        const body = await readJsonBody<AppleHealthSyncCheckpointRequest>(request, options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)
        await writeJson(response, 200, await putReceiverCheckpoint(options, replicationId, body))
        return
      }

      if (request.method === "PUT" && /^\/health-sync(?:-v3)?\/_local\/[^/]+$/u.test(url.pathname)) {
        const replicationId = decodeURIComponent(url.pathname.split("/").pop() ?? "")
        const body = await readJsonBody<AppleHealthSyncCheckpointRequest>(request, options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)
        await writeJson(response, 200, await putReceiverCheckpoint(options, replicationId, body))
        return
      }

      if (request.method === "POST" && url.pathname === "/health-sync-v2/_revs_diff") {
        const body = await readJsonBody<AppleHealthSyncRevsDiffRequest>(request, options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)
        await writeJson(response, 200, await getReceiverRevsDiff(options, body))
        return
      }

      if (request.method === "POST" && url.pathname === "/health-sync-v2/_bulk_docs") {
        const rawBody = await readRawBody(request, options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)
        const body = parseJsonBody<AppleHealthSyncBulkDocsRequest>(rawBody)
        await writeJson(response, 200, await bulkApplyReceiverDocuments(options, body, rawBody))
        return
      }

      if (request.method === "POST" && ["/health-sync/_plan", "/health-sync-v3/_plan"].includes(url.pathname)) {
        const body = await readJsonBody<AppleHealthSyncPlanRequest>(request, options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)
        await writeJson(response, 200, await planReceiverManifest(options, body))
        return
      }

      if (request.method === "PUT" && /^\/health-sync(?:-v3)?\/_blob\/[0-9a-f]{64}$/u.test(url.pathname)) {
        const blobHash = decodeURIComponent(url.pathname.split("/").pop() ?? "")
        const body = await readRawBodyBuffer(request, options.maxBlobBytes ?? DEFAULT_MAX_BLOB_BYTES)
        await putReceiverBlob(options, blobHash, body)
        await writeJson(response, 200, { ok: true, blobHash })
        return
      }

      if (request.method === "POST" && ["/health-sync/_commit", "/health-sync-v3/_commit"].includes(url.pathname)) {
        const body = await readJsonBody<AppleHealthSyncCommitRequest>(request, options.maxBatchBytes ?? DEFAULT_MAX_BATCH_BYTES)
        await writeJson(response, 200, await commitReceiverManifest(options, body))
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
  return parseJsonBody<T>(await readRawBody(request, maxBytes))
}

function parseJsonBody<T>(rawBody: string): T {
  try {
    return JSON.parse(rawBody) as T
  } catch {
    throw new ValidationError("Request body must be valid JSON.")
  }
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

async function readRawBodyBuffer(request: IncomingMessage, maxBytes: number) {
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

  return Buffer.concat(chunks)
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
