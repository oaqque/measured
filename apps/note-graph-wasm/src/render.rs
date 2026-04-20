use crate::types::{GraphSnapshot, SnapshotLink, SnapshotNode};
use crate::GraphEngine;

impl GraphEngine {
    pub fn snapshot(&self) -> GraphSnapshot {
        let node_index = self
            .state
            .nodes
            .iter()
            .map(|node| (node.id.clone(), node))
            .collect::<std::collections::HashMap<_, _>>();

        GraphSnapshot {
            viewport: self.state.viewport.clone(),
            hoveredNodeId: self.state.hovered_node_id.clone(),
            selectedNodeId: self.state.selected_node_id.clone(),
            nodes: self
                .state
                .nodes
                .iter()
                .map(|node| SnapshotNode {
                    id: node.id.clone(),
                    x: node.x,
                    y: node.y,
                    radius: node.radius,
                    label: node.label.clone(),
                    eventType: node.event_type.clone(),
                    status: node.status.clone(),
                })
                .collect(),
            links: self
                .state
                .links
                .iter()
                .filter_map(|link| {
                    let source = node_index.get(&link.source)?;
                    let target = node_index.get(&link.target)?;
                    Some(SnapshotLink {
                        id: link.id.clone(),
                        sourceX: source.x,
                        sourceY: source.y,
                        targetX: target.x,
                        targetY: target.y,
                        kind: link.kind.clone(),
                        sourceType: link.source_type.clone(),
                    })
                })
                .collect(),
        }
    }
}
