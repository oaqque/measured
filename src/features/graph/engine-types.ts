import type {
  GraphClusterMode,
  GraphInteractionEvent,
  GraphSnapshot,
  NoteGraphData,
} from "@/lib/graph/schema";

export interface GraphEngineController {
  setGraph(data: NoteGraphData): void;
  setClusterMode(mode: GraphClusterMode): void;
  setShowAuthoredOnly(showAuthoredOnly: boolean): void;
  setPaused(paused: boolean): void;
  resize(width: number, height: number, dpr: number): void;
  tick(dtMs: number): boolean;
  getSnapshot(): GraphSnapshot;
  pointerDown(x: number, y: number, button: number, shift: boolean, meta: boolean): GraphInteractionEvent[];
  pointerMove(x: number, y: number): GraphInteractionEvent[];
  pointerUp(x: number, y: number): GraphInteractionEvent[];
  wheel(x: number, y: number, deltaX: number, deltaY: number, ctrl: boolean): GraphInteractionEvent[];
  fitView(): GraphInteractionEvent[];
  selectNode(nodeId: string | null): GraphInteractionEvent[];
  applyOps(opsJson: string): void;
  destroy(): void;
}
