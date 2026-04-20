import type {
  GraphClusterMode,
  GraphInteractionEvent,
  GraphLinkSource,
  GraphSnapshot,
  GraphViewportState,
  NoteGraphData,
  NoteGraphNode,
} from "@/lib/graph/schema";
import type { GraphEngineController } from "@/features/graph/engine-types";

interface InternalNode {
  id: string;
  label: string;
  eventType: NoteGraphNode["eventType"];
  status: NoteGraphNode["status"];
  radius: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
  clusters: NoteGraphNode["clusters"];
}

interface InternalLink {
  id: string;
  source: string;
  target: string;
  kind: string;
  sourceType: GraphLinkSource;
  strength: number;
}

export function createFallbackGraphEngine(data: NoteGraphData): GraphEngineController {
  return new FallbackGraphEngine(data);
}

class FallbackGraphEngine implements GraphEngineController {
  private allLinks: InternalLink[] = [];
  private allNodes: InternalNode[] = [];
  private pendingNodeSelectionId: string | null = null;
  private height = 1;
  private lastPointerWorld: { x: number; y: number } | null = null;
  private lastPointerScreen: { x: number; y: number } | null = null;
  private pointerDownScreen: { x: number; y: number } | null = null;
  private paused = false;
  private panning = false;
  private selectedNodeId: string | null = null;
  private showAuthoredOnly = false;
  private viewport: GraphViewportState = { x: 0, y: 0, scale: 1 };
  private width = 1;
  private hoveredNodeId: string | null = null;
  private draggingNodeId: string | null = null;
  private clusterMode: GraphClusterMode = "eventType";
  private links: InternalLink[] = [];
  private nodes: InternalNode[] = [];

  constructor(data: NoteGraphData) {
    this.setGraph(data);
  }

  setGraph(data: NoteGraphData) {
    this.allNodes = data.nodes.map((node) => ({
      id: node.id,
      label: node.title,
      eventType: node.eventType,
      status: node.status,
      radius: node.radius,
      x: node.x,
      y: node.y,
      vx: 0,
      vy: 0,
      targetX: node.x,
      targetY: node.y,
      clusters: node.clusters,
    }));
    this.allLinks = data.links.map((link) => ({
      id: link.id,
      source: link.source,
      target: link.target,
      kind: link.kind,
      sourceType: link.sourceType,
      strength: link.strength,
    }));
    this.rebuildVisibleGraph();
    this.fitView();
  }

  setClusterMode(mode: GraphClusterMode) {
    this.clusterMode = mode;
    this.assignTargets();
  }

  setShowAuthoredOnly(showAuthoredOnly: boolean) {
    this.showAuthoredOnly = showAuthoredOnly;
    this.rebuildVisibleGraph();
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  resize(width: number, height: number, dpr: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    void dpr;
    this.assignTargets();
  }

  tick(dtMs: number) {
    if (this.nodes.length === 0) {
      return false;
    }

    if (this.paused && !this.draggingNodeId) {
      return false;
    }

    const step = Math.min(1.8, Math.max(0.45, dtMs / 16));
    this.assignTargets();

    const nodeById = new Map(this.nodes.map((node) => [node.id, node]));
    for (const node of this.nodes) {
      const attraction = node.id === this.draggingNodeId ? 0.38 : 0.012;
      node.vx += (node.targetX - node.x) * attraction * step;
      node.vy += (node.targetY - node.y) * attraction * step;
    }

    for (const link of this.links) {
      const source = nodeById.get(link.source);
      const target = nodeById.get(link.target);
      if (!source || !target) {
        continue;
      }

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const desired = 72 + (1 - link.strength) * 48;
      const force = ((distance - desired) / distance) * (0.02 + link.strength * 0.025) * step;
      const fx = dx * force;
      const fy = dy * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }

    for (let leftIndex = 0; leftIndex < this.nodes.length; leftIndex += 1) {
      const left = this.nodes[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < this.nodes.length; rightIndex += 1) {
        const right = this.nodes[rightIndex];
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distanceSq = Math.max(16, dx * dx + dy * dy);
        const distance = Math.sqrt(distanceSq);
        const minGap = left.radius + right.radius + 18;
        const repel = (distance < minGap ? 0.34 : 0.09) * step;
        const fx = (dx / distance) * (repel * 1600) / distanceSq;
        const fy = (dy / distance) * (repel * 1600) / distanceSq;
        left.vx -= fx;
        left.vy -= fy;
        right.vx += fx;
        right.vy += fy;

        if (distance < minGap) {
          const overlap = ((minGap - distance) / distance) * 0.2 * step;
          left.vx -= dx * overlap;
          left.vy -= dy * overlap;
          right.vx += dx * overlap;
          right.vy += dy * overlap;
        }
      }
    }

    let moved = false;
    for (const node of this.nodes) {
      if (node.id === this.draggingNodeId && this.lastPointerWorld) {
        node.x = this.lastPointerWorld.x;
        node.y = this.lastPointerWorld.y;
        node.vx = 0;
        node.vy = 0;
        moved = true;
        continue;
      }

      node.vx *= 0.86;
      node.vy *= 0.86;
      node.x += node.vx * step;
      node.y += node.vy * step;
      if (Math.abs(node.vx) > 0.015 || Math.abs(node.vy) > 0.015) {
        moved = true;
      }
    }

    return moved;
  }

  getSnapshot(): GraphSnapshot {
    const nodeById = new Map(this.nodes.map((node) => [node.id, node]));

    return {
      viewport: this.viewport,
      hoveredNodeId: this.hoveredNodeId,
      selectedNodeId: this.selectedNodeId,
      nodes: this.nodes.map((node) => ({
        id: node.id,
        x: node.x,
        y: node.y,
        radius: node.radius,
        label: node.label,
        eventType: node.eventType,
        status: node.status,
      })),
      links: this.links.flatMap((link) => {
        const source = nodeById.get(link.source);
        const target = nodeById.get(link.target);
        if (!source || !target) {
          return [];
        }

        return [
          {
            id: link.id,
            sourceX: source.x,
            sourceY: source.y,
            targetX: target.x,
            targetY: target.y,
            kind: link.kind,
            sourceType: link.sourceType,
          },
        ];
      }),
    };
  }

  pointerDown(x: number, y: number, button: number, shift: boolean, meta: boolean): GraphInteractionEvent[] {
    const world = this.toWorld(x, y);
    void shift;
    void meta;
    this.lastPointerWorld = world;
    this.lastPointerScreen = { x, y };
    this.pointerDownScreen = { x, y };
    const hit = this.findNodeAt(world.x, world.y);
    if (button === 0 && hit) {
      this.pendingNodeSelectionId = hit.id;
      return [];
    }

    this.pendingNodeSelectionId = null;
    this.panning = true;
    this.hoveredNodeId = null;
    return [{ type: "dragStateChanged", dragging: true }];
  }

  pointerMove(x: number, y: number): GraphInteractionEvent[] {
    const world = this.toWorld(x, y);
    const events: GraphInteractionEvent[] = [];

    if (this.pendingNodeSelectionId && !this.draggingNodeId && this.pointerDownScreen) {
      const dx = x - this.pointerDownScreen.x;
      const dy = y - this.pointerDownScreen.y;
      const dragThreshold = 6;
      if (Math.hypot(dx, dy) >= dragThreshold) {
        this.draggingNodeId = this.pendingNodeSelectionId;
        events.push({ type: "dragStateChanged", dragging: true });
      }
    }

    if (this.draggingNodeId) {
      this.lastPointerWorld = world;
      const draggedNode = this.nodes.find((node) => node.id === this.draggingNodeId);
      if (draggedNode) {
        draggedNode.x = world.x;
        draggedNode.y = world.y;
        draggedNode.vx = 0;
        draggedNode.vy = 0;
      }
      return events;
    }

    if (this.panning && this.lastPointerScreen) {
      this.viewport.x += x - this.lastPointerScreen.x;
      this.viewport.y += y - this.lastPointerScreen.y;
      this.lastPointerScreen = { x, y };
      events.push({ type: "viewportChanged", viewport: this.viewport });
      return events;
    }

    const hit = this.findNodeAt(world.x, world.y);
    const nextHovered = hit?.id ?? null;
    if (nextHovered !== this.hoveredNodeId) {
      this.hoveredNodeId = nextHovered;
      events.push({ type: "hoverChanged", nodeId: nextHovered });
    }

    return events;
  }

  pointerUp(x: number, y: number): GraphInteractionEvent[] {
    this.lastPointerWorld = null;
    this.lastPointerScreen = null;
    this.pointerDownScreen = null;
    const events: GraphInteractionEvent[] = [];
    if (this.draggingNodeId || this.panning) {
      events.push({ type: "dragStateChanged", dragging: false });
    }
    if (this.pendingNodeSelectionId && !this.draggingNodeId) {
      this.selectedNodeId = this.pendingNodeSelectionId;
      events.push({ type: "selectionChanged", nodeId: this.pendingNodeSelectionId });
    }
    this.pendingNodeSelectionId = null;
    this.draggingNodeId = null;
    this.panning = false;
    this.pointerMove(x, y);
    return events;
  }

  wheel(x: number, y: number, _deltaX: number, deltaY: number, ctrl: boolean): GraphInteractionEvent[] {
    const zoomFactor = ctrl ? 1.0016 : 1.0011;
    const nextScale = clamp(this.viewport.scale * Math.pow(zoomFactor, -deltaY), 0.28, 2.8);
    const before = this.toWorld(x, y);
    this.viewport.scale = nextScale;
    const after = this.toWorld(x, y);
    this.viewport.x += (after.x - before.x) * nextScale;
    this.viewport.y += (after.y - before.y) * nextScale;

    return [{ type: "viewportChanged", viewport: this.viewport }];
  }

  fitView(): GraphInteractionEvent[] {
    const metrics = this.getFitMetrics();
    if (!metrics) {
      return [];
    }

    const boundsWidth = Math.max(120, metrics.maxX - metrics.minX);
    const boundsHeight = Math.max(120, metrics.maxY - metrics.minY);
    const padding = 96;
    const availableWidth = Math.max(160, this.width - padding * 2);
    const availableHeight = Math.max(160, this.height - padding * 2);
    const scale = clamp(Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight), 0.25, 2.4);

    this.viewport = {
      scale,
      x: this.width / 2 - metrics.centerX * scale,
      y: this.height / 2 - metrics.centerY * scale,
    };

    return [{ type: "viewportChanged", viewport: this.viewport }];
  }

  selectNode(nodeId: string | null): GraphInteractionEvent[] {
    this.selectedNodeId = nodeId;
    return [{ type: "selectionChanged", nodeId }];
  }

  applyOps(opsJson: string) {
    void opsJson;
    return;
  }

  destroy() {
    this.nodes = [];
    this.links = [];
  }

  private rebuildVisibleGraph() {
    const visibleLinks = this.showAuthoredOnly
      ? this.allLinks.filter((link) => link.sourceType === "authored")
      : this.allLinks;
    const visibleNodeIds = new Set<string>();
    for (const link of visibleLinks) {
      visibleNodeIds.add(link.source);
      visibleNodeIds.add(link.target);
    }

    this.links = visibleLinks.map((link) => ({ ...link }));
    this.nodes = this.allNodes
      .filter((node) => !this.showAuthoredOnly || visibleNodeIds.has(node.id))
      .map((node) => ({ ...node }));

    if (this.nodes.length === 0) {
      this.nodes = this.allNodes.map((node) => ({ ...node }));
    }

    this.assignTargets();
  }

  private assignTargets() {
    if (this.clusterMode === "none") {
      return;
    }

    const clusterMembers = new Map<string, InternalNode[]>();
    for (const node of this.nodes) {
      const key = this.getClusterKey(node);
      const existing = clusterMembers.get(key);
      if (existing) {
        existing.push(node);
      } else {
        clusterMembers.set(key, [node]);
      }
    }

    const orderedKeys = Array.from(clusterMembers.keys()).sort((left, right) => left.localeCompare(right));
    const radius = Math.max(220, Math.min(this.width, this.height) * 0.34);
    const centers = new Map<string, { x: number; y: number }>();

    for (let index = 0; index < orderedKeys.length; index += 1) {
      const angle = (-Math.PI / 2) + (index / Math.max(1, orderedKeys.length)) * Math.PI * 2;
      centers.set(orderedKeys[index], {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }

    for (const key of orderedKeys) {
      const center = centers.get(key) ?? { x: 0, y: 0 };
      const members = [...(clusterMembers.get(key) ?? [])].sort((left, right) => left.id.localeCompare(right.id));
      const ringStep = 52;
      const maxPerRing = 10;

      for (let index = 0; index < members.length; index += 1) {
        const node = members[index];
        const ring = Math.floor(index / maxPerRing);
        const indexInRing = index % maxPerRing;
        const slotsInRing = Math.min(maxPerRing, members.length - ring * maxPerRing);
        const seed = hashNodeId(node.id);
        const baseAngle = ((seed % 360) * Math.PI) / 180;
        const angle = baseAngle + (indexInRing / Math.max(1, slotsInRing)) * Math.PI * 2;
        const orbitRadius = 24 + ring * ringStep + (seed % 17);
        node.targetX = center.x + Math.cos(angle) * orbitRadius;
        node.targetY = center.y + Math.sin(angle) * orbitRadius;
      }
    }
  }

  private getClusterKey(node: InternalNode) {
    if (this.clusterMode === "eventType") {
      return node.clusters.eventType;
    }

    if (this.clusterMode === "status") {
      return node.clusters.status;
    }

    if (this.clusterMode === "month") {
      return node.clusters.month;
    }

    if (this.clusterMode === "trainingBlock") {
      return node.clusters.trainingBlock;
    }

    return "all";
  }

  private findNodeAt(x: number, y: number) {
    for (let index = this.nodes.length - 1; index >= 0; index -= 1) {
      const node = this.nodes[index];
      if (Math.hypot(node.x - x, node.y - y) <= node.radius + 8) {
        return node;
      }
    }
    return null;
  }

  private toWorld(screenX: number, screenY: number) {
    return {
      x: (screenX - this.viewport.x) / this.viewport.scale,
      y: (screenY - this.viewport.y) / this.viewport.scale,
    };
  }

  private getFitMetrics() {
    if (this.nodes.length === 0) {
      return null;
    }

    const leftEdges = this.nodes.map((node) => node.x - node.radius).sort((left, right) => left - right);
    const topEdges = this.nodes.map((node) => node.y - node.radius).sort((left, right) => left - right);
    const rightEdges = this.nodes.map((node) => node.x + node.radius).sort((left, right) => left - right);
    const bottomEdges = this.nodes.map((node) => node.y + node.radius).sort((left, right) => left - right);
    const centerXs = this.nodes.map((node) => node.x).sort((left, right) => left - right);
    const centerYs = this.nodes.map((node) => node.y).sort((left, right) => left - right);

    const trimCount = this.nodes.length >= 80 ? Math.min(Math.floor(this.nodes.length * 0.05), 20) : 0;
    const maxIndex = this.nodes.length - 1;
    const minIndex = Math.min(trimCount, maxIndex);
    const trimmedMaxIndex = Math.max(0, maxIndex - trimCount);

    let minX = leftEdges[minIndex];
    let minY = topEdges[minIndex];
    let maxX = rightEdges[trimmedMaxIndex];
    let maxY = bottomEdges[trimmedMaxIndex];

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY) || minX >= maxX || minY >= maxY) {
      minX = leftEdges[0];
      minY = topEdges[0];
      maxX = rightEdges[maxIndex];
      maxY = bottomEdges[maxIndex];
    }

    const centerIndex = Math.floor((minIndex + trimmedMaxIndex) / 2);
    const centerX = centerXs[centerIndex];
    const centerY = centerYs[centerIndex];

    return { minX, minY, maxX, maxY, centerX, centerY };
  }

}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function hashNodeId(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}
