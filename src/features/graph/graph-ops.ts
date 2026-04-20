import type { GraphClusterMode, GraphOp, NoteGraphData, NoteGraphLink } from "@/lib/graph/schema";

export interface AppliedGraphOpsResult {
  data: NoteGraphData;
  focusSlug: string | null;
  clusterMode: GraphClusterMode | null;
  fitView: boolean;
}

export function applyGraphOps(data: NoteGraphData, ops: GraphOp[]): AppliedGraphOpsResult {
  let nextData = data;
  let focusSlug: string | null = null;
  let clusterMode: GraphClusterMode | null = null;
  let fitView = false;

  for (const op of ops) {
    if (op.op === "createLink") {
      nextData = {
        ...nextData,
        links: upsertGraphLink(nextData.links, {
          id: createGraphLinkId(op.sourceSlug, op.targetSlug, op.kind),
          source: op.sourceSlug,
          target: op.targetSlug,
          kind: op.kind,
          strength: clampStrength(op.strength ?? 0.9),
          label: op.label ?? null,
          sourceType: "authored",
        }),
      };
      continue;
    }

    if (op.op === "removeLink") {
      nextData = {
        ...nextData,
        links: nextData.links.filter((link) => !matchesRemoveOp(link, op)),
      };
      continue;
    }

    if (op.op === "focusNode") {
      focusSlug = op.slug;
      continue;
    }

    if (op.op === "setClusterMode") {
      clusterMode = op.mode;
      continue;
    }

    fitView = true;
  }

  return {
    data: nextData,
    focusSlug,
    clusterMode,
    fitView,
  };
}

export function getPersistentGraphOps(ops: GraphOp[]) {
  return ops.filter((op) => op.op === "createLink" || op.op === "removeLink");
}

export function createGraphLinkId(sourceSlug: string, targetSlug: string, kind: string) {
  const [source, target] = [sourceSlug, targetSlug].sort((left, right) => left.localeCompare(right));
  return `${kind}:${source}:${target}`;
}

function clampStrength(value: number) {
  return Math.max(0.1, Math.min(1.4, value));
}

function upsertGraphLink(links: NoteGraphLink[], nextLink: NoteGraphLink) {
  const existingIndex = links.findIndex((link) => link.id === nextLink.id);
  if (existingIndex === -1) {
    return [...links, nextLink];
  }

  const nextLinks = [...links];
  nextLinks[existingIndex] = nextLink;
  return nextLinks;
}

function matchesRemoveOp(link: NoteGraphLink, op: Extract<GraphOp, { op: "removeLink" }>) {
  if (op.linkId && link.id === op.linkId) {
    return true;
  }

  if (!op.sourceSlug || !op.targetSlug) {
    return false;
  }

  const expectedId = createGraphLinkId(op.sourceSlug, op.targetSlug, op.kind ?? link.kind);
  return link.id === expectedId;
}
