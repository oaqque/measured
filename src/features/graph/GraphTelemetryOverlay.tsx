import { Download, Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { graphTelemetry, type GraphTelemetrySnapshot } from "@/features/graph/telemetry";

export function GraphTelemetryOverlay() {
  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState<GraphTelemetrySnapshot>(() => graphTelemetry.getSnapshot());

  useEffect(() => {
    return graphTelemetry.subscribe(() => {
      setSnapshot(graphTelemetry.getSnapshot());
    });
  }, []);

  const exportTelemetry = () => {
    const blob = new Blob([graphTelemetry.exportSnapshot()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `measured-graph-telemetry-${new Date().toISOString().replaceAll(":", "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-30 w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-[1.2rem] border border-foreground/10 bg-background/94 shadow-xl shadow-primary/10 backdrop-blur">
      <div className="flex items-center justify-between gap-3 border-b border-foreground/10 px-4 py-3">
        <div>
          <p className="text-sm font-black text-foreground">Graph Telemetry</p>
          <p className="text-xs text-muted-foreground">Local, in-memory, session-scoped.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button className="h-9 rounded-[0.75rem] px-3" size="sm" type="button" variant="secondary" onClick={exportTelemetry}>
            <Download className="size-4" />
            Export
          </Button>
          <Button
            className="h-9 rounded-[0.75rem] px-3"
            size="sm"
            type="button"
            variant="secondary"
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            {expanded ? "Collapse" : "Expand"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 px-4 py-3 text-xs text-foreground">
        <Metric label="Nodes" value={String(snapshot.graph.nodeCount)} />
        <Metric label="Links" value={String(snapshot.graph.linkCount)} />
        <Metric label="Cluster" value={snapshot.graph.clusterMode} />
        <Metric label="Authored Only" value={snapshot.graph.showAuthoredOnly ? "yes" : "no"} />
        <Metric label="Frames" value={String(snapshot.render.frameCount)} />
        <Metric label="Slow Frames" value={String(snapshot.render.slowFrameCount)} />
        <Metric label="Avg Frame" value={`${snapshot.render.avgFrameMs.toFixed(1)} ms`} />
        <Metric label="Max Frame" value={`${snapshot.render.maxFrameMs.toFixed(1)} ms`} />
        <Metric label="Avg Draw" value={`${snapshot.render.avgDrawMs.toFixed(1)} ms`} />
        <Metric label="Avg Tick" value={`${snapshot.layout.avgTickMs.toFixed(2)} ms`} />
        <Metric label="Resizes" value={String(snapshot.layout.resizeCount)} />
        <Metric label="Detail Opens" value={String(snapshot.layout.detailPaneOpenCount)} />
        <Metric label="Drags" value={String(snapshot.interaction.dragCount)} />
        <Metric label="Zooms" value={String(snapshot.interaction.zoomCount)} />
        <Metric label="Chat Turns" value={String(snapshot.backend.chatTurnCount)} />
        <Metric label="Chat Errors" value={String(snapshot.backend.chatErrorCount)} />
      </div>

      {expanded ? (
        <div className="border-t border-foreground/10 px-4 py-3">
          <section>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Draw Reasons</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(snapshot.render.drawReasons).map(([reason, count]) => (
                <span className="rounded-full bg-surface-panel px-2.5 py-1 text-[11px] font-semibold text-foreground" key={reason}>
                  {reason}: {count}
                </span>
              ))}
            </div>
          </section>

          <section className="mt-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-muted-foreground">Recent Events</p>
            <div className="max-h-52 overflow-y-auto rounded-[0.9rem] bg-surface-elevated/70 p-3">
              <div className="space-y-2 text-[11px] leading-5 text-foreground">
                {snapshot.recentEvents.length > 0 ? (
                  snapshot.recentEvents
                    .slice()
                    .reverse()
                    .map((event) => (
                      <p key={`${event.atMs}-${event.type}-${event.detail ?? ""}`}>
                        <span className="font-bold">{event.atMs} ms</span> · {event.type}
                        {event.detail ? ` · ${event.detail}` : ""}
                      </p>
                    ))
                ) : (
                  <p className="text-muted-foreground">No events yet.</p>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[0.9rem] bg-surface-elevated/70 px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}
