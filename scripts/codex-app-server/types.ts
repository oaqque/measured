export interface JsonRpcEnvelope {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: {
    message?: string;
  };
}

export interface CodexAccountReadResult {
  account?: {
    type: string;
    email?: string;
    planType?: string;
  };
  requiresOpenaiAuth?: boolean;
}

export interface ThreadStartResult {
  thread: {
    id: string;
    cwd: string;
  };
}

export interface TurnStartResult {
  turn: {
    id: string;
    status: string;
  };
}

export interface SessionEvent {
  type: "status" | "rpcEvent" | "error";
  scope?: "connection" | "session";
  text?: string;
  method?: string;
  params?: Record<string, unknown>;
  requestId?: number | null;
}
