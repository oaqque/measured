use crate::types::{GraphInteractionEvent, GraphState, GraphViewportState};

impl GraphState {
    pub fn resize(&mut self, width: f64, height: f64) {
        self.width = width.max(1.0);
        self.height = height.max(1.0);
    }

    pub fn fit_view(&mut self) -> Vec<GraphInteractionEvent> {
        let Some((min_x, min_y, max_x, max_y, center_x, center_y)) = self.fit_metrics() else {
            return Vec::new();
        };

        let bounds_width = (max_x - min_x).max(120.0);
        let bounds_height = (max_y - min_y).max(120.0);
        let padding = 96.0;
        let available_width = (self.width - padding * 2.0).max(160.0);
        let available_height = (self.height - padding * 2.0).max(160.0);
        let scale = (available_width / bounds_width)
            .min(available_height / bounds_height)
            .clamp(0.25, 2.4);

        self.viewport = GraphViewportState {
            scale,
            x: self.width / 2.0 - center_x * scale,
            y: self.height / 2.0 - center_y * scale,
        };

        vec![GraphInteractionEvent {
            event_type: "viewportChanged".to_string(),
            nodeId: None,
            dragging: None,
            viewport: Some(self.viewport.clone()),
        }]
    }

    pub fn wheel(
        &mut self,
        x: f64,
        y: f64,
        _delta_x: f64,
        delta_y: f64,
        ctrl: bool,
    ) -> Vec<GraphInteractionEvent> {
        let zoom_factor: f64 = if ctrl { 1.0016 } else { 1.0011 };
        let next_scale = (self.viewport.scale * zoom_factor.powf(-delta_y)).clamp(0.28, 2.8);
        let before = self.to_world(x, y);
        self.viewport.scale = next_scale;
        let after = self.to_world(x, y);
        self.viewport.x += (after.0 - before.0) * next_scale;
        self.viewport.y += (after.1 - before.1) * next_scale;

        vec![GraphInteractionEvent {
            event_type: "viewportChanged".to_string(),
            nodeId: None,
            dragging: None,
            viewport: Some(self.viewport.clone()),
        }]
    }

    pub fn to_world(&self, screen_x: f64, screen_y: f64) -> (f64, f64) {
        (
            (screen_x - self.viewport.x) / self.viewport.scale,
            (screen_y - self.viewport.y) / self.viewport.scale,
        )
    }

    pub fn to_screen(&self, world_x: f64, world_y: f64) -> (f64, f64) {
        (
            world_x * self.viewport.scale + self.viewport.x,
            world_y * self.viewport.scale + self.viewport.y,
        )
    }

    fn fit_metrics(&self) -> Option<(f64, f64, f64, f64, f64, f64)> {
        if self.nodes.is_empty() {
            return None;
        }

        let mut left_edges = self.nodes.iter().map(|node| node.x - node.radius).collect::<Vec<_>>();
        let mut top_edges = self.nodes.iter().map(|node| node.y - node.radius).collect::<Vec<_>>();
        let mut right_edges = self.nodes.iter().map(|node| node.x + node.radius).collect::<Vec<_>>();
        let mut bottom_edges = self.nodes.iter().map(|node| node.y + node.radius).collect::<Vec<_>>();
        let mut center_xs = self.nodes.iter().map(|node| node.x).collect::<Vec<_>>();
        let mut center_ys = self.nodes.iter().map(|node| node.y).collect::<Vec<_>>();
        left_edges.sort_by(|left, right| left.total_cmp(right));
        top_edges.sort_by(|left, right| left.total_cmp(right));
        right_edges.sort_by(|left, right| left.total_cmp(right));
        bottom_edges.sort_by(|left, right| left.total_cmp(right));
        center_xs.sort_by(|left, right| left.total_cmp(right));
        center_ys.sort_by(|left, right| left.total_cmp(right));

        let node_count = self.nodes.len();
        let trim_count = if node_count >= 80 {
            std::cmp::min(((node_count as f64) * 0.05).floor() as usize, 20)
        } else {
            0
        };
        let max_index = node_count - 1;
        let min_index = std::cmp::min(trim_count, max_index);
        let trimmed_max_index = max_index.saturating_sub(trim_count);

        let mut min_x = left_edges[min_index];
        let mut min_y = top_edges[min_index];
        let mut max_x = right_edges[trimmed_max_index];
        let mut max_y = bottom_edges[trimmed_max_index];

        if !min_x.is_finite()
            || !min_y.is_finite()
            || !max_x.is_finite()
            || !max_y.is_finite()
            || min_x >= max_x
            || min_y >= max_y
        {
            min_x = left_edges[0];
            min_y = top_edges[0];
            max_x = right_edges[max_index];
            max_y = bottom_edges[max_index];
        }

        let center_index = (min_index + trimmed_max_index) / 2;
        let center_x = center_xs[center_index];
        let center_y = center_ys[center_index];

        Some((min_x, min_y, max_x, max_y, center_x, center_y))
    }
}
