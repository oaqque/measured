import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import type { JsonRpcEnvelope } from "./types";

type PendingRequest = {
  reject: (reason?: unknown) => void;
  resolve: (value: unknown) => void;
  timer: NodeJS.Timeout;
};

export class CodexJsonRpcClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly notificationHandlers = new Set<(message: JsonRpcEnvelope) => void>();
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private nextId = 1;
  private processError: Error | null = null;

  constructor(cwd: string) {
    this.child = spawn("codex", ["app-server"], {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const output = readline.createInterface({ input: this.child.stdout });
    output.on("line", (line) => {
      if (!line.trim()) {
        return;
      }

      const message = JSON.parse(line) as JsonRpcEnvelope;
      if (message.method) {
        for (const handler of this.notificationHandlers) {
          handler(message);
        }
        return;
      }

      if (typeof message.id === "number") {
        const pending = this.pendingRequests.get(message.id);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timer);
        this.pendingRequests.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message ?? `JSON-RPC request ${message.id} failed.`));
        } else {
          pending.resolve(message.result);
        }
        return;
      }

    });

    this.child.on("error", (error) => {
      this.processError = error instanceof Error ? error : new Error(String(error));
      for (const [id, pending] of this.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(this.processError);
        this.pendingRequests.delete(id);
      }
    });

    this.child.stderr.on("data", () => {
      return;
    });
  }

  async request<TResult>(method: string, params: Record<string, unknown>, timeoutMs = 60_000) {
    if (this.processError) {
      throw this.processError;
    }

    const id = this.nextId;
    this.nextId += 1;

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    });

    return await new Promise<TResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`JSON-RPC request timed out: ${method}`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.child.stdin.write(`${payload}\n`);
    });
  }

  notify(method: string, params: Record<string, unknown>) {
    if (this.processError) {
      return;
    }

    this.child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      })}\n`,
    );
  }

  onNotification(handler: (message: JsonRpcEnvelope) => void) {
    this.notificationHandlers.add(handler);
    return () => {
      this.notificationHandlers.delete(handler);
    };
  }

  close() {
    this.child.kill("SIGINT");
  }
}
