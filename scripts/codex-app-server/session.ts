import type { ServerResponse } from "node:http";
import { CodexJsonRpcClient } from "./rpc";
import { buildGraphOutputSchema, buildGraphTurnInput } from "./graph-prompts";
import type {
  CodexAccountReadResult,
  GraphTurnContext,
  JsonRpcEnvelope,
  SessionEvent,
  ThreadStartResult,
  TurnStartResult,
} from "./types";

interface GraphSessionState {
  activeTurnId: string | null;
  eventClients: Set<ServerResponse>;
  textBuffer: string;
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
    await this.ensureInitialized();
    const account = await this.rpc.request<CodexAccountReadResult>("account/read", {});
    return {
      ok: Boolean(account.account),
      authenticated: Boolean(account.account),
      backend: account.account ? `Connected as ${account.account.email ?? account.account.type}` : "Codex app-server is not authenticated.",
    };
  }

  async createSession(sessionId: string) {
    await this.ensureInitialized();
    const thread = await this.rpc.request<ThreadStartResult>("thread/start", { cwd: this.cwd });
    this.sessions.set(sessionId, {
      activeTurnId: null,
      eventClients: new Set(),
      textBuffer: "",
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

  async startTurn(sessionId: string, message: string, graphContext: GraphTurnContext) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown graph session: ${sessionId}`);
    }

    session.textBuffer = "";
    const result = await this.rpc.request<TurnStartResult>("turn/start", {
      threadId: session.threadId,
      input: buildGraphTurnInput(message, graphContext),
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
      outputSchema: buildGraphOutputSchema(),
    });

    session.activeTurnId = result.turn.id;
    this.broadcast(sessionId, {
      type: "status",
      text: "Codex is thinking about the graph...",
    });
  }

  interrupt(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.activeTurnId = null;
    session.textBuffer = "";
    this.broadcast(sessionId, {
      type: "status",
      text: "Graph turn interrupted locally.",
    });
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

    if (message.method === "item/agentMessage/delta") {
      const turnId = typeof message.params.turnId === "string" ? message.params.turnId : null;
      const delta = typeof message.params.delta === "string" ? message.params.delta : "";
      if (!turnId || !delta) {
        return;
      }

      const entry = this.findSessionByTurnId(turnId);
      if (!entry) {
        return;
      }

      entry.session.textBuffer += delta;
      this.broadcast(entry.sessionId, { type: "delta", text: delta });
      return;
    }

    if (message.method === "turn/completed") {
      const turn = message.params.turn;
      const threadId = typeof message.params.threadId === "string" ? message.params.threadId : null;
      if (!threadId || !isTurnPayload(turn)) {
        return;
      }

      const entry = this.findSessionByThreadId(threadId);
      if (!entry) {
        return;
      }

      if (turn.status === "completed") {
        this.broadcast(entry.sessionId, {
          type: "turnResult",
          payload: entry.session.textBuffer,
        });
      } else {
        this.broadcast(entry.sessionId, {
          type: "error",
          text: turn.error?.message ?? "The Codex graph turn failed.",
        });
      }

      entry.session.activeTurnId = null;
      entry.session.textBuffer = "";
      return;
    }

    if (message.method === "error") {
      const threadId = typeof message.params.threadId === "string" ? message.params.threadId : null;
      const errorMessage = message.params.error;
      if (!threadId) {
        return;
      }

      const entry = this.findSessionByThreadId(threadId);
      if (!entry) {
        return;
      }

      const text =
        typeof errorMessage === "object" &&
        errorMessage !== null &&
        "message" in errorMessage &&
        typeof errorMessage.message === "string"
          ? errorMessage.message
          : "The Codex graph request failed.";
      this.broadcast(entry.sessionId, {
        type: "error",
        text,
      });
    }
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
