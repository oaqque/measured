import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AuthoredGraphLinksDocument,
  GraphLinkKind,
  GraphNodeStatus,
  NoteGraphCluster,
  NoteGraphData,
  NoteGraphLink,
  NoteGraphNode,
} from "../src/lib/graph/schema";
import { NOTE_GRAPH_SCHEMA_VERSION } from "../src/lib/graph/schema";
import type { WorkoutNote } from "../src/lib/workouts/schema";

const rootDir = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const generatedWorkoutsPath = path.resolve(rootDir, "src/generated/workouts.json");
const graphLinksPath = path.resolve(rootDir, "data/training/graph-links.json");
const generatedGraphPath = path.resolve(rootDir, "src/generated/note-graph.json");

interface WorkoutsPayload {
  generatedAt: string;
  workouts: WorkoutNote[];
}

async function main() {
  const workoutsPayload = JSON.parse(await fs.readFile(generatedWorkoutsPath, "utf8")) as WorkoutsPayload;
  const authoredLinks = JSON.parse(await fs.readFile(graphLinksPath, "utf8")) as AuthoredGraphLinksDocument;
  validateAuthoredLinksDocument(authoredLinks);

  const workouts = [...workoutsPayload.workouts].sort((left, right) =>
    left.date === right.date ? left.slug.localeCompare(right.slug) : left.date.localeCompare(right.date),
  );
  const nodes = buildNodes(workouts);
  const links = buildLinks(nodes, workouts, authoredLinks);
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

function buildNodes(workouts: WorkoutNote[]): NoteGraphNode[] {
  const earliestDate = workouts[0]?.date ?? "2026-01-01";
  const earliestDateMs = parseDateKey(earliestDate).getTime();

  return workouts.map((workout, index) => {
    const clusterMonth = workout.date.slice(0, 7);
    const trainingBlockIndex = Math.floor((parseDateKey(workout.date).getTime() - earliestDateMs) / (14 * DAY_MS));
    const trainingBlockStart = formatDate(addDays(parseDateKey(earliestDate), trainingBlockIndex * 14));
    const trainingBlockEnd = formatDate(addDays(parseDateKey(trainingBlockStart), 13));
    const seed = hashString(workout.slug);
    const angle = (seed % 360) * (Math.PI / 180);
    const radius = 180 + (seed % 320);
    const status: GraphNodeStatus = workout.completed ? "completed" : "planned";
    const excerpt = stripMarkdown(workout.body).slice(0, 180).trim() || null;

    return {
      id: workout.slug,
      slug: workout.slug,
      title: workout.title,
      date: workout.date,
      eventType: workout.eventType,
      status,
      sourcePath: workout.sourcePath,
      excerpt,
      radius: getNodeRadius(workout),
      x: Math.cos(angle) * radius + Math.sin(index) * 12,
      y: Math.sin(angle) * radius + Math.cos(index) * 12,
      clusters: {
        eventType: workout.eventType,
        month: clusterMonth,
        status,
        trainingBlock: `${trainingBlockStart} to ${trainingBlockEnd}`,
      },
      metrics: {
        expectedDistanceKm: workout.expectedDistanceKm ?? null,
        actualDistanceKm: workout.actualDistanceKm ?? null,
      },
    };
  });
}

function buildLinks(
  nodes: NoteGraphNode[],
  workouts: WorkoutNote[],
  authoredLinks: AuthoredGraphLinksDocument,
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const links = new Map<string, NoteGraphLink>();

  for (let index = 0; index < workouts.length - 1; index += 1) {
    const current = workouts[index];
    const next = workouts[index + 1];
    const dayGap = Math.round((parseDateKey(next.date).getTime() - parseDateKey(current.date).getTime()) / DAY_MS);
    if (dayGap < 0 || dayGap > 4) {
      continue;
    }

    const id = createLinkId(current.slug, next.slug, "adjacent");
    links.set(id, {
      id,
      source: current.slug,
      target: next.slug,
      kind: "adjacent",
      strength: current.date === next.date ? 0.42 : 0.32,
      label: current.date === next.date ? "same day sequence" : null,
      sourceType: "derived",
    });
  }

  const workoutsByDate = new Map<string, WorkoutNote[]>();
  for (const workout of workouts) {
    const existing = workoutsByDate.get(workout.date);
    if (existing) {
      existing.push(workout);
    } else {
      workoutsByDate.set(workout.date, [workout]);
    }
  }

  for (const sameDayWorkouts of workoutsByDate.values()) {
    for (let leftIndex = 0; leftIndex < sameDayWorkouts.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < sameDayWorkouts.length; rightIndex += 1) {
        const left = sameDayWorkouts[leftIndex];
        const right = sameDayWorkouts[rightIndex];
        const id = createLinkId(left.slug, right.slug, "sameDay");
        links.set(id, {
          id,
          source: left.slug,
          target: right.slug,
          kind: "sameDay",
          strength: 0.58,
          label: "scheduled on the same day",
          sourceType: "derived",
        });
      }
    }
  }

  for (const authoredLink of authoredLinks.links) {
    if (!nodeIds.has(authoredLink.sourceSlug) || !nodeIds.has(authoredLink.targetSlug)) {
      throw new Error(`Graph link references unknown node: ${authoredLink.sourceSlug} -> ${authoredLink.targetSlug}`);
    }

    const id = createLinkId(authoredLink.sourceSlug, authoredLink.targetSlug, authoredLink.kind);
    links.set(id, {
      id,
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

function buildClusters(nodes: NoteGraphNode[]): NoteGraphCluster[] {
  const clusters = new Map<string, NoteGraphCluster>();

  for (const node of nodes) {
    addClusterNode(clusters, "eventType", node.clusters.eventType, titleCase(node.clusters.eventType), node.id);
    addClusterNode(clusters, "status", node.clusters.status, titleCase(node.clusters.status), node.id);
    addClusterNode(clusters, "month", node.clusters.month, formatMonthLabel(node.clusters.month), node.id);
    addClusterNode(clusters, "trainingBlock", node.clusters.trainingBlock, node.clusters.trainingBlock, node.id);
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

function getNodeRadius(workout: WorkoutNote) {
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

function validateAuthoredLinksDocument(document: AuthoredGraphLinksDocument) {
  if (document.schemaVersion !== NOTE_GRAPH_SCHEMA_VERSION) {
    throw new Error(`Unsupported graph-links schema version: ${document.schemaVersion}`);
  }

  if (!Array.isArray(document.links)) {
    throw new Error("graph-links.json must contain a links array");
  }
}

function createLinkId(sourceSlug: string, targetSlug: string, kind: GraphLinkKind | string) {
  const [source, target] = [sourceSlug, targetSlug].sort((left, right) => left.localeCompare(right));
  return `${kind}:${source}:${target}`;
}

function clampStrength(value: number) {
  return Math.max(0.1, Math.min(1.4, value));
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

function formatMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map((value) => Number(value));
  const date = new Date(Date.UTC(year, month - 1, 1));
  return new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
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

const DAY_MS = 1000 * 60 * 60 * 24;

await main();
