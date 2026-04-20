import type { GraphTurnContext } from "./types";

export function buildGraphTurnInput(message: string, context: GraphTurnContext) {
  return [
    {
      type: "text",
      text: [
        "You are the graph copilot for the measured note graph.",
        "Only propose operations that target workout-note relationships already visible in the note graph.",
        "Return only JSON. Do not wrap it in markdown fences.",
        "",
        "Graph context:",
        `- cluster mode: ${context.clusterMode}`,
        `- visible nodes: ${context.nodeCount}`,
        `- visible links: ${context.linkCount}`,
        `- authored links: ${context.authoredLinkCount}`,
        `- selected node: ${context.selectedNodeSlug ?? "none"}`,
        "",
        "Allowed operations:",
        '- {"op":"createLink","sourceSlug":"...","targetSlug":"...","kind":"progression|taper|goalBridge|custom","label":"...","strength":0.1-1.4}',
        '- {"op":"removeLink","sourceSlug":"...","targetSlug":"...","kind":"..."}',
        '- {"op":"focusNode","slug":"..."}',
        '- {"op":"setClusterMode","mode":"none|eventType|status|month|trainingBlock"}',
        '- {"op":"fitView"}',
        "",
        "Set needsConfirmation=true for createLink/removeLink. Use false for pure focus or view operations.",
        "",
        `User request: ${message}`,
      ].join("\n"),
    },
  ];
}

export function buildGraphOutputSchema() {
  const createLinkOp = {
    type: "object",
    additionalProperties: false,
    required: ["op", "sourceSlug", "targetSlug", "kind"],
    properties: {
      op: {
        type: "string",
        enum: ["createLink"],
      },
      sourceSlug: {
        type: "string",
      },
      targetSlug: {
        type: "string",
      },
      kind: {
        type: "string",
      },
      label: {
        type: ["string", "null"],
      },
      strength: {
        type: "number",
      },
    },
  } as const;

  const removeLinkOp = {
    type: "object",
    additionalProperties: false,
    required: ["op"],
    properties: {
      op: {
        type: "string",
        enum: ["removeLink"],
      },
      linkId: {
        type: "string",
      },
      sourceSlug: {
        type: "string",
      },
      targetSlug: {
        type: "string",
      },
      kind: {
        type: "string",
      },
    },
  } as const;

  const focusNodeOp = {
    type: "object",
    additionalProperties: false,
    required: ["op", "slug"],
    properties: {
      op: {
        type: "string",
        enum: ["focusNode"],
      },
      slug: {
        type: "string",
      },
    },
  } as const;

  const setClusterModeOp = {
    type: "object",
    additionalProperties: false,
    required: ["op", "mode"],
    properties: {
      op: {
        type: "string",
        enum: ["setClusterMode"],
      },
      mode: {
        type: "string",
        enum: ["none", "eventType", "status", "month", "trainingBlock"],
      },
    },
  } as const;

  const fitViewOp = {
    type: "object",
    additionalProperties: false,
    required: ["op"],
    properties: {
      op: {
        type: "string",
        enum: ["fitView"],
      },
    },
  } as const;

  return {
    type: "object",
    additionalProperties: false,
    required: ["assistantText", "ops", "needsConfirmation"],
    properties: {
      assistantText: {
        type: "string",
      },
      needsConfirmation: {
        type: "boolean",
      },
      ops: {
        type: "array",
        items: {
          anyOf: [createLinkOp, removeLinkOp, focusNodeOp, setClusterModeOp, fitViewOp],
        },
      },
    },
  } as const;
}
