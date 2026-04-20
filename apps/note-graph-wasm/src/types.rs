use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
pub struct LoadedGraph {
    pub nodes: Vec<LoadedNode>,
    pub links: Vec<LoadedLink>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct LoadedNode {
    pub id: String,
    pub title: String,
    pub eventType: String,
    pub status: String,
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
    pub event_type: String,
    pub status: String,
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
    pub eventType: String,
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
                event_type: node.eventType,
                status: node.status,
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

        let visible_node_ids = visible_links
            .iter()
            .flat_map(|link| [link.source.clone(), link.target.clone()])
            .collect::<std::collections::HashSet<_>>();

        self.links = visible_links;
        self.nodes = self
            .all_nodes
            .iter()
            .filter(|node| !self.show_authored_only || visible_node_ids.contains(&node.id))
            .cloned()
            .collect::<Vec<_>>();
        if self.nodes.is_empty() {
            self.nodes = self.all_nodes.clone();
        }
    }
}
