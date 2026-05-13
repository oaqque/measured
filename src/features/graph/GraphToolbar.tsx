import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Focus, Footprints, Pause, Play, SlidersHorizontal, Sparkles, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { GraphClusterMode } from "@/lib/graph/schema";

const CLUSTER_MODE_LABELS: Array<{ mode: GraphClusterMode; label: string }> = [
  { mode: "eventType", label: "Type" },
  { mode: "status", label: "Status" },
  { mode: "month", label: "Month" },
  { mode: "trainingBlock", label: "Block" },
  { mode: "shoe", label: "Shoe" },
  { mode: "none", label: "Free" },
];

export interface GraphShoeFilterOption {
  label: string;
  nodeId: string;
  totalDistanceKm: number;
}

export function GraphToolbar({
  clusterMode,
  paused,
  search,
  selectedShoeNodeId,
  showAuthoredOnly,
  showAllLabels,
  shoeFilterOptions,
  onClusterModeChange,
  onFitView,
  onShoeFilterChange,
  onToggleAllLabels,
  onToggleAuthoredOnly,
  onTogglePaused,
}: {
  clusterMode: GraphClusterMode;
  paused: boolean;
  search?: ReactNode;
  selectedShoeNodeId: string | null;
  showAuthoredOnly: boolean;
  showAllLabels: boolean;
  shoeFilterOptions: GraphShoeFilterOption[];
  onClusterModeChange: (mode: GraphClusterMode) => void;
  onFitView: () => void;
  onShoeFilterChange: (nodeId: string | null) => void;
  onToggleAllLabels: () => void;
  onToggleAuthoredOnly: () => void;
  onTogglePaused: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="pointer-events-none absolute left-4 top-4 z-20 flex max-w-[calc(100%-6rem)] flex-col items-start gap-2">
      <div className="flex w-full items-start gap-2">
        <Button
          aria-label={expanded ? "Collapse graph controls" : "Expand graph controls"}
          className="pointer-events-auto h-11 rounded-[0.95rem] px-3 shadow-lg shadow-primary/10"
          size="sm"
          type="button"
          variant="secondary"
          onClick={() => setExpanded((value) => !value)}
        >
          <SlidersHorizontal className="size-4" />
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </Button>

        {search}
      </div>

      {expanded ? (
        <div className="pointer-events-auto w-[min(18rem,calc(100vw-7rem))] overflow-hidden rounded-[1.05rem] border border-foreground/10 bg-background/90 p-2.5 shadow-xl shadow-primary/10 backdrop-blur">
          <div className="flex flex-wrap items-center gap-1 rounded-[0.85rem] bg-surface-elevated p-1.5">
            {CLUSTER_MODE_LABELS.map(({ mode, label }) => (
              <button
                className={cn(
                  "rounded-[0.7rem] px-2.5 py-2 text-xs font-semibold transition-colors",
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

          {shoeFilterOptions.length > 0 ? (
            <div className="mt-2">
              <p className="px-1 pb-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
                Shoe filter
              </p>
              <Select value={selectedShoeNodeId ?? "all"} onValueChange={(value) => onShoeFilterChange(value === "all" ? null : value)}>
                <SelectTrigger className="h-10 rounded-[0.8rem] px-3 text-xs font-semibold">
                  <span className="flex min-w-0 items-center gap-2">
                    <Footprints className="size-4 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder="All shoes" />
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All shoes</SelectItem>
                  {shoeFilterOptions.map((option) => (
                    <SelectItem key={option.nodeId} value={option.nodeId}>
                      {option.label} · {formatKilometers(option.totalDistanceKm)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              className="h-10 rounded-[0.8rem] px-3"
              size="sm"
              type="button"
              variant={showAuthoredOnly ? "default" : "secondary"}
              onClick={onToggleAuthoredOnly}
            >
              <Sparkles className="size-4" />
              {showAuthoredOnly ? "Authored" : "All"}
            </Button>

            <Button
              className="h-10 rounded-[0.8rem] px-3"
              size="sm"
              type="button"
              variant="secondary"
              onClick={onFitView}
            >
              <Focus className="size-4" />
              Fit
            </Button>

            <Button
              className="col-span-2 h-10 rounded-[0.8rem] px-3"
              size="sm"
              type="button"
              variant={showAllLabels ? "default" : "secondary"}
              onClick={onToggleAllLabels}
            >
              <Type className="size-4" />
              {showAllLabels ? "Labels on" : "Labels off"}
            </Button>

            <Button
              className="col-span-2 h-10 rounded-[0.8rem] px-3"
              size="sm"
              type="button"
              variant="secondary"
              onClick={onTogglePaused}
            >
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
              {paused ? "Resume" : "Pause"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function formatKilometers(value: number) {
  return `${value.toFixed(1).replace(/\.0$/u, "")} km`;
}
