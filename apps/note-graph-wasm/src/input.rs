use crate::types::{GraphInteractionEvent, GraphState};

impl GraphState {
    pub fn pointer_down(
        &mut self,
        x: f64,
        y: f64,
        button: u8,
        _shift: bool,
        _meta: bool,
    ) -> Vec<GraphInteractionEvent> {
        let world = self.to_world(x, y);
        self.last_pointer_world = Some(world);
        self.last_pointer_screen = Some((x, y));
        self.pointer_down_screen = Some((x, y));
        if button == 0 {
            if let Some(node_id) = self.find_node_at(world.0, world.1).map(|index| self.nodes[index].id.clone()) {
                self.pending_node_selection_id = Some(node_id);
                return Vec::new();
            }
        }

        self.pending_node_selection_id = None;
        self.panning = true;
        self.hovered_node_id = None;
        vec![GraphInteractionEvent {
            event_type: "dragStateChanged".to_string(),
            nodeId: None,
            dragging: Some(true),
            viewport: None,
        }]
    }

    pub fn pointer_move(&mut self, x: f64, y: f64) -> Vec<GraphInteractionEvent> {
        let world = self.to_world(x, y);
        let mut events = Vec::new();

        if self.pending_node_selection_id.is_some() && self.dragging_node_id.is_none() {
            if let Some((down_x, down_y)) = self.pointer_down_screen {
                let drag_threshold = 6.0;
                if (x - down_x).hypot(y - down_y) >= drag_threshold {
                    self.dragging_node_id = self.pending_node_selection_id.clone();
                    events.push(GraphInteractionEvent {
                        event_type: "dragStateChanged".to_string(),
                        nodeId: None,
                        dragging: Some(true),
                        viewport: None,
                    });
                }
            }
        }

        if self.dragging_node_id.is_some() {
            self.last_pointer_world = Some(world);
            if let Some(dragging_node_id) = &self.dragging_node_id {
                if let Some(node) = self.nodes.iter_mut().find(|node| &node.id == dragging_node_id) {
                    node.x = world.0;
                    node.y = world.1;
                    node.vx = 0.0;
                    node.vy = 0.0;
                }
            }
            return events;
        }

        if self.panning {
            if let Some((last_screen_x, last_screen_y)) = self.last_pointer_screen {
                self.viewport.x += x - last_screen_x;
                self.viewport.y += y - last_screen_y;
                self.last_pointer_screen = Some((x, y));
                events.push(GraphInteractionEvent {
                    event_type: "viewportChanged".to_string(),
                    nodeId: None,
                    dragging: None,
                    viewport: Some(self.viewport.clone()),
                });
                return events;
            }
        }

        let next_hovered = self.find_node_at(world.0, world.1).map(|index| self.nodes[index].id.clone());
        if next_hovered != self.hovered_node_id {
            self.hovered_node_id = next_hovered.clone();
            events.push(GraphInteractionEvent {
                event_type: "hoverChanged".to_string(),
                nodeId: next_hovered,
                dragging: None,
                viewport: None,
            });
        }

        events
    }

    pub fn pointer_up(&mut self, _x: f64, _y: f64) -> Vec<GraphInteractionEvent> {
        self.last_pointer_world = None;
        self.last_pointer_screen = None;
        self.pointer_down_screen = None;
        let was_dragging = self.dragging_node_id.is_some() || self.panning;
        let mut events = Vec::new();
        if let Some(node_id) = self.pending_node_selection_id.clone() {
            if self.dragging_node_id.is_none() {
                let next_selected_node_id = self.apply_selection(Some(node_id), true);
                events.push(GraphInteractionEvent {
                    event_type: "selectionChanged".to_string(),
                    nodeId: next_selected_node_id,
                    dragging: None,
                    viewport: None,
                });
            }
        }
        self.pending_node_selection_id = None;
        self.dragging_node_id = None;
        self.panning = false;

        if was_dragging {
            events.push(GraphInteractionEvent {
                event_type: "dragStateChanged".to_string(),
                nodeId: None,
                dragging: Some(false),
                viewport: None,
            });
        }

        events
    }

    pub fn select_node(&mut self, node_id: Option<String>) -> Vec<GraphInteractionEvent> {
        let next_selected_node_id = self.sync_selection(node_id, true);
        vec![GraphInteractionEvent {
            event_type: "selectionChanged".to_string(),
            nodeId: next_selected_node_id,
            dragging: None,
            viewport: None,
        }]
    }

    pub fn cancel_interaction(&mut self) -> Vec<GraphInteractionEvent> {
        let was_dragging = self.dragging_node_id.is_some() || self.panning;
        self.last_pointer_world = None;
        self.last_pointer_screen = None;
        self.pointer_down_screen = None;
        self.pending_node_selection_id = None;
        self.dragging_node_id = None;
        self.panning = false;

        if was_dragging {
            vec![GraphInteractionEvent {
                event_type: "dragStateChanged".to_string(),
                nodeId: None,
                dragging: Some(false),
                viewport: None,
            }]
        } else {
            Vec::new()
        }
    }

    fn find_node_at(&self, x: f64, y: f64) -> Option<usize> {
        self.renderable_node_indexes()
            .into_iter()
            .rev()
            .find(|index| {
                let node = &self.nodes[*index];
                (node.x - x).hypot(node.y - y) <= node.radius + 8.0
            })
    }
}
