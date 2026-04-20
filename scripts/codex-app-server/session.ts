import type { ServerResponse } from "node:http";
import { CodexJsonRpcClient } from "./rpc";
import type {
  CodexAccountReadResult,
  JsonRpcEnvelope,
  SessionEvent,
  ThreadStartResult,
  TurnStartResult,
} from "./types";

interface GraphSessionState {
  activeTurnId: string | null;
  eventClients: Set<ServerResponse>;
  threadId: string;
}

export class CodexGraphSessionManager {
  private readonly cwd: string;
  private initialized = false;
  private readonly rpc: CodexJsonRpcClient;
  private readonly sessions = new Map<string, GraphSessionState>();

  constructor(cwd: string) {
    this.cwd = cwd;
    this.rpc = new CodexJsonRpcClient(cwd);
    this.rpc.onNotification((message) => {
      this.handleNotification(message);
    });
  }

  async health() {
    try {
      await this.ensureInitialized();
      const account = await this.rpc.request<CodexAccountReadResult>("account/read", {});
      return {
        ok: Boolean(account.account),
        authenticated: Boolean(account.account),
        backend: account.account ? `Connected as ${account.account.email ?? account.account.type}` : "Codex app-server is not authenticated.",
      };
    } catch (error) {
      return {
        ok: false,
        authenticated: false,
        backend: error instanceof Error ? error.message : "Codex app-server unavailable.",
      };
    }
  }

  async createSession(sessionId: string) {
    await this.ensureInitialized();
    const thread = await this.rpc.request<ThreadStartResult>("thread/start", { cwd: this.cwd });
    this.sessions.set(sessionId, {
      activeTurnId: null,
      eventClients: new Set(),
      threadId: thread.thread.id,
    });

    return thread.thread.id;
  }

  addEventClient(sessionId: string, response: ServerResponse) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }

    session.eventClients.add(response);
    response.on("close", () => {
      session.eventClients.delete(response);
    });
    return true;
  }

  async startTurn(sessionId: string, message: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown chat session: ${sessionId}`);
    }

    const result = await this.rpc.request<TurnStartResult>("turn/start", {
      threadId: session.threadId,
      input: [
        {
          type: "text",
          text: message,
        },
      ],
      cwd: this.cwd,
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "readOnly",
        access: {
          type: "fullAccess",
        },
      },
      model: "gpt-5.4-mini",
      effort: "low",
      summary: "concise",
    });

    session.activeTurnId = result.turn.id;
  }

  async interrupt(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.activeTurnId) {
      return;
    }

    await this.rpc.request("turn/interrupt", {
      threadId: session.threadId,
      turnId: session.activeTurnId,
    });
    session.activeTurnId = null;
  }

  close() {
    this.rpc.close();
  }

  private async ensureInitialized() {
    if (this.initialized) {
      return;
    }

    await this.rpc.request("initialize", {
      clientInfo: {
        name: "measured-graph",
        title: "Measured Graph",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
      },
    });
    this.rpc.notify("initialized", {});
    this.initialized = true;
  }

  private handleNotification(message: JsonRpcEnvelope) {
    if (!message.method || !message.params) {
      return;
    }

    const entry = this.findSessionForMessage(message);
    if (!entry) {
      return;
    }

    if (message.method === "turn/completed") {
      const turn = message.params.turn;
      const turnId = getTurnId(turn);
      if (!isTurnPayload(turn) || !entry.session.activeTurnId || !turnId || entry.session.activeTurnId !== turnId) {
        return;
      }
      entry.session.activeTurnId = null;
    }

    this.broadcast(entry.sessionId, {
      type: "rpcEvent",
      method: message.method,
      params: message.params,
      requestId: typeof message.id === "number" ? message.id : null,
    });
  }

  private findSessionByTurnId(turnId: string) {
    for (const [sessionId, session] of this.sessions) {
      if (session.activeTurnId === turnId) {
        return { sessionId, session };
      }
    }

    return null;
  }

  private findSessionByThreadId(threadId: string) {
    for (const [sessionId, session] of this.sessions) {
      if (session.threadId === threadId) {
        return { sessionId, session };
      }
    }

    return null;
  }

  private findSessionForMessage(message: JsonRpcEnvelope) {
    const turnId = extractTurnId(message.params);
    if (turnId) {
      const turnEntry = this.findSessionByTurnId(turnId);
      if (turnEntry) {
        return turnEntry;
      }

      return null;
    }

    const threadId = extractThreadId(message.params);
    if (!threadId) {
      return null;
    }

    return this.findSessionByThreadId(threadId);
  }

  private broadcast(sessionId: string, event: SessionEvent) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of session.eventClients) {
      client.write(data);
    }
  }
}

function isTurnPayload(value: unknown): value is { status: string; error?: { message?: string } | null } {
  return typeof value === "object" && value !== null && "status" in value;
}

function getTurnId(value: unknown) {
  if (typeof value !== "object" || value === null || !("id" in value)) {
    return null;
  }

  return typeof value.id === "string" ? value.id : null;
}

function extractTurnId(params: Record<string, unknown> | undefined) {
  if (!params) {
    return null;
  }

  if (typeof params.turnId === "string") {
    return params.turnId;
  }

  return getTurnId(params.turn);
}

function extractThreadId(params: Record<string, unknown> | undefined) {
  if (!params) {
    return null;
  }

  return typeof params.threadId === "string" ? params.threadId : null;
}
