mod input;
mod layout;
mod render;
mod types;
mod viewport;

use types::{GraphInteractionEvent, GraphOp, GraphState, LoadedGraph};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct GraphEngine {
    state: GraphState,
}

#[wasm_bindgen]
impl GraphEngine {
    #[wasm_bindgen(constructor)]
    pub fn new(graph_json: &str) -> Result<GraphEngine, JsValue> {
        let graph = serde_json::from_str::<LoadedGraph>(graph_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(Self {
            state: GraphState::from_loaded_graph(graph),
        })
    }

    pub fn set_graph(&mut self, graph_json: &str) -> Result<(), JsValue> {
        let graph = serde_json::from_str::<LoadedGraph>(graph_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.state = GraphState::from_loaded_graph(graph);
        Ok(())
    }

    pub fn set_cluster_mode(&mut self, mode: &str) {
        self.state.cluster_mode = mode.to_string();
        self.state.assign_targets();
    }

    pub fn set_show_authored_only(&mut self, show_authored_only: bool) {
        self.state.show_authored_only = show_authored_only;
        self.state.rebuild_visible_graph();
    }

    pub fn set_paused(&mut self, paused: bool) {
        self.state.paused = paused;
    }

    pub fn resize(&mut self, width: f64, height: f64, _dpr: f64) {
        self.state.resize(width, height);
    }

    pub fn tick(&mut self, dt_ms: f64) -> bool {
        self.state.tick_layout(dt_ms)
    }

    pub fn get_snapshot_json(&self) -> Result<String, JsValue> {
        serde_json::to_string(&self.snapshot()).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    pub fn pointer_down(
        &mut self,
        x: f64,
        y: f64,
        button: u8,
        shift: bool,
        meta: bool,
    ) -> Result<String, JsValue> {
        serialize_events(self.state.pointer_down(x, y, button, shift, meta))
    }

    pub fn pointer_move(&mut self, x: f64, y: f64) -> Result<String, JsValue> {
        serialize_events(self.state.pointer_move(x, y))
    }

    pub fn pointer_up(&mut self, x: f64, y: f64) -> Result<String, JsValue> {
        serialize_events(self.state.pointer_up(x, y))
    }

    pub fn wheel(
        &mut self,
        x: f64,
        y: f64,
        delta_x: f64,
        delta_y: f64,
        ctrl: bool,
    ) -> Result<String, JsValue> {
        serialize_events(self.state.wheel(x, y, delta_x, delta_y, ctrl))
    }

    pub fn fit_view(&mut self) -> Result<String, JsValue> {
        serialize_events(self.state.fit_view())
    }

    pub fn select_node(&mut self, node_id: Option<String>) -> Result<String, JsValue> {
        serialize_events(self.state.select_node(node_id))
    }

    pub fn apply_ops(&mut self, ops_json: &str) -> Result<(), JsValue> {
        let ops = serde_json::from_str::<Vec<GraphOp>>(ops_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;

        for op in ops {
            match op {
                GraphOp::CreateLink {
                    sourceSlug,
                    targetSlug,
                    kind,
                    strength,
                } => {
                    let id = create_link_id(&sourceSlug, &targetSlug, &kind);
                    self.state.all_links.retain(|link| link.id != id);
                    self.state.all_links.push(types::GraphLink {
                        id,
                        source: sourceSlug,
                        target: targetSlug,
                        kind,
                        strength: strength.unwrap_or(0.9).clamp(0.1, 1.4),
                        source_type: "authored".to_string(),
                    });
                    self.state.rebuild_visible_graph();
                }
                GraphOp::RemoveLink {
                    linkId,
                    sourceSlug,
                    targetSlug,
                    kind,
                } => {
                    self.state.all_links.retain(|link| {
                        if let Some(link_id) = &linkId {
                            return &link.id != link_id;
                        }

                        let Some(source_slug) = &sourceSlug else {
                            return true;
                        };
                        let Some(target_slug) = &targetSlug else {
                            return true;
                        };

                        let same_pair = (link.source == *source_slug && link.target == *target_slug)
                            || (link.source == *target_slug && link.target == *source_slug);
                        if !same_pair {
                            return true;
                        }

                        if let Some(kind_value) = &kind {
                            link.kind != *kind_value
                        } else {
                            false
                        }
                    });
                    self.state.rebuild_visible_graph();
                }
                GraphOp::FocusNode { slug } => {
                    self.state.sync_selection(Some(slug), true);
                }
                GraphOp::SetClusterMode { mode } => {
                    self.state.cluster_mode = mode;
                    self.state.assign_targets();
                }
                GraphOp::FitView => {
                    self.state.fit_view();
                }
            }
        }

        Ok(())
    }
}

fn serialize_events(events: Vec<GraphInteractionEvent>) -> Result<String, JsValue> {
    serde_json::to_string(&events).map_err(|error| JsValue::from_str(&error.to_string()))
}

fn create_link_id(source_slug: &str, target_slug: &str, kind: &str) -> String {
    let (source, target) = if source_slug <= target_slug {
        (source_slug, target_slug)
    } else {
        (target_slug, source_slug)
    };
    format!("{kind}:{source}:{target}")
}
