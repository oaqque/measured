import { useEffect, useRef, useState } from "react";
import { GraphCanvas } from "@/features/graph/GraphCanvas";
import { GraphChatBar } from "@/features/graph/GraphChatBar";
import { GraphTelemetryOverlay } from "@/features/graph/GraphTelemetryOverlay";
import { graphTelemetry } from "@/features/graph/telemetry";
import { GraphToolbar } from "@/features/graph/GraphToolbar";
import { useGraphSession } from "@/features/graph/useGraphSession";
import type { NoteGraphData } from "@/lib/graph/schema";

export function GraphView({
  initialGraphData,
  selectedWorkoutSlug,
  onSelectWorkout,
}: {
  initialGraphData: NoteGraphData;
  selectedWorkoutSlug: string | null;
  onSelectWorkout: (slug: string | null) => void;
}) {
  const [fitRequestVersion, setFitRequestVersion] = useState(0);
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

  return (
    <div className="relative h-full min-h-0">
      <div className="relative h-full min-h-0">
        <GraphCanvas
          clusterMode={clusterMode}
          data={graphData}
          fitRequestVersion={fitRequestVersion}
          paused={paused}
          selectedSlug={selectedWorkoutSlug}
          showAuthoredOnly={showAuthoredOnly}
          onSelectSlug={onSelectWorkout}
        />

        <GraphToolbar
          clusterMode={clusterMode}
          paused={paused}
          showAuthoredOnly={showAuthoredOnly}
          onClusterModeChange={setClusterMode}
          onFitView={() => setFitRequestVersion((value) => value + 1)}
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

        {telemetryVisible ? <GraphTelemetryOverlay /> : null}
      </div>
    </div>
  );
}
