import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GraphCanvas } from "@/features/graph/GraphCanvas";
import { GraphChatBar } from "@/features/graph/GraphChatBar";
import { GraphSearch } from "@/features/graph/GraphSearch";
import type { GraphSearchSuggestion } from "@/features/graph/search";
import { GraphTelemetryOverlay } from "@/features/graph/GraphTelemetryOverlay";
import { deriveGraphSearchState } from "@/features/graph/search";
import { graphTelemetry } from "@/features/graph/telemetry";
import { GraphToolbar, type GraphShoeFilterOption } from "@/features/graph/GraphToolbar";
import { useGraphSession } from "@/features/graph/useGraphSession";
import { graphFolderNodeIdToPath } from "@/lib/graph/ids";
import { formatGraphFolderLabel } from "@/lib/graph/labels";
import type { NoteGraphData } from "@/lib/graph/schema";

const GRAPH_LABELS_KEY = "measured.noteGraph.showAllLabels";

export function GraphView({
  initialGraphData,
  noteOverlay,
  onCloseSelection,
  onOpenSelectedNode,
  selectedNodeId,
  onSelectNode,
}: {
  initialGraphData: NoteGraphData;
  noteOverlay?: ReactNode;
  onCloseSelection: () => void;
  onOpenSelectedNode: () => void;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const [fitRequestVersion, setFitRequestVersion] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedShoeNodeId, setSelectedShoeNodeId] = useState<string | null>(null);
  const [showAllLabels, setShowAllLabels] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem(GRAPH_LABELS_KEY) === "true";
  });
  const [telemetryVisible, setTelemetryVisible] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return new URLSearchParams(window.location.search).get("graphTelemetry") === "1";
  });
  const previousDetailOpenRef = useRef(Boolean(noteOverlay));
  const {
    chatEntries,
    backendLabel,
    backendReady,
    busy,
    clusterMode,
    graphData,
    paused,
    setClusterMode,
    setPaused,
    setShowAuthoredOnly,
    showAuthoredOnly,
    interrupt,
    sendMessage,
  } = useGraphSession(initialGraphData);
  const shoeFilterOptions = useMemo(() => buildShoeFilterOptions(graphData), [graphData]);
  const shoeFilteredGraphData = useMemo(
    () => filterGraphDataByShoe(graphData, selectedShoeNodeId),
    [graphData, selectedShoeNodeId],
  );
  const searchState = useMemo(() => deriveGraphSearchState(shoeFilteredGraphData, searchQuery), [shoeFilteredGraphData, searchQuery]);
  const filteredGraphData = searchState.filteredGraphData;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "t") {
        setTelemetryVisible((value) => !value);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const nextOpen = Boolean(noteOverlay);
    if (previousDetailOpenRef.current !== nextOpen && nextOpen) {
      graphTelemetry.recordDetailPaneOpen();
    }
    previousDetailOpenRef.current = nextOpen;
  }, [noteOverlay]);

  useEffect(() => {
    window.localStorage.setItem(GRAPH_LABELS_KEY, String(showAllLabels));
  }, [showAllLabels]);

  useEffect(() => {
    if (!selectedNodeId && !noteOverlay) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      if (noteOverlay) {
        onCloseSelection();
      }
      onSelectNode(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [noteOverlay, onCloseSelection, onSelectNode, selectedNodeId]);

  useEffect(() => {
    if (!selectedNodeId || searchState.visibleNodeIds.has(selectedNodeId)) {
      return;
    }

    onSelectNode(null);
    if (noteOverlay) {
      onCloseSelection();
    }
  }, [noteOverlay, onCloseSelection, onSelectNode, searchState.visibleNodeIds, selectedNodeId]);

  const selectedNodeSummary = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }

    const node = filteredGraphData.nodes.find((candidate) => candidate.id === selectedNodeId);
    if (!node) {
      return null;
    }

    return {
      canOpen: node.nodeKind === "document" || node.nodeKind === "workout",
      detail: node.nodeKind === "shoe" ? formatShoeNodeDetail(node) : null,
      label:
        node.nodeKind === "folder"
          ? formatGraphFolderLabel(graphFolderNodeIdToPath(node.id) ?? node.title)
          : node.title,
      nodeKind: node.nodeKind,
    };
  }, [filteredGraphData.nodes, selectedNodeId]);

  const handleSearchQueryChange = (nextQuery: string) => {
    if (nextQuery === searchQuery) {
      return;
    }

    setSearchQuery(nextQuery);
    setFitRequestVersion((value) => value + 1);
  };

  const handleSearchSuggestionSelect = (suggestion: GraphSearchSuggestion) => {
    if (suggestion.matchKind === "filter") {
      handleSearchQueryChange(suggestion.query ?? suggestion.label);
      onSelectNode(null);
      if (noteOverlay) {
        onCloseSelection();
      }
      return;
    }

    onSelectNode(suggestion.nodeId);
  };

  const handleShoeFilterChange = (nodeId: string | null) => {
    setSelectedShoeNodeId(nodeId);
    setSearchQuery("");
    onSelectNode(nodeId);
    if (noteOverlay) {
      onCloseSelection();
    }
    setFitRequestVersion((value) => value + 1);
  };

  return (
    <div className="relative h-full min-h-0">
      <div className="relative h-full min-h-0">
        <GraphCanvas
          clusterMode={clusterMode}
          data={filteredGraphData}
          fitRequestVersion={fitRequestVersion}
          paused={paused}
          selectedNodeId={selectedNodeId}
          showAllLabels={showAllLabels}
          showAuthoredOnly={showAuthoredOnly}
          selectedNodeSummary={selectedNodeSummary}
          onOpenSelectedNode={onOpenSelectedNode}
          onSelectNode={onSelectNode}
        />

        <GraphToolbar
          clusterMode={clusterMode}
          paused={paused}
          search={
            <GraphSearch
              query={searchQuery}
              suggestions={searchState.suggestions}
              onQueryChange={handleSearchQueryChange}
              onSelectSuggestion={handleSearchSuggestionSelect}
            />
          }
          selectedShoeNodeId={selectedShoeNodeId}
          showAllLabels={showAllLabels}
          showAuthoredOnly={showAuthoredOnly}
          shoeFilterOptions={shoeFilterOptions}
          onClusterModeChange={setClusterMode}
          onFitView={() => setFitRequestVersion((value) => value + 1)}
          onShoeFilterChange={handleShoeFilterChange}
          onToggleAllLabels={() => setShowAllLabels((value) => !value)}
          onToggleAuthoredOnly={() => setShowAuthoredOnly((value) => !value)}
          onTogglePaused={() => setPaused((value) => !value)}
        />

        {backendReady ? (
          <GraphChatBar
            backendLabel={backendLabel}
            busy={busy}
            entries={chatEntries}
            connected={backendReady}
            inputDisabled={!backendReady}
            onInterrupt={interrupt}
            onSendMessage={sendMessage}
          />
        ) : null}

        {noteOverlay ? (
          <div className="absolute inset-0 z-30">
            <button
              aria-label="Close selected note"
              className="absolute inset-0 bg-foreground/10 backdrop-blur-[2px]"
              type="button"
              onClick={onCloseSelection}
            />
            <div className="pointer-events-none absolute inset-0 flex items-stretch justify-center p-3 md:p-5">
              <div className="pointer-events-auto h-full w-full max-w-[min(72rem,calc(100%-1rem))] overflow-hidden rounded-[1.7rem] border border-foreground/10 bg-background/96 shadow-2xl shadow-primary/15 backdrop-blur">
                <div className="h-full px-4 py-4 md:px-6 md:py-5">{noteOverlay}</div>
              </div>
            </div>
          </div>
        ) : null}

        {telemetryVisible ? <GraphTelemetryOverlay /> : null}
      </div>
    </div>
  );
}

function buildShoeFilterOptions(data: NoteGraphData): GraphShoeFilterOption[] {
  return data.nodes
    .filter((node) => node.nodeKind === "shoe")
    .map((node) => ({
      label: node.title,
      nodeId: node.id,
      totalDistanceKm: node.metrics.shoeTotalDistanceKm ?? 0,
    }))
    .sort((left, right) =>
      right.totalDistanceKm === left.totalDistanceKm
        ? left.label.localeCompare(right.label)
        : right.totalDistanceKm - left.totalDistanceKm,
    );
}

function filterGraphDataByShoe(data: NoteGraphData, shoeNodeId: string | null): NoteGraphData {
  if (!shoeNodeId) {
    return data;
  }

  const visibleNodeIds = new Set<string>([shoeNodeId]);
  for (const link of data.links) {
    if (link.source === shoeNodeId || link.target === shoeNodeId) {
      visibleNodeIds.add(link.source);
      visibleNodeIds.add(link.target);
    }
  }

  const nodes = data.nodes.filter((node) => visibleNodeIds.has(node.id));
  const links = data.links.filter((link) => visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target));
  const clusters = data.clusters
    .map((cluster) => ({
      ...cluster,
      nodeIds: cluster.nodeIds.filter((nodeId) => visibleNodeIds.has(nodeId)),
    }))
    .filter((cluster) => cluster.nodeIds.length > 0);

  return {
    ...data,
    clusters,
    links,
    nodes,
  };
}

function formatShoeNodeDetail(node: NoteGraphData["nodes"][number]) {
  const distanceKm = node.metrics.shoeTotalDistanceKm;
  return typeof distanceKm === "number" && Number.isFinite(distanceKm)
    ? `${formatKilometers(distanceKm)} logged`
    : "Shoe";
}

function formatKilometers(value: number) {
  return `${value.toFixed(1).replace(/\.0$/u, "")} km`;
}
