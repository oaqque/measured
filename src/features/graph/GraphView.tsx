import { useEffect, useRef, useState, type ReactNode } from "react";
import { GraphCanvas } from "@/features/graph/GraphCanvas";
import { GraphChatBar } from "@/features/graph/GraphChatBar";
import { GraphTelemetryOverlay } from "@/features/graph/GraphTelemetryOverlay";
import { graphTelemetry } from "@/features/graph/telemetry";
import { GraphToolbar } from "@/features/graph/GraphToolbar";
import { useGraphSession } from "@/features/graph/useGraphSession";
import type { NoteGraphData } from "@/lib/graph/schema";

const GRAPH_LABELS_KEY = "measured.noteGraph.showAllLabels";

export function GraphView({
  initialGraphData,
  noteOverlay,
  onCloseWorkout,
  selectedWorkoutSlug,
  onSelectWorkout,
}: {
  initialGraphData: NoteGraphData;
  noteOverlay?: ReactNode;
  onCloseWorkout: () => void;
  selectedWorkoutSlug: string | null;
  onSelectWorkout: (slug: string | null) => void;
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
  const previousDetailOpenRef = useRef(Boolean(selectedWorkoutSlug));
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
    const nextOpen = Boolean(selectedWorkoutSlug);
    if (previousDetailOpenRef.current !== nextOpen && nextOpen) {
      graphTelemetry.recordDetailPaneOpen();
    }
    previousDetailOpenRef.current = nextOpen;
  }, [selectedWorkoutSlug]);

  useEffect(() => {
    window.localStorage.setItem(GRAPH_LABELS_KEY, String(showAllLabels));
  }, [showAllLabels]);

  useEffect(() => {
    if (!selectedWorkoutSlug) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseWorkout();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onCloseWorkout, selectedWorkoutSlug]);

  return (
    <div className="relative h-full min-h-0">
      <div className="relative h-full min-h-0">
        <GraphCanvas
          clusterMode={clusterMode}
          data={graphData}
          fitRequestVersion={fitRequestVersion}
          paused={paused}
          selectedSlug={selectedWorkoutSlug}
          showAllLabels={showAllLabels}
          showAuthoredOnly={showAuthoredOnly}
          onSelectSlug={onSelectWorkout}
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

        {noteOverlay ? (
          <div className="absolute inset-0 z-30">
            <button
              aria-label="Close selected note"
              className="absolute inset-0 bg-foreground/10 backdrop-blur-[2px]"
              type="button"
              onClick={onCloseWorkout}
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
