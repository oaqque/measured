export type GraphChatEntryKind = "user" | "assistant" | "reasoning" | "plan" | "tool" | "system";

export interface GraphChatEntry {
  id: string;
  kind: GraphChatEntryKind;
  title: string;
  body: string;
  details: string[];
  itemType: string;
  output: string | null;
  raw: string | null;
  source: "local" | "appServer";
  status: string | null;
}

export interface GraphChatRpcEvent {
  method: string;
  params: Record<string, unknown>;
  requestId?: number | null;
}

export function appendLocalUserMessage(entries: GraphChatEntry[], text: string) {
  const nextEntry: GraphChatEntry = {
    id: `local-user:${entries.length}:${text.length}`,
    kind: "user",
    title: "You",
    body: text,
    details: [],
    itemType: "userMessage",
    output: null,
    raw: null,
    source: "local",
    status: "submitted",
  };

  return [
    ...entries,
    nextEntry,
  ];
}

export function appendSystemMessage(entries: GraphChatEntry[], title: string, body: string, status: string | null = null) {
  return upsertEntry(entries, {
    id: `system:${title}:${entries.length}`,
    kind: "system",
    title,
    body,
    details: [],
    itemType: "system",
    output: null,
    raw: null,
    source: "local",
    status,
  });
}

export function applyGraphChatRpcEvent(entries: GraphChatEntry[], event: GraphChatRpcEvent) {
  switch (event.method) {
    case "item/started":
      return upsertItemEntry(entries, event.params.item, "in_progress");
    case "item/completed":
      return upsertItemEntry(entries, event.params.item, "completed");
    case "item/agentMessage/delta":
      return appendTextDelta(entries, event.params, "assistant", "agentMessage", "Codex");
    case "item/plan/delta":
      return appendTextDelta(entries, event.params, "plan", "plan", "Plan");
    case "item/reasoning/textDelta":
    case "item/reasoning/summaryTextDelta":
      return appendTextDelta(entries, event.params, "reasoning", "reasoning", "Reasoning");
    case "item/reasoning/summaryPartAdded":
      return appendReasoningSeparator(entries, event.params);
    case "item/commandExecution/outputDelta":
      return appendCommandOutput(entries, event.params);
    case "turn/plan/updated":
      return upsertSyntheticEntry(entries, `turn-plan:${getTurnId(event.params) ?? entries.length}`, {
        kind: "plan",
        title: "Plan",
        body: formatTurnPlan(event.params.plan),
        details: [],
        itemType: "turnPlan",
        output: null,
        raw: stringify(event.params.plan),
        source: "appServer",
        status: null,
      });
    case "thread/tokenUsage/updated":
      return upsertSyntheticEntry(entries, `token-usage:${getThreadId(event.params) ?? entries.length}`, {
        kind: "system",
        title: "Token usage",
        body: formatTokenUsage(event.params),
        details: [],
        itemType: "tokenUsage",
        output: null,
        raw: stringify(event.params),
        source: "appServer",
        status: null,
      });
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
    case "item/tool/requestUserInput":
    case "item/tool/call":
      return upsertRequestEntry(entries, event);
    case "serverRequest/resolved":
      return resolveRequestEntry(entries, event);
    case "turn/completed":
      return appendTurnCompletion(entries, event.params);
    case "turn/started":
      return entries;
    case "error":
      return upsertSyntheticEntry(entries, `error:${entries.length}`, {
        kind: "system",
        title: "Backend error",
        body: extractErrorMessage(event.params),
        details: [],
        itemType: "error",
        output: null,
        raw: stringify(event.params),
        source: "appServer",
        status: "failed",
      });
    default:
      return upsertSyntheticEntry(entries, createFallbackId(event), {
        kind: "system",
        title: event.method,
        body: "Unhandled Codex app-server event.",
        details: [],
        itemType: "rpcEvent",
        output: null,
        raw: stringify(event.params),
        source: "appServer",
        status: null,
      });
  }
}

function upsertItemEntry(entries: GraphChatEntry[], item: unknown, status: string) {
  const next = createEntryFromItem(item, status);
  if (!next) {
    return entries;
  }

  if (next.itemType === "userMessage" && next.body.length > 0) {
    const localIndex = findLastMatchingLocalUser(entries, next.body);
    if (localIndex !== -1) {
      const nextEntries = [...entries];
      nextEntries[localIndex] = {
        ...nextEntries[localIndex],
        id: next.id,
        details: next.details,
        raw: next.raw,
        source: "appServer",
        status,
      };
      return nextEntries;
    }
  }

  return upsertEntry(entries, next);
}

function appendTextDelta(
  entries: GraphChatEntry[],
  params: Record<string, unknown>,
  kind: GraphChatEntryKind,
  itemType: string,
  title: string,
) {
  const itemId = getItemId(params);
  const delta = getDeltaText(params);
  if (!itemId || !delta) {
    return entries;
  }

  return upsertEntry(entries, {
    id: itemId,
    kind,
    title,
    body: delta,
    details: [],
    itemType,
    output: null,
    raw: null,
    source: "appServer",
    status: "in_progress",
  }, (current) => ({
    ...current,
    body: `${current.body}${delta}`,
    status: "in_progress",
  }));
}

function appendReasoningSeparator(entries: GraphChatEntry[], params: Record<string, unknown>) {
  const itemId = getItemId(params);
  if (!itemId) {
    return entries;
  }

  return upsertEntry(entries, {
    id: itemId,
    kind: "reasoning",
    title: "Reasoning",
    body: "",
    details: [],
    itemType: "reasoning",
    output: null,
    raw: null,
    source: "appServer",
    status: "in_progress",
  }, (current) => ({
    ...current,
    body: current.body.endsWith("\n\n") || current.body.length === 0 ? current.body : `${current.body}\n\n`,
  }));
}

function appendCommandOutput(entries: GraphChatEntry[], params: Record<string, unknown>) {
  const itemId = getItemId(params);
  const delta = getDeltaText(params);
  if (!itemId || !delta) {
    return entries;
  }

  return upsertEntry(entries, {
    id: itemId,
    kind: "tool",
    title: "Command",
    body: "",
    details: [],
    itemType: "commandExecution",
    output: delta,
    raw: null,
    source: "appServer",
    status: "in_progress",
  }, (current) => ({
    ...current,
    output: `${current.output ?? ""}${delta}`,
    status: "in_progress",
  }));
}

function upsertRequestEntry(entries: GraphChatEntry[], event: GraphChatRpcEvent) {
  const requestId = typeof event.requestId === "number" ? event.requestId : null;
  const id = requestId === null ? createFallbackId(event) : `request:${requestId}`;
  return upsertSyntheticEntry(entries, id, {
    kind: "tool",
    title: formatRequestTitle(event.method),
    body: summarizeRequest(event.params),
    details: [],
    itemType: "request",
    output: null,
    raw: stringify(event.params),
    source: "appServer",
    status: "pending",
  });
}

function resolveRequestEntry(entries: GraphChatEntry[], event: GraphChatRpcEvent) {
  const requestId = typeof event.params.requestId === "number" ? event.params.requestId : event.requestId ?? null;
  if (requestId === null) {
    return entries;
  }

  return upsertSyntheticEntry(entries, `request:${requestId}`, {
    kind: "tool",
    title: "Server request resolved",
    body: summarizeRequest(event.params),
    details: [],
    itemType: "request",
    output: null,
    raw: stringify(event.params),
    source: "appServer",
    status: "completed",
  }, (current) => ({
    ...current,
    status: "completed",
    raw: stringify(event.params),
  }));
}

function appendTurnCompletion(entries: GraphChatEntry[], params: Record<string, unknown>) {
  const turn = asRecord(params.turn);
  if (!turn) {
    return entries;
  }

  const status = typeof turn.status === "string" ? turn.status : null;
  if (!status || status === "completed") {
    return entries;
  }

  return upsertSyntheticEntry(entries, `turn:${getTurnId(params) ?? entries.length}:completed`, {
    kind: "system",
    title: "Turn finished",
    body: extractErrorMessage(turn) || `Turn status: ${status}`,
    details: [],
    itemType: "turn",
    output: null,
    raw: stringify(turn),
    source: "appServer",
    status,
  });
}

function createEntryFromItem(item: unknown, status: string): GraphChatEntry | null {
  const record = asRecord(item);
  if (!record || typeof record.id !== "string" || typeof record.type !== "string") {
    return null;
  }

  const base = {
    id: record.id,
    source: "appServer" as const,
    status,
  };

  switch (record.type) {
    case "userMessage":
      return {
        ...base,
        kind: "user",
        title: "You",
        body: extractMessageText(record.content),
        details: [],
        itemType: record.type,
        output: null,
        raw: stringify(record),
      };
    case "agentMessage":
      return {
        ...base,
        kind: "assistant",
        title: "Codex",
        body: extractMessageText(record.content),
        details: compact([
          typeof record.phase === "string" ? `phase: ${record.phase}` : null,
        ]),
        itemType: record.type,
        output: null,
        raw: stringify(record),
      };
    case "plan":
      return {
        ...base,
        kind: "plan",
        title: "Plan",
        body: typeof record.text === "string" ? record.text : stringify(record.steps) ?? "",
        details: [],
        itemType: record.type,
        output: null,
        raw: stringify(record),
      };
    case "reasoning":
      return {
        ...base,
        kind: "reasoning",
        title: "Reasoning",
        body: typeof record.text === "string" ? record.text : "",
        details: [],
        itemType: record.type,
        output: null,
        raw: stringify(record),
      };
    case "commandExecution":
      return {
        ...base,
        kind: "tool",
        title: formatCommandTitle(record),
        body: "",
        details: compact([
          typeof record.cwd === "string" ? record.cwd : null,
          typeof record.exitCode === "number" ? `exit ${record.exitCode}` : null,
        ]),
        itemType: record.type,
        output: typeof record.output === "string" ? record.output : null,
        raw: stringify(record),
      };
    case "mcpToolCall":
    case "dynamicToolCall":
    case "toolCall":
    case "collabToolCall":
      return {
        ...base,
        kind: "tool",
        title: formatToolTitle(record),
        body: formatToolBody(record),
        details: [],
        itemType: record.type,
        output: null,
        raw: stringify(record),
      };
    case "fileChange":
      return {
        ...base,
        kind: "tool",
        title: "File changes",
        body: formatFileChange(record),
        details: [],
        itemType: record.type,
        output: null,
        raw: stringify(record),
      };
    case "webSearch":
      return {
        ...base,
        kind: "tool",
        title: "Web search",
        body: typeof record.query === "string" ? record.query : stringify(record) ?? "",
        details: [],
        itemType: record.type,
        output: null,
        raw: stringify(record),
      };
    case "imageView":
      return {
        ...base,
        kind: "tool",
        title: "Image view",
        body: compact([typeof record.path === "string" ? record.path : null]).join("\n"),
        details: [],
        itemType: record.type,
        output: null,
        raw: stringify(record),
      };
    case "enteredReviewMode":
    case "exitedReviewMode":
    case "contextCompaction":
      return {
        ...base,
        kind: "system",
        title: prettifyItemType(record.type),
        body: "",
        details: [],
        itemType: record.type,
        output: null,
        raw: stringify(record),
      };
    default:
      return {
        ...base,
        kind: "system",
        title: prettifyItemType(record.type),
        body: "",
        details: [],
        itemType: record.type,
        output: null,
        raw: stringify(record),
      };
  }
}

function upsertSyntheticEntry(
  entries: GraphChatEntry[],
  id: string,
  entry: Omit<GraphChatEntry, "id">,
  merge?: (current: GraphChatEntry) => GraphChatEntry,
) {
  return upsertEntry(entries, { id, ...entry }, merge);
}

function upsertEntry(entries: GraphChatEntry[], next: GraphChatEntry, merge?: (current: GraphChatEntry) => GraphChatEntry) {
  const index = entries.findIndex((entry) => entry.id === next.id);
  if (index === -1) {
    return [...entries, next];
  }

  const nextEntries = [...entries];
  nextEntries[index] = merge ? merge(nextEntries[index]) : { ...nextEntries[index], ...next };
  return nextEntries;
}

function getItemId(params: Record<string, unknown>) {
  if (typeof params.itemId === "string") {
    return params.itemId;
  }

  const item = asRecord(params.item);
  return item && typeof item.id === "string" ? item.id : null;
}

function getDeltaText(params: Record<string, unknown>) {
  const candidates = [params.delta, params.text, params.outputDelta];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

function extractMessageText(content: unknown) {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      const record = asRecord(part);
      if (!record) {
        return null;
      }

      if (typeof record.text === "string") {
        return record.text;
      }

      if (typeof record.type === "string") {
        return `[${record.type}]`;
      }

      return null;
    })
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n");
}

function formatCommandTitle(record: Record<string, unknown>) {
  if (Array.isArray(record.command)) {
    const command = record.command.filter((value): value is string => typeof value === "string");
    if (command.length > 0) {
      return command.join(" ");
    }
  }

  return "Command";
}

function formatToolTitle(record: Record<string, unknown>) {
  const pieces = compact([
    typeof record.server === "string" ? record.server : null,
    typeof record.tool === "string" ? record.tool : typeof record.name === "string" ? record.name : null,
  ]);

  return pieces.length > 0 ? pieces.join(" / ") : prettifyItemType(String(record.type ?? "tool"));
}

function formatToolBody(record: Record<string, unknown>) {
  return compact([
    typeof record.arguments === "string" ? record.arguments : null,
    typeof record.result === "string" ? record.result : null,
    extractErrorMessage(record),
  ]).join("\n\n");
}

function formatFileChange(record: Record<string, unknown>) {
  const changes = Array.isArray(record.changes) ? record.changes : [];
  const files = changes
    .map((change) => {
      const next = asRecord(change);
      return next && typeof next.path === "string" ? next.path : null;
    })
    .filter((value): value is string => typeof value === "string");
  return files.join("\n");
}

function formatTurnPlan(plan: unknown) {
  if (!Array.isArray(plan)) {
    return "";
  }

  return plan
    .map((step) => {
      const record = asRecord(step);
      if (!record) {
        return null;
      }

      const parts = compact([
        typeof record.status === "string" ? `[${record.status}]` : null,
        typeof record.title === "string" ? record.title : typeof record.step === "string" ? record.step : null,
      ]);
      return parts.join(" ");
    })
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");
}

function formatTokenUsage(params: Record<string, unknown>) {
  const usage = asRecord(params.usage) ?? params;
  const record = asRecord(usage);
  if (!record) {
    return "";
  }

  return compact([
    typeof record.inputTokens === "number" ? `input ${record.inputTokens}` : null,
    typeof record.outputTokens === "number" ? `output ${record.outputTokens}` : null,
    typeof record.totalTokens === "number" ? `total ${record.totalTokens}` : null,
  ]).join(" · ");
}

function extractErrorMessage(value: unknown) {
  const record = asRecord(value);
  if (!record) {
    return "";
  }

  const error = asRecord(record.error);
  if (error && typeof error.message === "string") {
    return error.message;
  }

  return typeof record.message === "string" ? record.message : "";
}

function summarizeRequest(params: Record<string, unknown>) {
  return compact([
    typeof params.command === "string" ? params.command : null,
    typeof params.prompt === "string" ? params.prompt : null,
    typeof params.question === "string" ? params.question : null,
  ]).join("\n") || "Server request";
}

function formatRequestTitle(method: string) {
  const suffix = method.split("/").at(-1) ?? method;
  return prettifyItemType(suffix);
}

function createFallbackId(event: GraphChatRpcEvent) {
  return [
    "rpc",
    event.method,
    getItemId(event.params) ?? getTurnId(event.params) ?? getThreadId(event.params) ?? event.requestId ?? "event",
  ].join(":");
}

function findLastMatchingLocalUser(entries: GraphChatEntry[], text: string) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.source === "local" && entry.kind === "user" && entry.body === text) {
      return index;
    }
  }

  return -1;
}

function getTurnId(params: Record<string, unknown>) {
  if (typeof params.turnId === "string") {
    return params.turnId;
  }

  const turn = asRecord(params.turn);
  return turn && typeof turn.id === "string" ? turn.id : null;
}

function getThreadId(params: Record<string, unknown>) {
  return typeof params.threadId === "string" ? params.threadId : null;
}

function stringify(value: unknown) {
  if (value == null) {
    return null;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function prettifyItemType(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[/-]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function compact(values: Array<string | null>) {
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
