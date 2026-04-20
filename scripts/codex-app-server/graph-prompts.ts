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
          type: "object",
        },
      },
    },
  };
}
