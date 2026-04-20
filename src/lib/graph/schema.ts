import type { WorkoutEventType } from "@/lib/workouts/schema";

export const NOTE_GRAPH_SCHEMA_VERSION = 1 as const;
export const GRAPH_CLUSTER_MODES = ["none", "eventType", "status", "month", "trainingBlock"] as const;
export const GRAPH_NODE_STATUSES = ["planned", "completed"] as const;
export const GRAPH_LINK_SOURCES = ["authored", "derived"] as const;
export const GRAPH_LINK_KINDS = [
  "progression",
  "taper",
  "goalBridge",
  "adjacent",
  "sameDay",
  "derived",
  "custom",
] as const;

export type GraphClusterMode = (typeof GRAPH_CLUSTER_MODES)[number];
export type GraphNodeStatus = (typeof GRAPH_NODE_STATUSES)[number];
export type GraphLinkSource = (typeof GRAPH_LINK_SOURCES)[number];
export type GraphLinkKind = (typeof GRAPH_LINK_KINDS)[number];

export interface AuthoredGraphLink {
  sourceSlug: string;
  targetSlug: string;
  kind: GraphLinkKind | string;
  weight?: number;
  label?: string | null;
}

export interface AuthoredGraphLinksDocument {
  schemaVersion: typeof NOTE_GRAPH_SCHEMA_VERSION;
  links: AuthoredGraphLink[];
}

export interface NoteGraphNodeClusterRefs {
  eventType: string;
  month: string;
  status: GraphNodeStatus;
  trainingBlock: string;
}

export interface NoteGraphNode {
  id: string;
  slug: string;
  title: string;
  date: string;
  eventType: WorkoutEventType;
  status: GraphNodeStatus;
  sourcePath: string;
  excerpt: string | null;
  radius: number;
  x: number;
  y: number;
  clusters: NoteGraphNodeClusterRefs;
  metrics: {
    expectedDistanceKm: number | null;
    actualDistanceKm: number | null;
  };
}

export interface NoteGraphLink {
  id: string;
  source: string;
  target: string;
  kind: GraphLinkKind | string;
  strength: number;
  label: string | null;
  sourceType: GraphLinkSource;
}

export interface NoteGraphCluster {
  id: string;
  mode: Exclude<GraphClusterMode, "none">;
  key: string;
  label: string;
  nodeIds: string[];
}

export interface NoteGraphData {
  schemaVersion: typeof NOTE_GRAPH_SCHEMA_VERSION;
  generatedAt: string;
  nodes: NoteGraphNode[];
  links: NoteGraphLink[];
  clusters: NoteGraphCluster[];
}

export interface GraphViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface GraphSnapshot {
  viewport: GraphViewportState;
  hoveredNodeId: string | null;
  selectedNodeId: string | null;
  nodes: Array<{
    id: string;
    x: number;
    y: number;
    radius: number;
    label: string;
    eventType: WorkoutEventType;
    status: GraphNodeStatus;
  }>;
  links: Array<{
    id: string;
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
    kind: string;
    sourceType: GraphLinkSource;
  }>;
}

export type GraphOp =
  | {
      op: "createLink";
      sourceSlug: string;
      targetSlug: string;
      kind: GraphLinkKind | string;
      label?: string | null;
      strength?: number;
    }
  | {
      op: "removeLink";
      linkId?: string;
      sourceSlug?: string;
      targetSlug?: string;
      kind?: GraphLinkKind | string;
    }
  | {
      op: "focusNode";
      slug: string;
    }
  | {
      op: "setClusterMode";
      mode: GraphClusterMode;
    }
  | {
      op: "fitView";
    };

export interface GraphChatTurnResult {
  assistantText: string;
  ops: GraphOp[];
  needsConfirmation: boolean;
}

export interface GraphInteractionEvent {
  type: "hoverChanged" | "selectionChanged" | "viewportChanged" | "dragStateChanged";
  nodeId?: string | null;
  dragging?: boolean;
  viewport?: GraphViewportState;
}
