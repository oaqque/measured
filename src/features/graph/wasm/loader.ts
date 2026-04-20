import type { GraphEngineController } from "@/features/graph/engine-types";
import type { GraphClusterMode, GraphInteractionEvent, GraphSnapshot, NoteGraphData } from "@/lib/graph/schema";

type GraphModuleState = {
  createEngine: (data: NoteGraphData) => GraphEngineController;
  usingFallback: boolean;
};

type WasmGraphEngineInstance = {
  set_graph: (graphJson: string) => void;
  set_cluster_mode: (mode: string) => void;
  set_show_authored_only: (showAuthoredOnly: boolean) => void;
  set_paused: (paused: boolean) => void;
  resize: (width: number, height: number, dpr: number) => void;
  tick: (dtMs: number) => boolean;
  get_snapshot_json: () => string;
  pointer_down: (x: number, y: number, button: number, shift: boolean, meta: boolean) => string;
  pointer_move: (x: number, y: number) => string;
  pointer_up: (x: number, y: number) => string;
  wheel: (x: number, y: number, deltaX: number, deltaY: number, ctrl: boolean) => string;
  pan_by: (deltaX: number, deltaY: number) => string;
  zoom_at: (x: number, y: number, scaleMultiplier: number) => string;
  cancel_interaction: () => string;
  fit_view: () => string;
  select_node: (nodeId: string | null | undefined) => string;
  apply_ops: (opsJson: string) => void;
  free?: () => void;
};

type WasmGraphModule = {
  default?: (input?: string | URL | Request | Response | BufferSource | WebAssembly.Module) => Promise<unknown>;
  GraphEngine?: new (graphJson: string) => WasmGraphEngineInstance;
};

export async function loadGraphEngineModule(): Promise<GraphModuleState> {
  const moduleUrl = new URL("./pkg/note_graph_wasm.js", import.meta.url);
  const wasmUrl = new URL("./pkg/note_graph_wasm_bg.wasm", import.meta.url);
  const wasmModule = (await import(/* @vite-ignore */ moduleUrl.href)) as WasmGraphModule;

  if (typeof wasmModule.default === "function") {
    await wasmModule.default(wasmUrl);
  }

  if (typeof wasmModule.GraphEngine !== "function") {
    throw new Error("Generated note graph WASM package is missing GraphEngine exports.");
  }

  return {
    createEngine: (data) => createWasmGraphEngine(wasmModule.GraphEngine as new (graphJson: string) => WasmGraphEngineInstance, data),
    usingFallback: false,
  };
}

function createWasmGraphEngine(
  GraphEngineClass: new (graphJson: string) => WasmGraphEngineInstance,
  data: NoteGraphData,
): GraphEngineController {
  const engine = new GraphEngineClass(JSON.stringify(data));

  return {
    setGraph(nextData: NoteGraphData) {
      engine.set_graph(JSON.stringify(nextData));
    },
    setClusterMode(mode: GraphClusterMode) {
      engine.set_cluster_mode(mode);
    },
    setShowAuthoredOnly(showAuthoredOnly: boolean) {
      engine.set_show_authored_only(showAuthoredOnly);
    },
    setPaused(paused: boolean) {
      engine.set_paused(paused);
    },
    resize(width: number, height: number, dpr: number) {
      engine.resize(width, height, dpr);
    },
    tick(dtMs: number) {
      return engine.tick(dtMs);
    },
    getSnapshot() {
      return parseJson<GraphSnapshot>(engine.get_snapshot_json());
    },
    pointerDown(x: number, y: number, button: number, shift: boolean, meta: boolean) {
      return parseEvents(engine.pointer_down(x, y, button, shift, meta));
    },
    pointerMove(x: number, y: number) {
      return parseEvents(engine.pointer_move(x, y));
    },
    pointerUp(x: number, y: number) {
      return parseEvents(engine.pointer_up(x, y));
    },
    wheel(x: number, y: number, deltaX: number, deltaY: number, ctrl: boolean) {
      return parseEvents(engine.wheel(x, y, deltaX, deltaY, ctrl));
    },
    panBy(deltaX: number, deltaY: number) {
      return parseEvents(engine.pan_by(deltaX, deltaY));
    },
    zoomAt(x: number, y: number, scaleMultiplier: number) {
      return parseEvents(engine.zoom_at(x, y, scaleMultiplier));
    },
    cancelInteraction() {
      return parseEvents(engine.cancel_interaction());
    },
    fitView() {
      return parseEvents(engine.fit_view());
    },
    selectNode(nodeId: string | null) {
      return parseEvents(engine.select_node(nodeId));
    },
    applyOps(opsJson: string) {
      engine.apply_ops(opsJson);
    },
    destroy() {
      engine.free?.();
    },
  };
}

function parseEvents(raw: string) {
  return parseJson<GraphInteractionEvent[]>(raw);
}

function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}
