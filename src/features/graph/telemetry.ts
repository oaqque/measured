import type { GraphClusterMode } from "@/lib/graph/schema";

export interface GraphTelemetrySnapshot {
  sessionStartedAt: string;
  graph: {
    nodeCount: number;
    linkCount: number;
    clusterMode: GraphClusterMode;
    showAuthoredOnly: boolean;
  };
  render: {
    frameCount: number;
    slowFrameCount: number;
    avgFrameMs: number;
    maxFrameMs: number;
    avgDrawMs: number;
    maxDrawMs: number;
    drawReasons: Record<string, number>;
  };
  interaction: {
    dragCount: number;
    avgDragMs: number;
    selectionCount: number;
    panCount: number;
    zoomCount: number;
  };
  layout: {
    avgTickMs: number;
    maxTickMs: number;
    fitViewCount: number;
    resizeCount: number;
    engineCreateCount: number;
    engineDestroyCount: number;
    detailPaneOpenCount: number;
  };
  backend: {
    chatTurnCount: number;
    chatErrorCount: number;
    avgTurnMs: number;
    persistOpsCount: number;
    persistErrorCount: number;
  };
  recentEvents: Array<{
    atMs: number;
    type: string;
    detail?: string;
  }>;
}

type RecentEvent = GraphTelemetrySnapshot["recentEvents"][number];

const MAX_RECENT_EVENTS = 50;
const SLOW_FRAME_MS = 24;

class GraphTelemetryStore {
  private readonly sessionStartedAt = new Date().toISOString();
  private readonly recentEvents: RecentEvent[] = [];
  private readonly subscribers = new Set<() => void>();
  private chatTurnStartedAt: number | null = null;
  private currentDragStartedAt: number | null = null;
  private graph = {
    clusterMode: "eventType" as GraphClusterMode,
    linkCount: 0,
    nodeCount: 0,
    showAuthoredOnly: false,
  };
  private interaction = {
    dragCount: 0,
    dragDurationTotalMs: 0,
    panCount: 0,
    selectionCount: 0,
    zoomCount: 0,
  };
  private layout = {
    detailPaneOpenCount: 0,
    engineCreateCount: 0,
    engineDestroyCount: 0,
    fitViewCount: 0,
    maxTickMs: 0,
    resizeCount: 0,
    tickCount: 0,
    tickDurationTotalMs: 0,
  };
  private render = {
    drawCount: 0,
    drawDurationTotalMs: 0,
    drawReasons: {} as Record<string, number>,
    frameCount: 0,
    frameDurationTotalMs: 0,
    maxDrawMs: 0,
    maxFrameMs: 0,
    slowFrameCount: 0,
  };
  private backend = {
    chatErrorCount: 0,
    chatTurnCount: 0,
    persistErrorCount: 0,
    persistOpsCount: 0,
    turnDurationTotalMs: 0,
  };

  constructor() {
    (globalThis as { __MEASURED_GRAPH_TELEMETRY__?: GraphTelemetryStore }).__MEASURED_GRAPH_TELEMETRY__ = this;
  }

  subscribe(callback: () => void) {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  getSnapshot(): GraphTelemetrySnapshot {
    return {
      sessionStartedAt: this.sessionStartedAt,
      graph: { ...this.graph },
      render: {
        frameCount: this.render.frameCount,
        slowFrameCount: this.render.slowFrameCount,
        avgFrameMs: average(this.render.frameDurationTotalMs, this.render.frameCount),
        maxFrameMs: this.render.maxFrameMs,
        avgDrawMs: average(this.render.drawDurationTotalMs, this.render.drawCount),
        maxDrawMs: this.render.maxDrawMs,
        drawReasons: { ...this.render.drawReasons },
      },
      interaction: {
        dragCount: this.interaction.dragCount,
        avgDragMs: average(this.interaction.dragDurationTotalMs, this.interaction.dragCount),
        selectionCount: this.interaction.selectionCount,
        panCount: this.interaction.panCount,
        zoomCount: this.interaction.zoomCount,
      },
      layout: {
        avgTickMs: average(this.layout.tickDurationTotalMs, this.layout.tickCount),
        maxTickMs: this.layout.maxTickMs,
        fitViewCount: this.layout.fitViewCount,
        resizeCount: this.layout.resizeCount,
        engineCreateCount: this.layout.engineCreateCount,
        engineDestroyCount: this.layout.engineDestroyCount,
        detailPaneOpenCount: this.layout.detailPaneOpenCount,
      },
      backend: {
        chatTurnCount: this.backend.chatTurnCount,
        chatErrorCount: this.backend.chatErrorCount,
        avgTurnMs: average(this.backend.turnDurationTotalMs, this.backend.chatTurnCount - this.backend.chatErrorCount),
        persistOpsCount: this.backend.persistOpsCount,
        persistErrorCount: this.backend.persistErrorCount,
      },
      recentEvents: [...this.recentEvents],
    };
  }

  exportSnapshot() {
    return JSON.stringify(this.getSnapshot(), null, 2);
  }

  setGraphStats({
    clusterMode,
    linkCount,
    nodeCount,
    showAuthoredOnly,
  }: {
    clusterMode: GraphClusterMode;
    linkCount: number;
    nodeCount: number;
    showAuthoredOnly: boolean;
  }) {
    this.graph = { clusterMode, linkCount, nodeCount, showAuthoredOnly };
    this.emit();
  }

  recordFrame(frameMs: number) {
    this.render.frameCount += 1;
    this.render.frameDurationTotalMs += frameMs;
    this.render.maxFrameMs = Math.max(this.render.maxFrameMs, frameMs);
    if (frameMs >= SLOW_FRAME_MS) {
      this.render.slowFrameCount += 1;
      this.pushRecentEvent("slow-frame", `${frameMs.toFixed(1)} ms`);
    }
  }

  recordDraw(drawMs: number, reasons: string[]) {
    this.render.drawCount += 1;
    this.render.drawDurationTotalMs += drawMs;
    this.render.maxDrawMs = Math.max(this.render.maxDrawMs, drawMs);
    for (const reason of reasons.length > 0 ? reasons : ["unknown"]) {
      this.render.drawReasons[reason] = (this.render.drawReasons[reason] ?? 0) + 1;
    }
    if (drawMs >= 12) {
      this.pushRecentEvent("slow-draw", `${drawMs.toFixed(1)} ms [${reasons.join(", ") || "unknown"}]`);
    }
    this.emit();
  }

  recordTick(tickMs: number) {
    this.layout.tickCount += 1;
    this.layout.tickDurationTotalMs += tickMs;
    this.layout.maxTickMs = Math.max(this.layout.maxTickMs, tickMs);
  }

  recordResize(detail: string) {
    this.layout.resizeCount += 1;
    this.pushRecentEvent("resize", detail);
    this.emit();
  }

  recordEngineCreate() {
    this.layout.engineCreateCount += 1;
    this.pushRecentEvent("engine-create");
    this.emit();
  }

  recordEngineDestroy() {
    this.layout.engineDestroyCount += 1;
    this.pushRecentEvent("engine-destroy");
    this.emit();
  }

  recordSelectionChange(detail: string | null) {
    this.interaction.selectionCount += 1;
    this.pushRecentEvent("selection", detail ?? "none");
    this.emit();
  }

  recordDragState(active: boolean) {
    if (active) {
      this.currentDragStartedAt = performance.now();
      this.pushRecentEvent("drag-start");
      this.emit();
      return;
    }

    if (this.currentDragStartedAt !== null) {
      this.interaction.dragCount += 1;
      this.interaction.dragDurationTotalMs += performance.now() - this.currentDragStartedAt;
      this.currentDragStartedAt = null;
      this.pushRecentEvent("drag-end");
      this.emit();
    }
  }

  recordPan() {
    this.interaction.panCount += 1;
  }

  recordZoom() {
    this.interaction.zoomCount += 1;
    this.emit();
  }

  recordFitView(reason: string) {
    this.layout.fitViewCount += 1;
    this.pushRecentEvent("fit-view", reason);
    this.emit();
  }

  recordDetailPaneOpen() {
    this.layout.detailPaneOpenCount += 1;
    this.pushRecentEvent("detail-pane-open");
    this.emit();
  }

  recordChatTurnStart() {
    this.backend.chatTurnCount += 1;
    this.chatTurnStartedAt = performance.now();
    this.emit();
  }

  recordChatTurnComplete() {
    if (this.chatTurnStartedAt !== null) {
      this.backend.turnDurationTotalMs += performance.now() - this.chatTurnStartedAt;
      this.chatTurnStartedAt = null;
    }
    this.emit();
  }

  recordChatError(detail: string) {
    this.backend.chatErrorCount += 1;
    this.chatTurnStartedAt = null;
    this.pushRecentEvent("chat-error", detail);
    this.emit();
  }

  recordPersistResult(opCount: number, ok: boolean) {
    if (ok) {
      this.backend.persistOpsCount += opCount;
      this.pushRecentEvent("persist-ops", `${opCount} ops`);
    } else {
      this.backend.persistErrorCount += 1;
      this.pushRecentEvent("persist-error", `${opCount} ops`);
    }
    this.emit();
  }

  private pushRecentEvent(type: string, detail?: string) {
    this.recentEvents.push({
      atMs: Math.round(performance.now()),
      type,
      detail,
    });
    if (this.recentEvents.length > MAX_RECENT_EVENTS) {
      this.recentEvents.splice(0, this.recentEvents.length - MAX_RECENT_EVENTS);
    }
  }

  private emit() {
    for (const subscriber of this.subscribers) {
      subscriber();
    }
  }
}

function average(total: number, count: number) {
  return count === 0 ? 0 : total / count;
}

export const graphTelemetry = new GraphTelemetryStore();
