use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
pub struct LoadedGraph {
    pub nodes: Vec<LoadedNode>,
    pub links: Vec<LoadedLink>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct LoadedNode {
    pub id: String,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(rename = "nodeKind")]
    pub node_kind: String,
    pub title: String,
    pub category: String,
    pub status: String,
    #[serde(default)]
    pub sourcePath: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    pub radius: f64,
    pub x: f64,
    pub y: f64,
    pub clusters: NodeClusters,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct LoadedLink {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: String,
    pub strength: f64,
    #[serde(rename = "sourceType")]
    pub source_type: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct NodeClusters {
    pub eventType: String,
    pub month: String,
    pub status: String,
    pub trainingBlock: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct GraphNode {
    pub id: String,
    pub label: String,
    pub category: String,
    pub node_kind: String,
    pub status: String,
    pub degree: usize,
    pub radius: f64,
    pub x: f64,
    pub y: f64,
    pub vx: f64,
    pub vy: f64,
    pub target_x: f64,
    pub target_y: f64,
    pub clusters: NodeClusters,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct GraphLink {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: String,
    pub strength: f64,
    pub source_type: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct GraphViewportState {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct SnapshotNode {
    pub id: String,
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub label: String,
    pub category: String,
    pub nodeKind: String,
    pub status: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct SnapshotLink {
    pub id: String,
    pub sourceX: f64,
    pub sourceY: f64,
    pub targetX: f64,
    pub targetY: f64,
    pub kind: String,
    pub sourceType: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct GraphSnapshot {
    pub viewport: GraphViewportState,
    pub hoveredNodeId: Option<String>,
    pub selectedNodeId: Option<String>,
    pub nodes: Vec<SnapshotNode>,
    pub links: Vec<SnapshotLink>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct GraphInteractionEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nodeId: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dragging: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub viewport: Option<GraphViewportState>,
}

#[derive(Clone, Deserialize)]
#[serde(tag = "op")]
pub enum GraphOp {
    #[serde(rename = "createLink")]
    CreateLink {
        sourceSlug: String,
        targetSlug: String,
        kind: String,
        #[serde(default)]
        strength: Option<f64>,
    },
    #[serde(rename = "removeLink")]
    RemoveLink {
        #[serde(default)]
        linkId: Option<String>,
        #[serde(default)]
        sourceSlug: Option<String>,
        #[serde(default)]
        targetSlug: Option<String>,
        #[serde(default)]
        kind: Option<String>,
    },
    #[serde(rename = "focusNode")]
    FocusNode { slug: String },
    #[serde(rename = "setClusterMode")]
    SetClusterMode { mode: String },
    #[serde(rename = "fitView")]
    FitView,
}

pub struct GraphState {
    pub all_links: Vec<GraphLink>,
    pub all_nodes: Vec<GraphNode>,
    pub focused_node_id: Option<String>,
    pub links: Vec<GraphLink>,
    pub nodes: Vec<GraphNode>,
    pub pending_node_selection_id: Option<String>,
    pub viewport: GraphViewportState,
    pub selected_node_id: Option<String>,
    pub hovered_node_id: Option<String>,
    pub dragging_node_id: Option<String>,
    pub panning: bool,
    pub last_pointer_world: Option<(f64, f64)>,
    pub last_pointer_screen: Option<(f64, f64)>,
    pub pointer_down_screen: Option<(f64, f64)>,
    pub paused: bool,
    pub show_authored_only: bool,
    pub cluster_mode: String,
    pub width: f64,
    pub height: f64,
}

impl GraphState {
    pub fn from_loaded_graph(graph: LoadedGraph) -> Self {
        let all_nodes = graph
            .nodes
            .into_iter()
            .map(|node| GraphNode {
                id: node.id,
                label: node.title,
                category: node.category,
                node_kind: node.node_kind,
                status: node.status,
                degree: 0,
                radius: node.radius,
                x: node.x,
                y: node.y,
                vx: 0.0,
                vy: 0.0,
                target_x: node.x,
                target_y: node.y,
                clusters: node.clusters,
            })
            .collect::<Vec<_>>();
        let all_links = graph
            .links
            .into_iter()
            .map(|link| GraphLink {
                id: link.id,
                source: link.source,
                target: link.target,
                kind: link.kind,
                strength: link.strength,
                source_type: link.source_type,
            })
            .collect::<Vec<_>>();

        let mut state = Self {
            all_links,
            all_nodes,
            focused_node_id: None,
            links: Vec::new(),
            nodes: Vec::new(),
            pending_node_selection_id: None,
            viewport: GraphViewportState {
                x: 0.0,
                y: 0.0,
                scale: 1.0,
            },
            selected_node_id: None,
            hovered_node_id: None,
            dragging_node_id: None,
            panning: false,
            last_pointer_world: None,
            last_pointer_screen: None,
            pointer_down_screen: None,
            paused: false,
            show_authored_only: false,
            cluster_mode: "eventType".to_string(),
            width: 1.0,
            height: 1.0,
        };
        state.rebuild_visible_graph();
        state
    }

    pub fn rebuild_visible_graph(&mut self) {
        let visible_links = if self.show_authored_only {
            self.all_links
                .iter()
                .filter(|link| link.source_type == "authored")
                .cloned()
                .collect::<Vec<_>>()
        } else {
            self.all_links.clone()
        };

        let mut degree_by_id = std::collections::HashMap::<String, usize>::new();
        let visible_node_ids = visible_links
            .iter()
            .flat_map(|link| {
                *degree_by_id.entry(link.source.clone()).or_insert(0) += 1;
                *degree_by_id.entry(link.target.clone()).or_insert(0) += 1;
                [link.source.clone(), link.target.clone()]
            })
            .collect::<std::collections::HashSet<_>>();

        self.links = visible_links;
        self.nodes = self
            .all_nodes
            .iter()
            .filter(|node| !self.show_authored_only || visible_node_ids.contains(&node.id))
            .map(|node| {
                let mut next = node.clone();
                next.degree = *degree_by_id.get(&node.id).unwrap_or(&0);
                next
            })
            .collect::<Vec<_>>();
        if self.nodes.is_empty() {
            self.nodes = self
                .all_nodes
                .iter()
                .map(|node| {
                    let mut next = node.clone();
                    next.degree = 0;
                    next
                })
                .collect::<Vec<_>>();
        }

        if let Some(focused_node_id) = &self.focused_node_id {
            if !self.nodes.iter().any(|node| &node.id == focused_node_id) {
                self.focused_node_id = None;
            }
        }
        if let Some(selected_node_id) = &self.selected_node_id {
            if !self.nodes.iter().any(|node| &node.id == selected_node_id) {
                self.selected_node_id = None;
            }
        }
        if let Some(hovered_node_id) = &self.hovered_node_id {
            if !self.nodes.iter().any(|node| &node.id == hovered_node_id) {
                self.hovered_node_id = None;
            }
        }
    }

    pub fn apply_selection(&mut self, node_id: Option<String>, preserve_node_focus_on_non_folder: bool) -> Option<String> {
        let Some(node_id_value) = node_id else {
            self.focused_node_id = None;
            self.selected_node_id = None;
            self.hovered_node_id = None;
            return None;
        };

        let node_kind = self
            .nodes
            .iter()
            .find(|node| node.id == node_id_value)
            .or_else(|| self.all_nodes.iter().find(|node| node.id == node_id_value))
            .map(|node| node.node_kind.clone());

        let Some(node_kind_value) = node_kind else {
            self.focused_node_id = None;
            self.selected_node_id = None;
            self.hovered_node_id = None;
            return None;
        };

        if self.focused_node_id.as_deref() == Some(node_id_value.as_str()) {
            self.focused_node_id = None;
            self.selected_node_id = None;
            self.hovered_node_id = None;
            return None;
        }

        let _ = node_kind_value;
        if !preserve_node_focus_on_non_folder {
            self.focused_node_id = None;
        }
        self.focused_node_id = Some(node_id_value.clone());
        self.selected_node_id = Some(node_id_value);

        if let Some(renderable_node_ids) = self.renderable_node_ids() {
            if let Some(hovered_node_id) = &self.hovered_node_id {
                if !renderable_node_ids.contains(hovered_node_id) {
                    self.hovered_node_id = None;
                }
            }
        }

        self.selected_node_id.clone()
    }

    pub fn sync_selection(&mut self, node_id: Option<String>, preserve_node_focus_on_non_folder: bool) -> Option<String> {
        let Some(node_id_value) = node_id else {
            self.focused_node_id = None;
            self.selected_node_id = None;
            self.hovered_node_id = None;
            return None;
        };

        let node_kind = self
            .nodes
            .iter()
            .find(|node| node.id == node_id_value)
            .or_else(|| self.all_nodes.iter().find(|node| node.id == node_id_value))
            .map(|node| node.node_kind.clone());

        let Some(node_kind_value) = node_kind else {
            self.focused_node_id = None;
            self.selected_node_id = None;
            self.hovered_node_id = None;
            return None;
        };

        let _ = node_kind_value;
        if !preserve_node_focus_on_non_folder {
            self.focused_node_id = None;
        }
        self.focused_node_id = Some(node_id_value.clone());
        self.selected_node_id = Some(node_id_value);

        if let Some(renderable_node_ids) = self.renderable_node_ids() {
            if let Some(hovered_node_id) = &self.hovered_node_id {
                if !renderable_node_ids.contains(hovered_node_id) {
                    self.hovered_node_id = None;
                }
            }
        }

        self.selected_node_id.clone()
    }

    pub fn renderable_node_ids(&self) -> Option<std::collections::HashSet<String>> {
        let focused_node_id = self.focused_node_id.as_ref()?;
        if !self.nodes.iter().any(|node| &node.id == focused_node_id) {
            return None;
        }

        let mut node_ids = std::collections::HashSet::from([focused_node_id.clone()]);
        for link in &self.links {
            if &link.source == focused_node_id || &link.target == focused_node_id {
                node_ids.insert(link.source.clone());
                node_ids.insert(link.target.clone());
            }
        }
        Some(node_ids)
    }

    pub fn renderable_node_indexes(&self) -> Vec<usize> {
        let Some(renderable_node_ids) = self.renderable_node_ids() else {
            return (0..self.nodes.len()).collect::<Vec<_>>();
        };

        self.nodes
            .iter()
            .enumerate()
            .filter_map(|(index, node)| renderable_node_ids.contains(&node.id).then_some(index))
            .collect::<Vec<_>>()
    }
}
