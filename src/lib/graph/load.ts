import noteGraphJson from "@/generated/note-graph.json";
import type { NoteGraphData } from "@/lib/graph/schema";

export const noteGraph = noteGraphJson as unknown as NoteGraphData;

export function getGraphNodeBySlug(slug: string) {
  return noteGraph.nodes.find((node) => node.slug === slug) ?? null;
}

export function getGraphNodeById(id: string) {
  return noteGraph.nodes.find((node) => node.id === id) ?? null;
}

export function getGraphLinksForSlug(slug: string) {
  return noteGraph.links.filter((link) => link.source === slug || link.target === slug);
}
