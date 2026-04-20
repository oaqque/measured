import { useEffect, useMemo, useRef } from "react";
import { graphTelemetry } from "@/features/graph/telemetry";
import { useGraphWasm } from "@/features/graph/useGraphWasm";
import { graphFolderNodeIdToPath } from "@/lib/graph/ids";
import { formatGraphFolderLabel } from "@/lib/graph/labels";
import type { GraphClusterMode, NoteGraphData } from "@/lib/graph/schema";
import type { GraphEngineController } from "@/features/graph/engine-types";

const CATEGORY_COLORS = {
  basketball: "#f08a24",
  changelog: "#8c5e3c",
  folder: "#4c6285",
  goal: "#b03f78",
  goals: "#9150b8",
  metaanalysis: "#4f7aa7",
  mobility: "#5c6bc0",
  plan: "#2e5f73",
  race: "#c93636",
  run: "#1d2a6d",
  strength: "#2f7d51",
  welcome: "#6a6f8c",
} as const;

const DEFAULT_CLUSTER_MODE: GraphClusterMode = "none";

type TouchGestureState =
  | {
      identifier: number;
      lastPoint: { x: number; y: number };
      mode: "single";
    }
  | {
      lastCenter: { x: number; y: number };
      lastDistance: number;
      mode: "pinch";
    };

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
  onOpenSelectedNode,
  paused,
  selectedNodeId,
  selectedNodeSummary,
  showAllLabels,
  showAuthoredOnly,
  onSelectNode,
}: {
  clusterMode: GraphClusterMode;
  data: NoteGraphData;
  fitRequestVersion: number;
  onOpenSelectedNode: () => void;
  paused: boolean;
  selectedNodeId: string | null;
  selectedNodeSummary: {
    canOpen: boolean;
    label: string;
    nodeKind: NoteGraphData["nodes"][number]["nodeKind"];
  } | null;
  showAllLabels: boolean;
  showAuthoredOnly: boolean;
  onSelectNode: (nodeId: string | null) => void;
}) {
  const actionChipRef = useRef<HTMLDivElement | null>(null);
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
  const touchGestureRef = useRef<TouchGestureState | null>(null);
  const { createEngine, error, usingFallback } = useGraphWasm();
  const onSelectNodeRef = useRef(onSelectNode);
  const drawRef = useRef<((context: CanvasRenderingContext2D, width: number, height: number) => void) | null>(null);
  const markDirty = (reason: string) => {
    pendingDrawReasonsRef.current.add(reason);
    needsDrawRef.current = true;
  };

  const selectedId = selectedNodeId;

  useEffect(() => {
    onSelectNodeRef.current = onSelectNode;
  }, [onSelectNode]);

  const clusterLabelByKey = useMemo(
    () => new Map(data.clusters.map((cluster) => [`${cluster.mode}:${cluster.key}`, cluster.label])),
    [data.clusters],
  );
  const activeClusterLabelByNodeId = useMemo(() => {
    const labels = new Map<string, string>();
    for (const node of data.nodes) {
      if (node.nodeKind === "folder") {
        const folderPath = graphFolderNodeIdToPath(node.id);
        labels.set(node.id, folderPath ? formatGraphFolderLabel(folderPath) : node.title);
        continue;
      }

      if (clusterMode === "none") {
        labels.set(node.id, node.title);
        continue;
      }

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
        context.fillStyle = CATEGORY_COLORS[node.category];
        context.globalAlpha = node.status === "planned" ? 0.78 : node.nodeKind === "folder" ? 0.88 : 0.94;
        context.beginPath();
        if (node.nodeKind === "folder") {
          const width = node.radius * 2.4;
          const height = node.radius * 1.45;
          context.roundRect(node.x - width / 2, node.y - height / 2, width, height, 9);
        } else {
          context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        }
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

      if (showAllLabels) {
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

      if (hoveredNode) {
        const hoverLabel = activeClusterLabelByNodeId.get(hoveredNode.id);
        if (hoverLabel) {
          drawNodeLabel(hoveredNode, hoverLabel, true);
        }
      }

      const actionChip = actionChipRef.current;
      if (actionChip) {
        const selectedNode =
          snapshot.selectedNodeId !== null ? snapshot.nodes.find((node) => node.id === snapshot.selectedNodeId) ?? null : null;

        if (!selectedNode || !selectedNodeSummary) {
          actionChip.style.opacity = "0";
          actionChip.style.pointerEvents = "none";
        } else {
          const screenX = snapshot.viewport.x + selectedNode.x * snapshot.viewport.scale;
          const screenY = snapshot.viewport.y + selectedNode.y * snapshot.viewport.scale;
          const chipRect = actionChip.getBoundingClientRect();
          const chipWidth = chipRect.width || 200;
          const chipHeight = chipRect.height || 72;
          const offsetX = selectedNode.nodeKind === "folder" ? 24 : 18;
          const offsetY = selectedNode.nodeKind === "folder" ? -chipHeight - 12 : -chipHeight - 16;
          const clampedX = Math.min(Math.max(12, screenX + offsetX), Math.max(12, width - chipWidth - 12));
          const clampedY = Math.min(
            Math.max(12, screenY + offsetY),
            Math.max(12, height - chipHeight - 12),
          );

          actionChip.style.opacity = "1";
          actionChip.style.pointerEvents = "auto";
          actionChip.style.transform = `translate3d(${clampedX}px, ${clampedY}px, 0)`;
        }
      }

      context.restore();
      graphTelemetry.recordDraw(performance.now() - drawStartedAt, Array.from(pendingDrawReasonsRef.current));
      pendingDrawReasonsRef.current.clear();
    },
    [activeClusterLabelByNodeId, selectedNodeSummary, showAllLabels],
  );

  useEffect(() => {
    drawRef.current = draw;
    markDirty("draw-props");
  }, [draw]);

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
        drawRef.current?.(context, logicalSizeRef.current.width, logicalSizeRef.current.height);
        needsDrawRef.current = false;
      }
      frameRef.current = window.requestAnimationFrame(frame);
    };

    frameRef.current = window.requestAnimationFrame(frame);

    const handleEvents = (events: Array<{ nodeId?: string | null; type: string }>) => {
      for (const event of events) {
        if (event.type === "selectionChanged") {
          onSelectNodeRef.current(event.nodeId ?? null);
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

    const getCanvasTouchPoint = (touch: Touch) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: touch.clientX - rect.left,
        y: touch.clientY - rect.top,
      };
    };

    const getPinchMetrics = (touchList: TouchList) => {
      if (touchList.length < 2) {
        return null;
      }

      const first = getCanvasTouchPoint(touchList[0]);
      const second = getCanvasTouchPoint(touchList[1]);
      return {
        center: {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
        },
        distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      };
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }

      const point = getCanvasPoint(event);
      clearAutoFit();
      canvas.setPointerCapture(event.pointerId);
      handleEvents(
        engine.pointerDown(point.x, point.y, event.button, event.shiftKey, event.metaKey),
      );
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }

      const point = getCanvasPoint(event);
      handleEvents(engine.pointerMove(point.x, point.y));
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }

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

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 0) {
        return;
      }

      event.preventDefault();
      clearAutoFit();

      if (event.touches.length === 1) {
        const touch = event.touches[0];
        if (!touch) {
          return;
        }

        const point = getCanvasTouchPoint(touch);
        touchGestureRef.current = {
          identifier: touch.identifier,
          lastPoint: point,
          mode: "single",
        };
        handleEvents(engine.pointerDown(point.x, point.y, 0, false, false));
        return;
      }

      handleEvents(engine.cancelInteraction());
      const pinchMetrics = getPinchMetrics(event.touches);
      if (!pinchMetrics) {
        return;
      }

      touchGestureRef.current = {
        lastCenter: pinchMetrics.center,
        lastDistance: pinchMetrics.distance,
        mode: "pinch",
      };
    };

    const handleTouchMove = (event: TouchEvent) => {
      const gesture = touchGestureRef.current;
      if (!gesture || event.touches.length === 0) {
        return;
      }

      event.preventDefault();

      if (event.touches.length >= 2) {
        const pinchMetrics = getPinchMetrics(event.touches);
        if (!pinchMetrics) {
          return;
        }

        if (gesture.mode !== "pinch") {
          handleEvents(engine.cancelInteraction());
          touchGestureRef.current = {
            lastCenter: pinchMetrics.center,
            lastDistance: pinchMetrics.distance,
            mode: "pinch",
          };
          return;
        }

        const panX = pinchMetrics.center.x - gesture.lastCenter.x;
        const panY = pinchMetrics.center.y - gesture.lastCenter.y;
        if (panX !== 0 || panY !== 0) {
          handleEvents(engine.panBy(panX, panY));
        }

        const scaleMultiplier = pinchMetrics.distance / Math.max(1, gesture.lastDistance);
        if (Math.abs(scaleMultiplier - 1) > 0.001) {
          graphTelemetry.recordZoom();
          handleEvents(engine.zoomAt(pinchMetrics.center.x, pinchMetrics.center.y, scaleMultiplier));
        }

        gesture.lastCenter = pinchMetrics.center;
        gesture.lastDistance = pinchMetrics.distance;
        return;
      }

      if (gesture.mode !== "single") {
        return;
      }

      const activeTouch = Array.from(event.touches).find((touch) => touch.identifier === gesture.identifier) ?? event.touches[0];
      if (!activeTouch) {
        return;
      }

      const point = getCanvasTouchPoint(activeTouch);
      gesture.lastPoint = point;
      handleEvents(engine.pointerMove(point.x, point.y));
    };

    const handleTouchEnd = (event: TouchEvent) => {
      const gesture = touchGestureRef.current;
      if (!gesture) {
        return;
      }

      event.preventDefault();

      if (gesture.mode === "single") {
        handleEvents(engine.pointerUp(gesture.lastPoint.x, gesture.lastPoint.y));
        touchGestureRef.current = null;
        return;
      }

      if (event.touches.length >= 2) {
        const pinchMetrics = getPinchMetrics(event.touches);
        if (!pinchMetrics) {
          return;
        }

        touchGestureRef.current = {
          lastCenter: pinchMetrics.center,
          lastDistance: pinchMetrics.distance,
          mode: "pinch",
        };
        return;
      }

      touchGestureRef.current = null;
    };

    const handleTouchCancel = (event: TouchEvent) => {
      event.preventDefault();
      touchGestureRef.current = null;
      handleEvents(engine.cancelInteraction());
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", handlePointerUp);
    canvas.addEventListener("pointerleave", handlePointerUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", handleTouchCancel, { passive: false });

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
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchCancel);
      engine.destroy();
      engineRef.current = null;
      graphTelemetry.recordEngineDestroy();
    };
  }, [createEngine, data]);

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
    <div className="relative h-full w-full overflow-hidden" ref={containerRef}>
      <canvas className="graph-canvas block h-full w-full touch-none cursor-grab active:cursor-grabbing" ref={canvasRef} />
      {selectedNodeSummary ? (
        <div
          className="pointer-events-none absolute left-0 top-0 z-20 w-[min(16rem,calc(100vw-1.5rem))] rounded-[1rem] border border-foreground/10 bg-background/94 p-2.5 shadow-xl shadow-primary/12 backdrop-blur transition-opacity"
          ref={actionChipRef}
          style={{ opacity: 0, transform: "translate3d(-9999px, -9999px, 0)" }}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{selectedNodeSummary.label}</p>
              <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                {selectedNodeSummary.nodeKind}
              </p>
            </div>

            {selectedNodeSummary.canOpen ? (
              <button
                className="pointer-events-auto shrink-0 rounded-[0.75rem] bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                type="button"
                onClick={onOpenSelectedNode}
              >
                Open
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="pointer-events-none absolute left-4 top-4 rounded-[0.9rem] bg-background/90 px-3 py-2 text-xs font-semibold text-muted-foreground backdrop-blur">
          {usingFallback ? "Rust WASM unavailable, using fallback engine." : error}
        </div>
      ) : null}
    </div>
  );
}
