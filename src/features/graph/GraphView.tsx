import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { GraphCanvas } from "@/features/graph/GraphCanvas";
import { GraphChatBar } from "@/features/graph/GraphChatBar";
import { GraphTelemetryOverlay } from "@/features/graph/GraphTelemetryOverlay";
import { graphTelemetry } from "@/features/graph/telemetry";
import { GraphToolbar } from "@/features/graph/GraphToolbar";
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
    assistantText,
    backendLabel,
    backendReady,
    busy,
    clusterMode,
    graphData,
    paused,
    pendingPersistentOps,
    setClusterMode,
    setPaused,
    setShowAuthoredOnly,
    showAuthoredOnly,
    streamingText,
    applyPending,
    interrupt,
    sendMessage,
  } = useGraphSession(initialGraphData);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.shiftKey && event.key.toLowerCase() === "t") {
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
    if (!noteOverlay) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [noteOverlay, onCloseSelection]);

  const selectedNodeSummary = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }

    const node = graphData.nodes.find((candidate) => candidate.id === selectedNodeId);
    if (!node) {
      return null;
    }

    return {
      canOpen: node.nodeKind !== "folder",
      label:
        node.nodeKind === "folder"
          ? formatGraphFolderLabel(graphFolderNodeIdToPath(node.id) ?? node.title)
          : node.title,
      nodeKind: node.nodeKind,
    };
  }, [graphData.nodes, selectedNodeId]);

  return (
    <div className="relative h-full min-h-0">
      <div className="relative h-full min-h-0">
        <GraphCanvas
          clusterMode={clusterMode}
          data={graphData}
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
          showAllLabels={showAllLabels}
          showAuthoredOnly={showAuthoredOnly}
          onClusterModeChange={setClusterMode}
          onFitView={() => setFitRequestVersion((value) => value + 1)}
          onToggleAllLabels={() => setShowAllLabels((value) => !value)}
          onToggleAuthoredOnly={() => setShowAuthoredOnly((value) => !value)}
          onTogglePaused={() => setPaused((value) => !value)}
        />

        {backendReady ? (
          <GraphChatBar
            assistantText={assistantText}
            backendLabel={backendLabel}
            busy={busy}
            connected={backendReady}
            inputDisabled={!backendReady}
            pendingOps={pendingPersistentOps}
            streamingText={streamingText}
            onApplyPendingOps={applyPending}
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
