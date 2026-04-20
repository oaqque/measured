# Note Graph WASM Plan

## Goal

Add a new interactive graph view to `measured` where:

- workout notes render as floating nodes on a canvas
- note relationships render as links
- the layout reflows automatically as nodes and links change
- the selected node reuses the existing note-detail UI
- a floating chat bar can interpret graph commands by talking to a local `codex app-server` integration in this repo

This plan is intentionally split into:

- a browser-safe graph viewer that can ship inside the existing Vite app
- a local sidecar chat backend that can run `codex app-server` and stream results into the viewer

The second part is local-only unless `measured` later gains a trusted server runtime. The current app is otherwise a static frontend plus generated JSON.

## Current Repo Fit

These existing files are the anchor points:

- [src/App.tsx](/home/willye/Workspace/measured/src/App.tsx:1)
  current top-level route/view shell
- [src/lib/workouts/load.ts](/home/willye/Workspace/measured/src/lib/workouts/load.ts:1)
  in-memory access to generated workout data
- [src/lib/workouts/schema.ts](/home/willye/Workspace/measured/src/lib/workouts/schema.ts:1)
  public workout-note types
- [src/components/WorkoutNotePane.tsx](/home/willye/Workspace/measured/src/components/WorkoutNotePane.tsx:1)
  existing detail pane to reuse for node selection
- [scripts/build-workouts-data.ts](/home/willye/Workspace/measured/scripts/build-workouts-data.ts:1)
  existing training-data build pipeline
- [vite.config.ts](/home/willye/Workspace/measured/vite.config.ts:1)
  current Vite dev server and future proxy point

The existing generated workout dataset is already enough for nodes. It is not enough for durable graph edges. There is no first-class authored note-link dataset today.

## Scope Decisions

### 1. Keep note links out of the workout-note schema in v1

Do not add `links` directly to every note JSON document yet.

Instead add a dedicated authored graph file under `data/training/`:

- `data/training/graph-links.json`

This keeps graph relationship editing isolated from workout-note editing and matches the repo rule that authored publishable data should live under `data/training/**`.

Suggested shape:

```json
{
  "schemaVersion": 1,
  "links": [
    {
      "sourceSlug": "2026-04-01-10-km-threshold-run",
      "targetSlug": "2026-04-21-10-km-threshold-run",
      "kind": "progression",
      "weight": 1,
      "label": "same workout family"
    }
  ]
}
```

### 2. Use Rust + WASM only for the graph engine

Rust/WASM owns:

- force simulation
- clustering forces
- viewport transforms
- hit testing
- node dragging
- canvas rendering

React owns:

- route/view selection
- toolbar and chat bar
- note detail pane
- persistence and network calls

### 3. Use `codex app-server` over `stdio`, not WebSocket, for the local sidecar

Per the official docs, app-server supports JSON-RPC 2.0 over `stdio` by default and `websocket` as experimental transport. For this repo, use `stdio` first and keep the browser isolated behind a small Node sidecar.

Why:

- `stdio` is the default documented transport
- the browser cannot safely own API keys or ChatGPT auth state
- the browser cannot spawn local processes
- the repo already uses `tsx` scripts for local services

### 4. Use structured graph operations before dynamic tools

The docs expose `dynamicTools`, but they are explicitly experimental. For v1, send a structured `outputSchema` with each `turn/start` and require Codex to return:

- assistant text
- zero or more graph operations
- optional persistence suggestions

That keeps the client simple and avoids experimental tool-call handling in the first pass.

## Architecture

### Frontend

The new graph view lives inside the existing React app.

Flow:

1. React loads `allWorkouts` and `note-graph.json`.
2. React mounts a `GraphCanvas` host.
3. `GraphCanvas` boots the Rust/WASM engine and hands it the graph payload.
4. The engine runs the simulation and draws into `<canvas>`.
5. React listens for selection and hover events from the engine.
6. The selected node opens the existing `WorkoutNotePane`.
7. The floating chat bar posts user intent to the local chat sidecar.
8. The sidecar talks to `codex app-server`, streams responses back, and the frontend applies returned graph ops.

### Local Chat Sidecar

This is a new repo-local Node service.

Flow:

1. Spawn `codex app-server`.
2. Send `initialize`.
3. Send `initialized`.
4. Authenticate once.
5. Create or resume a thread for the graph session.
6. For each chat input, call `turn/start`.
7. Stream `item/*` notifications to the browser over SSE.
8. Parse the final structured response and return graph operations.

### Persistence

The graph should support three persistence levels:

- runtime only
  temporary drag positions, viewport, local filters
- local durable session
  browser `localStorage` for viewport and last-open node
- authored graph data
  `data/training/graph-links.json`

The chat sidecar should not edit authored files directly in phase 1. It should return proposed mutations, and the measured-side server should own file writes.

## Exact File Plan

### New Authored Data

- `data/training/graph-links.json`
  source of truth for explicit note-to-note edges

### New Generated Data

- `src/generated/note-graph.json`
  public graph payload consumed by the app

Suggested payload:

```json
{
  "generatedAt": "2026-04-20T00:00:00.000Z",
  "nodes": [],
  "links": [],
  "clusters": []
}
```

### Frontend Files To Add

- `src/lib/graph/schema.ts`
  public TS types for nodes, links, clusters, chat ops, and persistence payloads
- `src/lib/graph/load.ts`
  loader helpers around `note-graph.json`
- `src/lib/graph/chat-schema.ts`
  Zod-free plain TS schema helpers for chat result validation
- `src/features/graph/GraphView.tsx`
  top-level graph screen
- `src/features/graph/GraphCanvas.tsx`
  canvas host plus resize loop
- `src/features/graph/useGraphWasm.ts`
  lazy-load and lifecycle wrapper for the Rust package
- `src/features/graph/useGraphSession.ts`
  local UI/session state
- `src/features/graph/GraphToolbar.tsx`
  cluster mode, filters, fit-to-screen, pause layout
- `src/features/graph/GraphChatBar.tsx`
  floating prompt UI and streaming transcript
- `src/features/graph/graph-ops.ts`
  applies Codex-returned ops to local graph state

### Rust/WASM Files To Add

- `apps/note-graph-wasm/Cargo.toml`
- `apps/note-graph-wasm/src/lib.rs`
- `apps/note-graph-wasm/src/types.rs`
- `apps/note-graph-wasm/src/layout.rs`
- `apps/note-graph-wasm/src/render.rs`
- `apps/note-graph-wasm/src/input.rs`
- `apps/note-graph-wasm/src/viewport.rs`

Recommended export surface:

```rust
#[wasm_bindgen]
pub struct GraphEngine;

#[wasm_bindgen]
impl GraphEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(canvas: web_sys::HtmlCanvasElement) -> Result<GraphEngine, JsValue>;
    pub fn set_graph(&mut self, graph_json: &str) -> Result<(), JsValue>;
    pub fn resize(&mut self, width: f64, height: f64, dpr: f64);
    pub fn tick(&mut self, dt_ms: f64) -> bool;
    pub fn render(&self);
    pub fn pointer_down(&mut self, x: f64, y: f64, button: u8, shift: bool, meta: bool) -> JsValue;
    pub fn pointer_move(&mut self, x: f64, y: f64) -> JsValue;
    pub fn pointer_up(&mut self, x: f64, y: f64) -> JsValue;
    pub fn wheel(&mut self, x: f64, y: f64, delta_x: f64, delta_y: f64, ctrl: bool) -> JsValue;
    pub fn apply_ops(&mut self, ops_json: &str) -> Result<(), JsValue>;
}
```

### Local Chat Sidecar Files To Add

- `scripts/run-graph-chat-server.ts`
  repo-local HTTP + SSE server for the graph chat UI
- `scripts/codex-app-server/rpc.ts`
  newline JSON-RPC framing, request ids, pending request map
- `scripts/codex-app-server/session.ts`
  process spawn, initialize handshake, auth, thread lifecycle
- `scripts/codex-app-server/types.ts`
  narrow TS types for the subset of app-server messages this repo uses
- `scripts/codex-app-server/graph-prompts.ts`
  system/developer prompt blocks and output schema builders

### Existing Files To Modify

- `package.json`
  add graph build and dev scripts
- `vite.config.ts`
  dev proxy for the local chat sidecar
- `src/App.tsx`
  add a `"graph"` view and navigation entry
- `src/index.css`
  graph canvas and floating chat styles
- `scripts/build-workouts-data.ts`
  no changes if a separate graph build script is used
- or add `scripts/build-note-graph-data.ts`
  if graph data generation stays separate from workout generation

## Preferred Build Layout

Use a separate graph build script instead of expanding the already-large workout build script.

Add:

- `scripts/build-note-graph-data.ts`

And update `package.json`:

- `build:data`
  run workout build, then graph build
- `graph:build:wasm`
  run `wasm-pack build apps/note-graph-wasm --target web --out-dir pkg`
- `graph:dev:chat`
  run `tsx scripts/run-graph-chat-server.ts`

## Graph Data Build

`scripts/build-note-graph-data.ts` should:

1. Read `src/generated/workouts.json`.
2. Read `data/training/graph-links.json`.
3. Create node records from workouts.
4. Validate that every link slug resolves to a known workout.
5. Derive optional secondary edges:
   - `planAdjacency`
   - `sameEventType`
   - `sharedProvider`
6. Mark authored links separately from derived links.
7. Write `src/generated/note-graph.json`.

Suggested node fields:

- `slug`
- `title`
- `date`
- `eventType`
- `completed`
- `sourcePath`
- `x`
- `y`
- `radius`
- `clusterKey`
- `tags`

Suggested link fields:

- `id`
- `source`
- `target`
- `kind`
- `strength`
- `authored`
- `label`

## WASM Graph Engine Responsibilities

### Layout

Implement a force-directed layout with:

- center force
- link force
- collision force
- charge force
- cluster attraction force

Cluster modes:

- `none`
- `eventType`
- `status`
- `month`
- `trainingBlock`

### Rendering

Use canvas 2D first.

Render:

- link lines
- node circles or rounded lozenges
- selected halo
- hovered halo
- label text with culling at low zoom
- cluster headers when zoomed in enough

### Interaction

Support:

- wheel zoom
- click-to-select
- drag node
- drag background to pan
- double click to center node
- keyboard shortcut to fit graph

### React Boundary

Rust should emit only compact interaction events:

- `hoverChanged`
- `selectionChanged`
- `viewportChanged`
- `dragStateChanged`

React should remain the source of truth for:

- selected workout slug
- filter state
- cluster mode
- chat transcript
- persisted authored graph changes

## Chat Integration Plan

### Why A Sidecar Is Required

The official app-server docs describe a bidirectional JSON-RPC connection over `stdio` or experimental WebSocket. The browser cannot safely own that process, auth state, or file permissions. `measured` therefore needs a local bridge process.

### Sidecar API

Expose a tiny local API:

- `GET /health`
  sidecar health and auth status
- `POST /session`
  create or resume a graph chat session
- `GET /session/:id/events`
  SSE stream of assistant output and turn events
- `POST /session/:id/message`
  send a chat message
- `POST /session/:id/interrupt`
  cancel the active turn
- `POST /graph/ops/apply`
  persist approved graph mutations to `data/training/graph-links.json`

### App-Server RPC Sequence

On startup:

1. spawn `codex app-server`
2. send `initialize`
3. send `initialized`
4. authenticate

Per browser session:

1. call `thread/start`
2. keep returned `thread.id`
3. call `turn/start` for each message
4. stream `item/agentMessage/delta`, `item/started`, and `item/completed`
5. optionally use `turn/steer` for follow-up text while a turn is active

### Auth Choice

Use API-key auth first.

Why:

- it is simpler than browser-mediated ChatGPT OAuth
- the docs show a direct `account/login/start` call with an API-key payload such as `{ "type": "apiKey", "apiKey": "<api-key>" }`
- it avoids building callback handling into the sidecar on day one

Defer ChatGPT login support until after the graph UI is stable.

### Turn Contract

Every graph-chat turn should send:

- current selected node slug
- current visible node ids
- current authored links touching the selection
- a concise user message
- a strict `outputSchema`

Suggested structured response:

```json
{
  "assistantText": "I linked the two threshold sessions as a progression.",
  "ops": [
    {
      "op": "createLink",
      "sourceSlug": "2026-04-01-10-km-threshold-run",
      "targetSlug": "2026-04-21-10-km-threshold-run",
      "kind": "progression",
      "label": "same workout family"
    },
    {
      "op": "focusNode",
      "slug": "2026-04-21-10-km-threshold-run"
    }
  ],
  "needsConfirmation": true
}
```

### Why Not Dynamic Tools In Phase 1

The docs mark `dynamicTools` as experimental. Use structured output first. Once the baseline is stable, phase 4 can add optional dynamic tools for:

- `graph.focusNode`
- `graph.createLink`
- `graph.removeLink`
- `graph.setClusterMode`
- `graph.fitView`

## Persistence Rules

### Runtime Graph State

Do not write drag positions back into authored files.

Keep in browser storage only:

- viewport transform
- node pinning
- panel open/closed state
- last cluster mode

### Authored Graph Changes

Only explicit user-approved mutations should touch `data/training/graph-links.json`.

Persisted operations:

- `createLink`
- `removeLink`
- optional `updateLink`

Do not let Codex write node records directly in phase 1. Nodes come from existing workout notes.

## UI Integration

### Route and Layout

Add a new `graph` view to `App.tsx`.

Desktop:

- graph canvas in the main pane
- selected note opens in the existing right detail pane

Mobile:

- graph takes the full content area
- selected note opens in the existing sheet pattern

### Chat Bar

The floating chat bar should:

- stay anchored near the bottom center of the canvas
- collapse to one line when idle
- expand into a small transcript on focus or while streaming
- show connection status
- show interrupt while a turn is in progress
- show “apply changes” only when returned ops require confirmation

### Empty and Degraded States

If the sidecar is unavailable:

- keep the graph fully usable
- disable the chat bar send action
- show “Local Codex backend unavailable”

If WASM fails to load:

- fall back to a React-rendered placeholder with a retry affordance
- do not crash the rest of the app

## Phase Plan

### Phase 0: Graph Data And Route Wiring

Deliverables:

- `data/training/graph-links.json`
- `scripts/build-note-graph-data.ts`
- `src/generated/note-graph.json`
- `src/lib/graph/schema.ts`
- `src/lib/graph/load.ts`
- `src/App.tsx` graph route shell

Exit criteria:

- graph route loads
- selected workout slug can be driven from graph state
- generated graph artifact builds cleanly

### Phase 1: Rust/WASM Canvas Viewer

Deliverables:

- Rust crate under `apps/note-graph-wasm/`
- `GraphCanvas.tsx`
- `useGraphWasm.ts`
- pan, zoom, select, drag, auto-layout

Exit criteria:

- 300+ nodes render smoothly
- selection syncs with `WorkoutNotePane`
- layout restabilizes after adding or removing links in memory

### Phase 2: Local Sidecar + Streaming Chat

Deliverables:

- `scripts/run-graph-chat-server.ts`
- app-server JSON-RPC wrapper
- SSE stream to frontend
- floating chat bar UI

Exit criteria:

- user can send a prompt
- sidecar streams assistant text
- final turn returns structured graph ops

### Phase 3: Authored Link Persistence

Deliverables:

- `POST /graph/ops/apply`
- mutation writer for `data/training/graph-links.json`
- optimistic UI plus rollback on write failure

Exit criteria:

- approved `createLink` and `removeLink` ops persist
- `build:data` regenerates graph artifact correctly

### Phase 4: Optional Dynamic Tools

Deliverables:

- experimental `dynamicTools` support on `thread/start`
- browser-side responses for graph actions

Exit criteria:

- Codex can call graph tools directly
- structured-output path remains as fallback

## Risks

### 1. Static-Site Deployment Mismatch

The graph viewer can ship in the existing frontend, but the Codex chat sidecar cannot run on the current static deployment model. Treat chat as local-only until the repo adds a trusted runtime.

### 2. Overloading The Workout Schema

Avoid mixing graph-authoring concerns into every note file too early.

### 3. WASM Build Friction

Rust + `wasm-pack` adds toolchain cost. Keep the Rust surface small and stable.

### 4. Experimental App-Server Features

Do not make `dynamicTools` a hard dependency in the first implementation.

## Acceptance Criteria

- `measured` has a graph view reachable from the main app shell
- all workouts render as graph nodes from generated public data
- explicit note links come from `data/training/graph-links.json`
- the graph auto-rearranges when links change
- selecting a node opens the existing note detail UI
- a local chat bar can stream Codex output through a repo-local sidecar
- Codex responses can propose graph mutations as structured ops
- approved ops can persist back into authored graph-link data

## References

Verified on 2026-04-20 against the official OpenAI docs:

- `codex app-server` protocol uses bidirectional JSON-RPC 2.0 over `stdio` by default, with WebSocket marked experimental:
  https://developers.openai.com/codex/app-server
- `initialize` then `initialized` are required before other methods:
  https://developers.openai.com/codex/app-server
- thread lifecycle uses `thread/start` and `thread/resume`:
  https://developers.openai.com/codex/app-server
- turn lifecycle uses `turn/start`, `turn/steer`, streamed `item/*` events, and `outputSchema`:
  https://developers.openai.com/codex/app-server
- auth modes include API key, ChatGPT-managed auth, and externally managed ChatGPT tokens:
  https://developers.openai.com/codex/app-server
- `dynamicTools` are available but experimental:
  https://developers.openai.com/codex/app-server
