import { useEffect, useMemo, useRef } from "react";
import { graphTelemetry } from "@/features/graph/telemetry";
import { useGraphWasm } from "@/features/graph/useGraphWasm";
import type { GraphClusterMode, NoteGraphData } from "@/lib/graph/schema";
import type { GraphEngineController } from "@/features/graph/engine-types";

const EVENT_TYPE_COLORS = {
  basketball: "#f08a24",
  mobility: "#5c6bc0",
  race: "#c93636",
  run: "#1d2a6d",
  strength: "#2f7d51",
} as const;

const DEFAULT_CLUSTER_MODE: GraphClusterMode = "eventType";

function getClusterValue(node: NoteGraphData["nodes"][number], clusterMode: GraphClusterMode) {
  if (clusterMode === "eventType") {
    return node.clusters.eventType;
  }

  if (clusterMode === "status") {
    return node.clusters.status;
  }

  if (clusterMode === "month") {
    return node.clusters.month;
  }

  if (clusterMode === "trainingBlock") {
    return node.clusters.trainingBlock;
  }

  return null;
}

export function GraphCanvas({
  clusterMode,
  data,
  fitRequestVersion,
  paused,
  selectedSlug,
  showAllLabels,
  showAuthoredOnly,
  onSelectSlug,
}: {
  clusterMode: GraphClusterMode;
  data: NoteGraphData;
  fitRequestVersion: number;
  paused: boolean;
  selectedSlug: string | null;
  showAllLabels: boolean;
  showAuthoredOnly: boolean;
  onSelectSlug: (slug: string | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GraphEngineController | null>(null);
  const lastFitRequestRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const logicalSizeRef = useRef({ width: 1, height: 1 });
  const rasterSizeRef = useRef({ width: 0, height: 0, dpr: 0 });
  const needsDrawRef = useRef(true);
  const pendingDrawReasonsRef = useRef(new Set<string>(["initial"]));
  const appliedClusterModeRef = useRef<GraphClusterMode>(DEFAULT_CLUSTER_MODE);
  const appliedShowAuthoredOnlyRef = useRef(false);
  const autoFitFramesRemainingRef = useRef(0);
  const autoFitReasonRef = useRef<string | null>(null);
  const autoFitStillFramesRef = useRef(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const { createEngine, error, usingFallback } = useGraphWasm();
  const onSelectSlugRef = useRef(onSelectSlug);
  const markDirty = (reason: string) => {
    pendingDrawReasonsRef.current.add(reason);
    needsDrawRef.current = true;
  };

  const selectedId = selectedSlug;

  useEffect(() => {
    onSelectSlugRef.current = onSelectSlug;
  }, [onSelectSlug]);

  const clusterLabelByKey = useMemo(
    () => new Map(data.clusters.map((cluster) => [`${cluster.mode}:${cluster.key}`, cluster.label])),
    [data.clusters],
  );
  const activeClusterLabelByNodeId = useMemo(() => {
    const labels = new Map<string, string>();
    if (clusterMode === "none") {
      return labels;
    }

    for (const node of data.nodes) {
      const clusterKey = getClusterValue(node, clusterMode);
      if (!clusterKey) {
        continue;
      }

      labels.set(node.id, clusterLabelByKey.get(`${clusterMode}:${clusterKey}`) ?? clusterKey);
    }

    return labels;
  }, [clusterLabelByKey, clusterMode, data.nodes]);

  const draw = useMemo(
    () => (context: CanvasRenderingContext2D, width: number, height: number) => {
      const engine = engineRef.current;
      if (!engine) {
        return;
      }

      const snapshot = engine.getSnapshot();
      const drawStartedAt = performance.now();
      context.save();
      context.clearRect(0, 0, width, height);

      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "#eef4fb");
      gradient.addColorStop(1, "#d6e5ff");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      context.save();
      context.translate(snapshot.viewport.x, snapshot.viewport.y);
      context.scale(snapshot.viewport.scale, snapshot.viewport.scale);

      for (const link of snapshot.links) {
        context.beginPath();
        context.moveTo(link.sourceX, link.sourceY);
        context.lineTo(link.targetX, link.targetY);
        context.strokeStyle = link.sourceType === "authored" ? "rgba(29, 42, 109, 0.55)" : "rgba(22, 36, 71, 0.14)";
        context.lineWidth = link.sourceType === "authored" ? 2.25 / snapshot.viewport.scale : 1.2 / snapshot.viewport.scale;
        context.stroke();
      }

      const hoveredNode =
        snapshot.hoveredNodeId !== null ? snapshot.nodes.find((node) => node.id === snapshot.hoveredNodeId) ?? null : null;

      for (const node of snapshot.nodes) {
        const isSelected = snapshot.selectedNodeId === node.id;
        const isHovered = snapshot.hoveredNodeId === node.id;
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fillStyle = EVENT_TYPE_COLORS[node.eventType];
        context.globalAlpha = node.status === "planned" ? 0.78 : 0.94;
        context.fill();
        context.globalAlpha = 1;

        context.lineWidth = isSelected ? 4 / snapshot.viewport.scale : isHovered ? 2.5 / snapshot.viewport.scale : 1.5 / snapshot.viewport.scale;
        context.strokeStyle = isSelected ? "#f4fdff" : isHovered ? "rgba(244,253,255,0.82)" : "rgba(244,253,255,0.46)";
        context.stroke();
      }

      context.restore();

      const drawNodeLabel = (node: (typeof snapshot.nodes)[number], label: string, emphasized: boolean) => {
        const screenX = snapshot.viewport.x + node.x * snapshot.viewport.scale;
        const screenY = snapshot.viewport.y + node.y * snapshot.viewport.scale;
        const pillPaddingX = emphasized ? 10 : 8;
        const pillHeight = emphasized ? 28 : 24;

        context.save();
        context.font = emphasized
          ? '600 13px "Manrope Variable", ui-sans-serif, system-ui, sans-serif'
          : '600 11px "Manrope Variable", ui-sans-serif, system-ui, sans-serif';
        const textWidth = context.measureText(label).width;
        const pillWidth = textWidth + pillPaddingX * 2;
        const pillX = Math.min(Math.max(12, screenX - pillWidth / 2), Math.max(12, width - pillWidth - 12));
        const pillY = Math.min(
          Math.max(12, screenY - node.radius * snapshot.viewport.scale - (emphasized ? 42 : 34)),
          Math.max(12, height - pillHeight - 12),
        );

        context.fillStyle = emphasized ? "rgba(244, 253, 255, 0.95)" : "rgba(244, 253, 255, 0.78)";
        context.beginPath();
        context.roundRect(pillX, pillY, pillWidth, pillHeight, emphasized ? 10 : 9);
        context.fill();

        context.strokeStyle = emphasized ? "rgba(29, 42, 109, 0.12)" : "rgba(29, 42, 109, 0.08)";
        context.lineWidth = 1;
        context.stroke();

        context.fillStyle = emphasized ? "#162447" : "rgba(22, 36, 71, 0.84)";
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText(label, pillX + pillWidth / 2, pillY + pillHeight / 2 + 0.5);
        context.restore();
      };

      if (showAllLabels && clusterMode !== "none") {
        for (const node of snapshot.nodes) {
          if (hoveredNode && node.id === hoveredNode.id) {
            continue;
          }

          const label = activeClusterLabelByNodeId.get(node.id);
          if (!label) {
            continue;
          }

          drawNodeLabel(node, label, false);
        }
      }

      if (hoveredNode && clusterMode !== "none") {
        const hoverLabel = activeClusterLabelByNodeId.get(hoveredNode.id);
        if (hoverLabel) {
          drawNodeLabel(hoveredNode, hoverLabel, true);
        }
      }

      context.restore();
      graphTelemetry.recordDraw(performance.now() - drawStartedAt, Array.from(pendingDrawReasonsRef.current));
      pendingDrawReasonsRef.current.clear();
    },
    [activeClusterLabelByNodeId, clusterMode, showAllLabels],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas) {
      return;
    }
    if (!container) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    const engine = createEngine(data);
    engineRef.current = engine;
    appliedClusterModeRef.current = DEFAULT_CLUSTER_MODE;
    appliedShowAuthoredOnlyRef.current = false;
    rasterSizeRef.current = { width: 0, height: 0, dpr: 0 };
    graphTelemetry.recordEngineCreate();

    const fitViewport = (reason: string) => {
      engine.fitView();
      graphTelemetry.recordFitView(reason);
      markDirty(reason);
    };

    const clearAutoFit = () => {
      autoFitReasonRef.current = null;
      autoFitFramesRemainingRef.current = 0;
      autoFitStillFramesRef.current = 0;
    };

    const scheduleAutoFit = (reason: string, frames = 180) => {
      autoFitReasonRef.current = reason;
      autoFitFramesRemainingRef.current = Math.max(autoFitFramesRemainingRef.current, frames);
      autoFitStillFramesRef.current = 0;
    };

    const settleAndFit = (reason: string, iterations = 60) => {
      for (let index = 0; index < iterations; index += 1) {
        const tickStartedAt = performance.now();
        engine.tick(16);
        graphTelemetry.recordTick(performance.now() - tickStartedAt);
      }
      fitViewport(reason);
      scheduleAutoFit(reason);
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const nextRasterWidth = Math.max(1, Math.round(rect.width * dpr));
      const nextRasterHeight = Math.max(1, Math.round(rect.height * dpr));
      const previousRasterSize = rasterSizeRef.current;

      if (
        previousRasterSize.width === nextRasterWidth &&
        previousRasterSize.height === nextRasterHeight &&
        previousRasterSize.dpr === dpr
      ) {
        return;
      }

      rasterSizeRef.current = {
        width: nextRasterWidth,
        height: nextRasterHeight,
        dpr,
      };
      graphTelemetry.recordResize(`${Math.round(rect.width)}x${Math.round(rect.height)} @${dpr.toFixed(2)}`);

      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      logicalSizeRef.current = { width: rect.width, height: rect.height };
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.scale(dpr, dpr);
      engine.resize(rect.width, rect.height, dpr);
      settleAndFit("resize");
      markDirty("resize");
    };

    resize();

    resizeObserverRef.current = new ResizeObserver(resize);
    resizeObserverRef.current.observe(container);

    let lastFrame = performance.now();
    const frame = (now: number) => {
      const frameMs = now - lastFrame;
      const tickStartedAt = performance.now();
      const moved = engine.tick(frameMs);
      graphTelemetry.recordTick(performance.now() - tickStartedAt);
      graphTelemetry.recordFrame(frameMs);
      lastFrame = now;
      if (autoFitFramesRemainingRef.current > 0) {
        fitViewport(autoFitReasonRef.current ?? "auto-fit");
        autoFitFramesRemainingRef.current -= 1;
        autoFitStillFramesRef.current = moved ? 0 : autoFitStillFramesRef.current + 1;
        if (autoFitFramesRemainingRef.current <= 0 || autoFitStillFramesRef.current >= 12) {
          clearAutoFit();
        }
      }
      if (moved || needsDrawRef.current) {
        if (moved) {
          pendingDrawReasonsRef.current.add("layout");
        }
        draw(context, logicalSizeRef.current.width, logicalSizeRef.current.height);
        needsDrawRef.current = false;
      }
      frameRef.current = window.requestAnimationFrame(frame);
    };

    frameRef.current = window.requestAnimationFrame(frame);

    const handleEvents = (events: Array<{ nodeId?: string | null; type: string }>) => {
      for (const event of events) {
        if (event.type === "selectionChanged") {
          onSelectSlugRef.current(event.nodeId ?? null);
          graphTelemetry.recordSelectionChange(event.nodeId ?? null);
        }
        if (event.type === "dragStateChanged") {
          graphTelemetry.recordDragState(Boolean("dragging" in event && event.dragging));
        }
        if (event.type === "viewportChanged") {
          graphTelemetry.recordPan();
        }
      }
      markDirty("interaction");
    };

    const getCanvasPoint = (event: PointerEvent | WheelEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    };

    const handlePointerDown = (event: PointerEvent) => {
      const point = getCanvasPoint(event);
      clearAutoFit();
      canvas.setPointerCapture(event.pointerId);
      handleEvents(
        engine.pointerDown(point.x, point.y, event.button, event.shiftKey, event.metaKey),
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      const point = getCanvasPoint(event);
      handleEvents(engine.pointerMove(point.x, point.y));
    };

    const handlePointerUp = (event: PointerEvent) => {
      const point = getCanvasPoint(event);
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      handleEvents(engine.pointerUp(point.x, point.y));
    };

    const handleWheel = (event: WheelEvent) => {
      const point = getCanvasPoint(event);
      event.preventDefault();
      clearAutoFit();
      graphTelemetry.recordZoom();
      handleEvents(engine.wheel(point.x, point.y, event.deltaX, event.deltaY, event.ctrlKey));
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }
      resizeObserverRef.current?.disconnect();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", handlePointerUp);
      canvas.removeEventListener("pointerleave", handlePointerUp);
      canvas.removeEventListener("wheel", handleWheel);
      engine.destroy();
      engineRef.current = null;
      graphTelemetry.recordEngineDestroy();
    };
  }, [createEngine, data, draw]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    if (appliedClusterModeRef.current === clusterMode) {
      return;
    }

    appliedClusterModeRef.current = clusterMode;
    engine.setClusterMode(clusterMode);
    if (logicalSizeRef.current.width > 1 && logicalSizeRef.current.height > 1) {
      for (let index = 0; index < 36; index += 1) {
        const tickStartedAt = performance.now();
        engine.tick(16);
        graphTelemetry.recordTick(performance.now() - tickStartedAt);
      }
      engine.fitView();
      graphTelemetry.recordFitView("cluster-mode");
      autoFitReasonRef.current = "cluster-mode";
      autoFitFramesRemainingRef.current = Math.max(autoFitFramesRemainingRef.current, 180);
      autoFitStillFramesRef.current = 0;
    }
    markDirty("cluster-mode");
  }, [clusterMode]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    if (appliedShowAuthoredOnlyRef.current === showAuthoredOnly) {
      return;
    }

    appliedShowAuthoredOnlyRef.current = showAuthoredOnly;
    engine.setShowAuthoredOnly(showAuthoredOnly);
    if (logicalSizeRef.current.width > 1 && logicalSizeRef.current.height > 1) {
      for (let index = 0; index < 36; index += 1) {
        const tickStartedAt = performance.now();
        engine.tick(16);
        graphTelemetry.recordTick(performance.now() - tickStartedAt);
      }
      engine.fitView();
      graphTelemetry.recordFitView("filter");
      autoFitReasonRef.current = "filter";
      autoFitFramesRemainingRef.current = Math.max(autoFitFramesRemainingRef.current, 180);
      autoFitStillFramesRef.current = 0;
    }
    markDirty("filter");
  }, [showAuthoredOnly]);

  useEffect(() => {
    engineRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    engineRef.current?.selectNode(selectedId);
    markDirty("selection");
  }, [selectedId]);

  useEffect(() => {
    if (fitRequestVersion === lastFitRequestRef.current) {
      return;
    }

    lastFitRequestRef.current = fitRequestVersion;
    const engine = engineRef.current;
    if (!engine) {
      return;
    }

    for (let index = 0; index < 36; index += 1) {
      const tickStartedAt = performance.now();
      engine.tick(16);
      graphTelemetry.recordTick(performance.now() - tickStartedAt);
    }
    engine.fitView();
    graphTelemetry.recordFitView("user");
    autoFitReasonRef.current = "user";
    autoFitFramesRemainingRef.current = Math.max(autoFitFramesRemainingRef.current, 180);
    autoFitStillFramesRef.current = 0;
    markDirty("fit-view");
  }, [fitRequestVersion]);

  useEffect(() => {
    graphTelemetry.setGraphStats({
      clusterMode,
      linkCount: data.links.length,
      nodeCount: data.nodes.length,
      showAuthoredOnly,
    });
  }, [clusterMode, data.links.length, data.nodes.length, showAuthoredOnly]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-[2rem] border border-foreground/10 bg-background/70" ref={containerRef}>
      <canvas className="graph-canvas block h-full w-full cursor-grab active:cursor-grabbing" ref={canvasRef} />
      {error ? (
        <div className="pointer-events-none absolute left-4 top-4 rounded-[0.9rem] bg-background/90 px-3 py-2 text-xs font-semibold text-muted-foreground backdrop-blur">
          {usingFallback ? "Rust WASM unavailable, using fallback engine." : error}
        </div>
      ) : null}
    </div>
  );
}
