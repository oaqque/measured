import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGraphDocumentNodeId,
  createGraphFolderNodeId,
  normalizeGraphHref,
  workoutHrefToSlug,
} from "../src/lib/graph/ids";
import { formatGraphFolderLabel } from "../src/lib/graph/labels";
import type {
  AuthoredGraphLinksDocument,
  GraphLinkKind,
  GraphNodeCategory,
  GraphNodeKind,
  GraphNodeStatus,
  NoteGraphCluster,
  NoteGraphData,
  NoteGraphLink,
  NoteGraphNode,
} from "../src/lib/graph/schema";
import { NOTE_GRAPH_SCHEMA_VERSION } from "../src/lib/graph/schema";
import type { ChangelogEntry, GoalNote, PlanDocument, WorkoutNote } from "../src/lib/workouts/schema";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const generatedWorkoutsPath = path.resolve(rootDir, "src/generated/workouts.json");
const graphLinksPath = path.resolve(rootDir, "data/training/graph-links.json");
const generatedGraphPath = path.resolve(rootDir, "src/generated/note-graph.json");
const DAY_MS = 1000 * 60 * 60 * 24;

interface WorkoutsPayload {
  generatedAt: string;
  welcome: PlanDocument;
  goals: PlanDocument;
  heartRate: PlanDocument;
  morningMobility: PlanDocument;
  goalNotes: GoalNote[];
  plan: PlanDocument;
  changelog: ChangelogEntry[];
  workouts: WorkoutNote[];
}

interface GraphSourceNode {
  id: string;
  slug: string | null;
  nodeKind: GraphNodeKind;
  title: string;
  date: string | null;
  category: GraphNodeCategory;
  status: GraphNodeStatus;
  sourcePath: string | null;
  body: string;
  radius: number;
  metrics: {
    expectedDistanceKm: number | null;
    actualDistanceKm: number | null;
  };
}

interface FolderDescriptor {
  depth: number;
  id: string;
  path: string;
  title: string;
}

async function main() {
  const workoutsPayload = JSON.parse(await fs.readFile(generatedWorkoutsPath, "utf8")) as WorkoutsPayload;
  const authoredLinks = JSON.parse(await fs.readFile(graphLinksPath, "utf8")) as AuthoredGraphLinksDocument;
  validateAuthoredLinksDocument(authoredLinks);

  const sources = buildGraphSources(workoutsPayload);
  const folders = buildFolderDescriptors(sources);
  const nodes = buildNodes(sources, folders);
  const links = buildLinks(nodes, sources, folders, authoredLinks);
  const clusters = buildClusters(nodes);

  const payload: NoteGraphData = {
    schemaVersion: NOTE_GRAPH_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    nodes,
    links,
    clusters,
  };

  await fs.mkdir(path.dirname(generatedGraphPath), { recursive: true });
  await fs.writeFile(generatedGraphPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Generated note graph with ${payload.nodes.length} nodes and ${payload.links.length} links at ${generatedGraphPath}`);
}

function buildGraphSources(payload: WorkoutsPayload): GraphSourceNode[] {
  const sources: GraphSourceNode[] = [];

  const pushDocument = (
    title: string,
    body: string,
    sourcePath: string,
    category: GraphNodeCategory,
    date: string | null = null,
  ) => {
    sources.push({
      id: createGraphDocumentNodeId(sourcePath),
      slug: null,
      nodeKind: "document",
      title,
      date,
      category,
      status: "reference",
      sourcePath,
      body,
      radius: getDocumentRadius(category),
      metrics: {
        expectedDistanceKm: null,
        actualDistanceKm: null,
      },
    });
  };

  pushDocument(payload.welcome.title, payload.welcome.body, payload.welcome.sourcePath, "welcome");
  pushDocument(payload.goals.title, payload.goals.body, payload.goals.sourcePath, "goals");
  pushDocument(payload.heartRate.title, payload.heartRate.body, payload.heartRate.sourcePath, "metaanalysis");
  pushDocument(payload.morningMobility.title, payload.morningMobility.body, payload.morningMobility.sourcePath, "metaanalysis");
  pushDocument(payload.plan.title, payload.plan.body, payload.plan.sourcePath, "plan");

  for (const goal of payload.goalNotes) {
    pushDocument(goal.title, goal.body, goal.sourcePath, "goal", goal.date);
  }

  for (const entry of payload.changelog) {
    pushDocument(entry.title, entry.body, entry.sourcePath, "changelog", entry.date);
  }

  for (const workout of payload.workouts) {
    sources.push({
      id: workout.slug,
      slug: workout.slug,
      nodeKind: "workout",
      title: workout.title,
      date: workout.date,
      category: workout.eventType,
      status: workout.completed ? "completed" : "planned",
      sourcePath: workout.sourcePath,
      body: workout.body,
      radius: getWorkoutRadius(workout),
      metrics: {
        expectedDistanceKm: workout.expectedDistanceKm ?? null,
        actualDistanceKm: workout.actualDistanceKm ?? null,
      },
    });
  }

  return sources.sort((left, right) => {
    const leftDate = left.date ?? "9999-12-31";
    const rightDate = right.date ?? "9999-12-31";
    return leftDate === rightDate ? left.id.localeCompare(right.id) : leftDate.localeCompare(rightDate);
  });
}

function buildFolderDescriptors(sources: GraphSourceNode[]) {
  const folders = new Map<string, FolderDescriptor>();

  for (const source of sources) {
    if (!source.sourcePath || !source.sourcePath.includes("/")) {
      continue;
    }

    const parts = source.sourcePath.split("/");
    for (let index = 0; index < parts.length - 1; index += 1) {
      const folderPath = parts.slice(0, index + 1).join("/");
      if (folders.has(folderPath)) {
        continue;
      }

      folders.set(folderPath, {
        depth: index,
        id: createGraphFolderNodeId(folderPath),
        path: folderPath,
        title: formatGraphFolderLabel(folderPath),
      });
    }
  }

  return Array.from(folders.values()).sort((left, right) => left.path.localeCompare(right.path));
}

function buildNodes(sources: GraphSourceNode[], folders: FolderDescriptor[]): NoteGraphNode[] {
  const datedSources = sources.filter((source) => source.nodeKind === "workout" && source.date);
  const earliestDate = datedSources[0]?.date ?? "2026-01-01";
  const earliestDateMs = parseDateKey(earliestDate).getTime();

  const sourceNodes = sources.map((source, index) => {
    const seed = hashString(source.id);
    const angle = (seed % 360) * (Math.PI / 180);
    const distance = 180 + (seed % 320);

    return {
      id: source.id,
      slug: source.slug,
      nodeKind: source.nodeKind,
      title: source.title,
      date: source.date,
      category: source.category,
      status: source.status,
      sourcePath: source.sourcePath,
      excerpt: stripMarkdown(source.body).slice(0, 180).trim() || null,
      radius: source.radius,
      x: Math.cos(angle) * distance + Math.sin(index) * 12,
      y: Math.sin(angle) * distance + Math.cos(index) * 12,
      clusters: buildClustersForSource(source, earliestDateMs),
      metrics: source.metrics,
    } satisfies NoteGraphNode;
  });

  const folderNodes = folders.map((folder, index) => {
    const seed = hashString(folder.id);
    const angle = (seed % 360) * (Math.PI / 180);
    const distance = 120 + folder.depth * 56 + (seed % 90);

    return {
      id: folder.id,
      slug: null,
      nodeKind: "folder",
      title: folder.title,
      date: null,
      category: "folder",
      status: "folder",
      sourcePath: folder.path,
      excerpt: null,
      radius: 18 + Math.max(0, 4 - folder.depth),
      x: Math.cos(angle) * distance + Math.sin(index) * 10,
      y: Math.sin(angle) * distance + Math.cos(index) * 10,
      clusters: {
        eventType: "folder",
        month: "structure",
        status: "folder",
        trainingBlock: folder.path,
      },
      metrics: {
        expectedDistanceKm: null,
        actualDistanceKm: null,
      },
    } satisfies NoteGraphNode;
  });

  return [...folderNodes, ...sourceNodes];
}

function buildClustersForSource(source: GraphSourceNode, earliestDateMs: number) {
  if (source.nodeKind === "workout" && source.date) {
    const clusterMonth = source.date.slice(0, 7);
    const trainingBlockIndex = Math.floor((parseDateKey(source.date).getTime() - earliestDateMs) / (14 * DAY_MS));
    const trainingBlockStart = formatDate(addDays(parseDateKey(formatDate(new Date(earliestDateMs))), trainingBlockIndex * 14));
    const trainingBlockEnd = formatDate(addDays(parseDateKey(trainingBlockStart), 13));
    return {
      eventType: source.category,
      month: clusterMonth,
      status: source.status,
      trainingBlock: `${trainingBlockStart} to ${trainingBlockEnd}`,
    };
  }

  return {
    eventType: source.category,
    month: source.date ? source.date.slice(0, 7) : "undated",
    status: source.status,
    trainingBlock: source.date ? "reference-dated" : "reference-undated",
  };
}

function buildLinks(
  nodes: NoteGraphNode[],
  sources: GraphSourceNode[],
  folders: FolderDescriptor[],
  authoredLinks: AuthoredGraphLinksDocument,
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = new Map<string, NoteGraphLink>();
  const sourcePathToNodeId = new Map(
    sources
      .filter((source) => source.sourcePath !== null)
      .map((source) => [source.sourcePath as string, source.id]),
  );
  const folderSet = new Set(folders.map((folder) => folder.path));
  const hrefTargetByPath = buildHrefTargetMap(sourcePathToNodeId);

  for (const folder of folders) {
    const parentPath = getParentFolderPath(folder.path);
    if (parentPath && folderSet.has(parentPath)) {
      upsertLink(links, {
        id: createLinkId(createGraphFolderNodeId(parentPath), folder.id, "contains"),
        source: createGraphFolderNodeId(parentPath),
        target: folder.id,
        kind: "contains",
        strength: 0.82,
        label: "folder contains folder",
        sourceType: "derived",
      });
    }
  }

  for (const source of sources) {
    if (!source.sourcePath || !source.sourcePath.includes("/")) {
      continue;
    }

    const folderPath = source.sourcePath.split("/").slice(0, -1).join("/");
    if (!folderSet.has(folderPath)) {
      continue;
    }

    upsertLink(links, {
      id: createLinkId(createGraphFolderNodeId(folderPath), source.id, "contains"),
      source: createGraphFolderNodeId(folderPath),
      target: source.id,
      kind: "contains",
      strength: 0.72,
      label: "folder contains note",
      sourceType: "derived",
    });
  }

  for (const source of sources) {
    for (const href of extractMarkdownHrefs(source.body)) {
      const targetId = resolveGraphHrefToNodeId(href, hrefTargetByPath);
      if (!targetId || targetId === source.id) {
        continue;
      }

      upsertLink(links, {
        id: createLinkId(source.id, targetId, "references"),
        source: source.id,
        target: targetId,
        kind: "references",
        strength: 0.54,
        label: "linked in note body",
        sourceType: "derived",
      });
    }
  }

  for (const authoredLink of authoredLinks.links) {
    if (!nodeIds.has(authoredLink.sourceSlug) || !nodeIds.has(authoredLink.targetSlug)) {
      throw new Error(`Graph link references unknown node: ${authoredLink.sourceSlug} -> ${authoredLink.targetSlug}`);
    }

    upsertLink(links, {
      id: createLinkId(authoredLink.sourceSlug, authoredLink.targetSlug, authoredLink.kind),
      source: authoredLink.sourceSlug,
      target: authoredLink.targetSlug,
      kind: authoredLink.kind,
      strength: clampStrength(authoredLink.weight ?? 0.9),
      label: authoredLink.label ?? null,
      sourceType: "authored",
    });
  }

  return Array.from(links.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function buildHrefTargetMap(sourcePathToNodeId: Map<string, string>) {
  const hrefTargetByPath = new Map<string, string>();

  for (const [sourcePath, nodeId] of sourcePathToNodeId) {
    hrefTargetByPath.set(sourcePath, nodeId);
  }

  if (sourcePathToNodeId.has("metaanalysis/HEART_RATE.md")) {
    hrefTargetByPath.set("HEART_RATE.md", sourcePathToNodeId.get("metaanalysis/HEART_RATE.md") as string);
  }

  if (sourcePathToNodeId.has("metaanalysis/MORNING_MOBILITY.md")) {
    hrefTargetByPath.set(
      "MORNING_MOBILITY.md",
      sourcePathToNodeId.get("metaanalysis/MORNING_MOBILITY.md") as string,
    );
  }

  return hrefTargetByPath;
}

function resolveGraphHrefToNodeId(href: string, hrefTargetByPath: Map<string, string>) {
  const normalizedHref = normalizeGraphHref(href);
  const workoutSlug = workoutHrefToSlug(normalizedHref);
  if (workoutSlug) {
    return workoutSlug;
  }

  return hrefTargetByPath.get(normalizedHref) ?? null;
}

function extractMarkdownHrefs(markdown: string) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)].map((match) => match[1]);
}

function buildClusters(nodes: NoteGraphNode[]): NoteGraphCluster[] {
  const clusters = new Map<string, NoteGraphCluster>();

  for (const node of nodes) {
    addClusterNode(clusters, "eventType", node.clusters.eventType, formatCategoryLabel(node.clusters.eventType), node.id);
    addClusterNode(clusters, "status", node.clusters.status, formatStatusLabel(node.clusters.status), node.id);
    addClusterNode(clusters, "month", node.clusters.month, formatMonthLabel(node.clusters.month), node.id);
    addClusterNode(clusters, "trainingBlock", node.clusters.trainingBlock, formatTrainingBlockLabel(node.clusters.trainingBlock), node.id);
  }

  return Array.from(clusters.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function addClusterNode(
  clusters: Map<string, NoteGraphCluster>,
  mode: NoteGraphCluster["mode"],
  key: string,
  label: string,
  nodeId: string,
) {
  const clusterId = `${mode}:${key}`;
  const existing = clusters.get(clusterId);
  if (existing) {
    existing.nodeIds.push(nodeId);
    return;
  }

  clusters.set(clusterId, {
    id: clusterId,
    mode,
    key,
    label,
    nodeIds: [nodeId],
  });
}

function getWorkoutRadius(workout: WorkoutNote) {
  if (workout.eventType === "race") {
    return 20;
  }

  if (workout.eventType === "run") {
    return 16;
  }

  if (workout.eventType === "basketball") {
    return 15;
  }

  return 14;
}

function getDocumentRadius(category: GraphNodeCategory) {
  if (category === "metaanalysis") {
    return 18;
  }

  if (category === "plan" || category === "goals") {
    return 17;
  }

  return 15;
}

function formatCategoryLabel(value: string) {
  if (value === "metaanalysis") {
    return "Metaanalysis";
  }

  if (value === "goals") {
    return "Goals";
  }

  return titleCase(value);
}

function formatStatusLabel(value: string) {
  if (value === "reference") {
    return "Reference";
  }

  if (value === "folder") {
    return "Folder";
  }

  return titleCase(value);
}

function formatMonthLabel(monthKey: string) {
  if (monthKey === "undated") {
    return "Undated";
  }

  if (monthKey === "structure") {
    return "Structure";
  }

  const [year, month] = monthKey.split("-").map((value) => Number(value));
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatTrainingBlockLabel(value: string) {
  if (value === "reference-dated") {
    return "Reference";
  }

  if (value === "reference-undated") {
    return "Undated reference";
  }

  if (value.includes("/")) {
    return formatGraphFolderLabel(value);
  }

  if (value === "notes" || value === "goals" || value === "metaanalysis" || value === "changelog") {
    return formatGraphFolderLabel(value);
  }

  return value;
}

function validateAuthoredLinksDocument(document: AuthoredGraphLinksDocument) {
  if (document.schemaVersion !== NOTE_GRAPH_SCHEMA_VERSION) {
    throw new Error(`Unsupported graph-links schema version: ${document.schemaVersion}`);
  }

  if (!Array.isArray(document.links)) {
    throw new Error("graph-links.json must contain a links array");
  }
}

function upsertLink(links: Map<string, NoteGraphLink>, link: NoteGraphLink) {
  links.set(link.id, link);
}

function createLinkId(sourceSlug: string, targetSlug: string, kind: GraphLinkKind | string) {
  const [source, target] = [sourceSlug, targetSlug].sort((left, right) => left.localeCompare(right));
  return `${kind}:${source}:${target}`;
}

function clampStrength(value: number) {
  return Math.max(0.1, Math.min(1.4, value));
}

function getParentFolderPath(folderPath: string) {
  const parts = folderPath.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : null;
}

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`]+)`/gu, "$1")
    .replace(/!\[[^\]]*\]\([^)]+\)/gu, " ")
    .replace(/\[[^\]]+\]\([^)]+\)/gu, " ")
    .replace(/^#+\s+/gmu, "")
    .replace(/[*_>-]/gu, " ")
    .replace(/\s+/gu, " ");
}

function titleCase(value: string) {
  return value
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

function hashString(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

await main();
