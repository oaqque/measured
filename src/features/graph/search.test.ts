import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveGraphSearchState } from "@/features/graph/search";
import type { NoteGraphData } from "@/lib/graph/schema";

const TEST_GRAPH: NoteGraphData = {
  schemaVersion: 1,
  generatedAt: "2026-04-21T00:00:00.000Z",
  nodes: [
    {
      id: "match",
      slug: "match",
      nodeKind: "workout",
      title: "Tempo Run",
      date: "2026-04-10",
      category: "run",
      status: "planned",
      sourcePath: "notes/tempo-run.md",
      excerpt: null,
      radius: 16,
      x: 0,
      y: 0,
      clusters: {
        eventType: "run",
        month: "2026-04",
        status: "planned",
        trainingBlock: "block-a",
      },
      metrics: {
        expectedDistanceKm: 8,
        actualDistanceKm: null,
      },
    },
    {
      id: "neighbor",
      slug: "neighbor",
      nodeKind: "document",
      title: "Race Plan",
      date: null,
      category: "plan",
      status: "reference",
      sourcePath: "PLAN.md",
      excerpt: null,
      radius: 18,
      x: 24,
      y: 12,
      clusters: {
        eventType: "plan",
        month: "structure",
        status: "reference",
        trainingBlock: "plan",
      },
      metrics: {
        expectedDistanceKm: null,
        actualDistanceKm: null,
      },
    },
    {
      id: "distant",
      slug: "distant",
      nodeKind: "workout",
      title: "Easy Swim",
      date: "2026-04-12",
      category: "mobility",
      status: "completed",
      sourcePath: "notes/easy-swim.md",
      excerpt: null,
      radius: 16,
      x: 128,
      y: 48,
      clusters: {
        eventType: "mobility",
        month: "2026-04",
        status: "completed",
        trainingBlock: "block-a",
      },
      metrics: {
        expectedDistanceKm: null,
        actualDistanceKm: null,
      },
    },
  ],
  links: [
    {
      id: "match-neighbor",
      source: "match",
      target: "neighbor",
      kind: "references",
      strength: 1,
      label: null,
      sourceType: "authored",
    },
    {
      id: "neighbor-distant",
      source: "neighbor",
      target: "distant",
      kind: "derived",
      strength: 1,
      label: null,
      sourceType: "derived",
    },
  ],
  clusters: [
    {
      id: "month:2026-04",
      mode: "month",
      key: "2026-04",
      label: "April 2026",
      nodeIds: ["match", "distant"],
    },
    {
      id: "trainingBlock:block-a",
      mode: "trainingBlock",
      key: "block-a",
      label: "Block A",
      nodeIds: ["match", "distant"],
    },
  ],
};

describe("deriveGraphSearchState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T09:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the full graph when the query is empty", () => {
    const result = deriveGraphSearchState(TEST_GRAPH, "");

    expect(result.filteredGraphData).toBe(TEST_GRAPH);
    expect(result.suggestions).toEqual([]);
    expect(Array.from(result.visibleNodeIds)).toEqual(["match", "neighbor", "distant"]);
  });

  it("keeps direct matches and one-hop neighbors visible while hiding unrelated nodes", () => {
    const result = deriveGraphSearchState(TEST_GRAPH, "tempo");

    expect(result.directMatchNodeIds.has("match")).toBe(true);
    expect(result.visibleNodeIds.has("match")).toBe(true);
    expect(result.visibleNodeIds.has("neighbor")).toBe(true);
    expect(result.visibleNodeIds.has("distant")).toBe(false);
    expect(result.filteredGraphData.nodes.map((node) => node.id)).toEqual(["match", "neighbor"]);
    expect(result.filteredGraphData.links.map((link) => link.id)).toEqual(["match-neighbor"]);
    expect(result.filteredGraphData.clusters).toHaveLength(2);
    expect(result.filteredGraphData.clusters[0]?.nodeIds).toEqual(["match"]);
  });

  it("ranks direct matches ahead of connected neighbor suggestions", () => {
    const result = deriveGraphSearchState(TEST_GRAPH, "tempo");

    expect(result.suggestions.map((suggestion) => ({
      label: suggestion.label,
      matchKind: suggestion.matchKind,
    }))).toEqual([
      { label: "Tempo Run", matchKind: "direct" },
      { label: "Training Plan", matchKind: "neighbor" },
    ]);
  });

  it("prefers stronger direct matches before looser ones", () => {
    const graph: NoteGraphData = {
      ...TEST_GRAPH,
      nodes: [
        ...TEST_GRAPH.nodes,
        {
          id: "prefix",
          slug: "prefix",
          nodeKind: "workout",
          title: "Tempo Builder",
          date: "2026-04-11",
          category: "run",
          status: "planned",
          sourcePath: "notes/tempo-builder.md",
          excerpt: null,
          radius: 16,
          x: 8,
          y: 8,
          clusters: {
            eventType: "run",
            month: "2026-04",
            status: "planned",
            trainingBlock: "block-a",
          },
          metrics: {
            expectedDistanceKm: 5,
            actualDistanceKm: null,
          },
        },
      ],
      links: TEST_GRAPH.links,
      clusters: TEST_GRAPH.clusters,
    };

    const result = deriveGraphSearchState(graph, "tempo run");

    expect(result.suggestions[0]?.nodeId).toBe("match");
  });

  it("matches relative day filters for today", () => {
    const result = deriveGraphSearchState(TEST_GRAPH, "today");

    expect(result.directMatchNodeIds.has("match")).toBe(true);
    expect(result.suggestions[0]).toMatchObject({
      nodeId: "match",
      matchKind: "direct",
    });
  });

  it("matches relative day filters for tomorrow and yesterday", () => {
    const graph: NoteGraphData = {
      ...TEST_GRAPH,
      nodes: [
        ...TEST_GRAPH.nodes,
        {
          id: "tomorrow-run",
          slug: "tomorrow-run",
          nodeKind: "workout",
          title: "Tomorrow Run",
          date: "2026-04-11",
          category: "run",
          status: "planned",
          sourcePath: "notes/tomorrow-run.md",
          excerpt: null,
          radius: 16,
          x: 12,
          y: 18,
          clusters: {
            eventType: "run",
            month: "2026-04",
            status: "planned",
            trainingBlock: "block-a",
          },
          metrics: {
            expectedDistanceKm: 6,
            actualDistanceKm: null,
          },
        },
        {
          id: "yesterday-run",
          slug: "yesterday-run",
          nodeKind: "workout",
          title: "Yesterday Run",
          date: "2026-04-09",
          category: "run",
          status: "completed",
          sourcePath: "notes/yesterday-run.md",
          excerpt: null,
          radius: 16,
          x: -12,
          y: -18,
          clusters: {
            eventType: "run",
            month: "2026-04",
            status: "completed",
            trainingBlock: "block-a",
          },
          metrics: {
            expectedDistanceKm: 6,
            actualDistanceKm: 6,
          },
        },
      ],
      links: TEST_GRAPH.links,
      clusters: TEST_GRAPH.clusters,
    };

    expect(deriveGraphSearchState(graph, "tomorrow").directMatchNodeIds.has("tomorrow-run")).toBe(true);
    expect(deriveGraphSearchState(graph, "yesterday").directMatchNodeIds.has("yesterday-run")).toBe(true);
  });

  it("matches relative week filters for this week", () => {
    const graph: NoteGraphData = {
      ...TEST_GRAPH,
      nodes: [
        ...TEST_GRAPH.nodes,
        {
          id: "week-later-run",
          slug: "week-later-run",
          nodeKind: "workout",
          title: "Saturday Run",
          date: "2026-04-11",
          category: "run",
          status: "planned",
          sourcePath: "notes/saturday-run.md",
          excerpt: null,
          radius: 16,
          x: 18,
          y: 12,
          clusters: {
            eventType: "run",
            month: "2026-04",
            status: "planned",
            trainingBlock: "block-a",
          },
          metrics: {
            expectedDistanceKm: 10,
            actualDistanceKm: null,
          },
        },
        {
          id: "next-week-run",
          slug: "next-week-run",
          nodeKind: "workout",
          title: "Next Week Run",
          date: "2026-04-13",
          category: "run",
          status: "planned",
          sourcePath: "notes/next-week-run.md",
          excerpt: null,
          radius: 16,
          x: 32,
          y: 18,
          clusters: {
            eventType: "run",
            month: "2026-04",
            status: "planned",
            trainingBlock: "block-a",
          },
          metrics: {
            expectedDistanceKm: 10,
            actualDistanceKm: null,
          },
        },
      ],
      links: TEST_GRAPH.links,
      clusters: TEST_GRAPH.clusters,
    };

    const result = deriveGraphSearchState(graph, "this week");

    expect(result.directMatchNodeIds.has("match")).toBe(true);
    expect(result.directMatchNodeIds.has("week-later-run")).toBe(true);
    expect(result.directMatchNodeIds.has("next-week-run")).toBe(false);
  });
});
