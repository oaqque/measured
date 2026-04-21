import { addDaysToDate, formatDateKey, getTodayDateKey, parseDateKey, startOfWeek } from "@/lib/calendar";
import { graphFolderNodeIdToPath } from "@/lib/graph/ids";
import { formatGraphFolderLabel, formatGraphSourcePathLabel } from "@/lib/graph/labels";
import type { NoteGraphData, NoteGraphNode } from "@/lib/graph/schema";

export interface GraphSearchSuggestion {
  description: string;
  label: string;
  matchKind: "direct" | "neighbor";
  nodeId: string;
}

export interface GraphSearchState {
  directMatchNodeIds: Set<string>;
  filteredGraphData: NoteGraphData;
  suggestions: GraphSearchSuggestion[];
  visibleNodeIds: Set<string>;
}

interface SearchableNode {
  dateAliases: string[];
  date: string | null;
  label: string;
  node: NoteGraphNode;
  searchableText: string;
}

export function deriveGraphSearchState(data: NoteGraphData, rawQuery: string): GraphSearchState {
  const query = normalizeGraphSearchText(rawQuery);
  if (!query) {
    return {
      directMatchNodeIds: new Set(),
      filteredGraphData: data,
      suggestions: [],
      visibleNodeIds: new Set(data.nodes.map((node) => node.id)),
    };
  }

  const searchableNodes = data.nodes.map((node) => buildSearchableNode(node));
  const directMatches = searchableNodes
    .filter((entry) => matchesSearchQuery(entry.searchableText, query))
    .sort((left, right) => compareDirectMatches(left, right, query));
  const directMatchNodeIds = new Set(directMatches.map((entry) => entry.node.id));

  const neighborNodeIds = new Set<string>();
  for (const link of data.links) {
    const sourceMatched = directMatchNodeIds.has(link.source);
    const targetMatched = directMatchNodeIds.has(link.target);
    if (!sourceMatched && !targetMatched) {
      continue;
    }

    neighborNodeIds.add(link.source);
    neighborNodeIds.add(link.target);
  }

  const visibleNodeIds = new Set([...directMatchNodeIds, ...neighborNodeIds]);
  const filteredNodes = data.nodes.filter((node) => visibleNodeIds.has(node.id));
  const filteredLinks = data.links.filter((link) => visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target));
  const filteredClusters = data.clusters
    .map((cluster) => ({
      ...cluster,
      nodeIds: cluster.nodeIds.filter((nodeId) => visibleNodeIds.has(nodeId)),
    }))
    .filter((cluster) => cluster.nodeIds.length > 0);

  const suggestions = [
    ...directMatches.map((entry) => createSuggestion(entry, "direct")),
    ...searchableNodes
      .filter((entry) => visibleNodeIds.has(entry.node.id) && !directMatchNodeIds.has(entry.node.id))
      .sort(compareNeighbors)
      .map((entry) => createSuggestion(entry, "neighbor")),
  ];

  return {
    directMatchNodeIds,
    filteredGraphData: {
      ...data,
      clusters: filteredClusters,
      links: filteredLinks,
      nodes: filteredNodes,
    },
    suggestions,
    visibleNodeIds,
  };
}

function buildSearchableNode(node: NoteGraphNode): SearchableNode {
  const label = getNodeSearchLabel(node);
  const dateAliases = getRelativeDateAliases(node.date);
  const searchFields = [label, node.title, node.slug, node.sourcePath, node.date, ...dateAliases].filter(Boolean);
  return {
    dateAliases,
    date: node.date,
    label,
    node,
    searchableText: normalizeGraphSearchText(searchFields.join(" ")),
  };
}

function createSuggestion(entry: SearchableNode, matchKind: "direct" | "neighbor"): GraphSearchSuggestion {
  return {
    description: formatSuggestionDescription(entry.node, matchKind),
    label: entry.label,
    matchKind,
    nodeId: entry.node.id,
  };
}

function compareDirectMatches(left: SearchableNode, right: SearchableNode, query: string) {
  const leftScore = scoreDirectMatch(left, query);
  const rightScore = scoreDirectMatch(right, query);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  return compareNeighbors(left, right);
}

function compareNeighbors(left: SearchableNode, right: SearchableNode) {
  const leftDate = left.date ?? "";
  const rightDate = right.date ?? "";
  if (leftDate !== rightDate) {
    return rightDate.localeCompare(leftDate);
  }

  return left.label.localeCompare(right.label);
}

function scoreDirectMatch(entry: SearchableNode, query: string) {
  const normalizedLabel = normalizeGraphSearchText(entry.label);
  const normalizedTitle = normalizeGraphSearchText(entry.node.title);
  let score = 0;

  if (normalizedLabel === query) {
    score += 400;
  }
  if (normalizedTitle === query) {
    score += 250;
  }
  if (normalizedLabel.startsWith(query)) {
    score += 150;
  }
  if (normalizedTitle.startsWith(query)) {
    score += 100;
  }
  if (entry.date === query) {
    score += 75;
  }
  if (entry.dateAliases.includes(query)) {
    score += 175;
  }

  return score;
}

function formatSuggestionDescription(node: NoteGraphNode, matchKind: "direct" | "neighbor") {
  const typeLabel = node.nodeKind.charAt(0).toUpperCase() + node.nodeKind.slice(1);
  const parts = [typeLabel];

  if (node.date) {
    parts.push(node.date);
  }
  if (matchKind === "neighbor") {
    parts.push("Connected");
  }

  return parts.join(" • ");
}

function getNodeSearchLabel(node: NoteGraphNode) {
  if (node.nodeKind === "folder") {
    const folderPath = graphFolderNodeIdToPath(node.id);
    return folderPath ? formatGraphFolderLabel(folderPath) : node.title;
  }

  if (node.nodeKind === "document" && node.sourcePath) {
    return formatGraphSourcePathLabel(node.sourcePath);
  }

  return node.title;
}

function matchesSearchQuery(searchableText: string, query: string) {
  return query
    .split(/\s+/u)
    .filter(Boolean)
    .every((token) => searchableText.includes(token));
}

function normalizeGraphSearchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}\s/-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function getRelativeDateAliases(date: string | null) {
  if (!date) {
    return [];
  }

  const aliases: string[] = [];
  const diffDays = getDateDifferenceInDays(date, getTodayDateKey());
  if (diffDays === 0) {
    aliases.push("today");
  }
  if (diffDays === 1) {
    aliases.push("tomorrow");
  }
  if (diffDays === -1) {
    aliases.push("yesterday");
  }
  if (diffDays === 2) {
    aliases.push("day after tomorrow");
  }
  if (diffDays === -2) {
    aliases.push("day before yesterday");
  }

  if (isDateInCurrentWeek(date)) {
    aliases.push("this week");
  }

  return aliases;
}

function getDateDifferenceInDays(leftDateKey: string, rightDateKey: string) {
  const leftDate = parseDateKey(leftDateKey);
  const rightDate = parseDateKey(rightDateKey);
  const normalizedLeft = parseDateKey(formatDateKey(addDaysToDate(leftDate, 0)));
  const normalizedRight = parseDateKey(formatDateKey(addDaysToDate(rightDate, 0)));
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round((normalizedLeft.getTime() - normalizedRight.getTime()) / millisecondsPerDay);
}

function isDateInCurrentWeek(dateKey: string) {
  const date = parseDateKey(dateKey);
  const weekStart = startOfWeek(parseDateKey(getTodayDateKey()));
  const weekEnd = addDaysToDate(weekStart, 6);
  const normalizedDate = parseDateKey(formatDateKey(date));
  return normalizedDate >= weekStart && normalizedDate <= weekEnd;
}
