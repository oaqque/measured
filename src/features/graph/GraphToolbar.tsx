import { Focus, Orbit, Pause, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GraphClusterMode } from "@/lib/graph/schema";

const CLUSTER_MODE_LABELS: Array<{ mode: GraphClusterMode; label: string }> = [
  { mode: "eventType", label: "Type" },
  { mode: "status", label: "Status" },
  { mode: "month", label: "Month" },
  { mode: "trainingBlock", label: "Block" },
  { mode: "none", label: "Free" },
];

export function GraphToolbar({
  clusterMode,
  linkCount,
  nodeCount,
  paused,
  showAuthoredOnly,
  onClusterModeChange,
  onFitView,
  onToggleAuthoredOnly,
  onTogglePaused,
}: {
  clusterMode: GraphClusterMode;
  linkCount: number;
  nodeCount: number;
  paused: boolean;
  showAuthoredOnly: boolean;
  onClusterModeChange: (mode: GraphClusterMode) => void;
  onFitView: () => void;
  onToggleAuthoredOnly: () => void;
  onTogglePaused: () => void;
}) {
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-[1.1rem] border border-foreground/10 bg-background/88 px-3 py-3 shadow-lg shadow-primary/10 backdrop-blur">
      <div className="rounded-[0.9rem] bg-surface-elevated px-3 py-2 text-xs font-semibold text-muted-foreground">
        {nodeCount} nodes · {linkCount} links
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-[0.9rem] bg-surface-elevated p-1">
        {CLUSTER_MODE_LABELS.map(({ mode, label }) => (
          <button
            className={cn(
              "rounded-[0.7rem] px-3 py-2 text-xs font-semibold transition-colors",
              clusterMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-surface-panel-alt",
            )}
            key={mode}
            type="button"
            onClick={() => onClusterModeChange(mode)}
          >
            {label}
          </button>
        ))}
      </div>

      <Button
        className="h-10 rounded-[0.85rem] px-4"
        size="sm"
        type="button"
        variant={showAuthoredOnly ? "default" : "secondary"}
        onClick={onToggleAuthoredOnly}
      >
        <Sparkles className="size-4" />
        {showAuthoredOnly ? "Authored only" : "All links"}
      </Button>

      <Button
        className="h-10 rounded-[0.85rem] px-4"
        size="sm"
        type="button"
        variant="secondary"
        onClick={onFitView}
      >
        <Focus className="size-4" />
        Fit
      </Button>

      <Button
        className="h-10 rounded-[0.85rem] px-4"
        size="sm"
        type="button"
        variant="secondary"
        onClick={onTogglePaused}
      >
        {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
        {paused ? "Resume" : "Pause"}
      </Button>

      <div className="rounded-[0.9rem] bg-surface-panel px-3 py-2 text-xs font-semibold text-foreground">
        <Orbit className="mr-1 inline size-3.5" />
        Interactive canvas
      </div>
    </div>
  );
}
