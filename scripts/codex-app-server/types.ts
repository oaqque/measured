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

export interface GraphTurnContext {
  authoredLinkCount: number;
  clusterMode: string;
  linkCount: number;
  nodeCount: number;
  selectedNodeSlug: string | null;
}

export interface SessionEvent {
  type: "status" | "delta" | "turnResult" | "error";
  text?: string;
  payload?: string;
}
