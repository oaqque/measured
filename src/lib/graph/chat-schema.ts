import type { GraphChatTurnResult, GraphClusterMode, GraphOp } from "@/lib/graph/schema";
import { GRAPH_CLUSTER_MODES } from "@/lib/graph/schema";

export function parseGraphChatTurnResult(raw: string): GraphChatTurnResult | null {
  const candidate = stripMarkdownFences(raw).trim();
  if (candidate.length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isGraphChatTurnResult(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isGraphChatTurnResult(value: unknown): value is GraphChatTurnResult {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.assistantText !== "string" || typeof value.needsConfirmation !== "boolean") {
    return false;
  }

  if (!Array.isArray(value.ops) || !value.ops.every(isGraphOp)) {
    return false;
  }

  return true;
}

export function stripMarkdownFences(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```(?:json)?\s*/u, "")
    .replace(/\s*```$/u, "");
}

function isGraphOp(value: unknown): value is GraphOp {
  if (!isRecord(value) || typeof value.op !== "string") {
    return false;
  }

  if (value.op === "createLink") {
    return typeof value.sourceSlug === "string" && typeof value.targetSlug === "string" && typeof value.kind === "string";
  }

  if (value.op === "removeLink") {
    return (
      typeof value.linkId === "string" ||
      (typeof value.sourceSlug === "string" && typeof value.targetSlug === "string")
    );
  }

  if (value.op === "focusNode") {
    return typeof value.slug === "string";
  }

  if (value.op === "setClusterMode") {
    return isGraphClusterMode(value.mode);
  }

  return value.op === "fitView";
}

function isGraphClusterMode(value: unknown): value is GraphClusterMode {
  return typeof value === "string" && GRAPH_CLUSTER_MODES.includes(value as GraphClusterMode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
