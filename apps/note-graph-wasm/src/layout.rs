use std::collections::HashMap;

use crate::types::GraphState;

impl GraphState {
    pub fn assign_targets(&mut self) {
        if self.cluster_mode == "none" || self.nodes.is_empty() {
            return;
        }

        let mut ordered_keys = self
            .nodes
            .iter()
            .map(|node| match self.cluster_mode.as_str() {
                "status" => node.clusters.status.clone(),
                "month" => node.clusters.month.clone(),
                "trainingBlock" => node.clusters.trainingBlock.clone(),
                _ => node.clusters.eventType.clone(),
            })
            .collect::<Vec<_>>();
        ordered_keys.sort();
        ordered_keys.dedup();

        let radius = (self.width.min(self.height) * 0.34).max(220.0);
        let mut centers = HashMap::new();
        for (index, key) in ordered_keys.iter().enumerate() {
            let angle = -std::f64::consts::FRAC_PI_2
                + (index as f64 / ordered_keys.len().max(1) as f64) * std::f64::consts::PI * 2.0;
            centers.insert(key.clone(), (angle.cos() * radius, angle.sin() * radius));
        }

        let mut cluster_members = HashMap::<String, Vec<usize>>::new();
        for (index, node) in self.nodes.iter().enumerate() {
            let key = match self.cluster_mode.as_str() {
                "status" => node.clusters.status.clone(),
                "month" => node.clusters.month.clone(),
                "trainingBlock" => node.clusters.trainingBlock.clone(),
                _ => node.clusters.eventType.clone(),
            };
            cluster_members.entry(key).or_default().push(index);
        }

        for key in ordered_keys {
            let (center_x, center_y) = centers.get(&key).copied().unwrap_or((0.0, 0.0));
            let Some(member_indexes) = cluster_members.get_mut(&key) else {
                continue;
            };
            member_indexes.sort_by(|left, right| self.nodes[*left].id.cmp(&self.nodes[*right].id));

            let ring_step = 52.0;
            let max_per_ring = 10usize;
            let member_count = member_indexes.len();
            for (index, node_index) in member_indexes.iter().enumerate() {
                let ring = index / max_per_ring;
                let index_in_ring = index % max_per_ring;
                let slots_in_ring = std::cmp::min(max_per_ring, member_count - ring * max_per_ring);
                let seed = hash_node_id(&self.nodes[*node_index].id);
                let base_angle = ((seed % 360) as f64).to_radians();
                let angle =
                    base_angle + (index_in_ring as f64 / slots_in_ring.max(1) as f64) * std::f64::consts::PI * 2.0;
                let orbit_radius = 24.0 + ring as f64 * ring_step + (seed % 17) as f64;
                self.nodes[*node_index].target_x = center_x + angle.cos() * orbit_radius;
                self.nodes[*node_index].target_y = center_y + angle.sin() * orbit_radius;
            }
        }
    }

    pub fn tick_layout(&mut self, dt_ms: f64) -> bool {
        if self.nodes.is_empty() {
            return false;
        }

        if self.paused && self.dragging_node_id.is_none() {
            return false;
        }

        self.assign_targets();
        let step = (dt_ms / 16.0).clamp(0.45, 1.8);

        for node in &mut self.nodes {
            let attraction = if self.dragging_node_id.as_ref() == Some(&node.id) {
                0.38
            } else {
                0.012
            };
            node.vx += (node.target_x - node.x) * attraction * step;
            node.vy += (node.target_y - node.y) * attraction * step;
        }

        let node_index = self
            .nodes
            .iter()
            .enumerate()
            .map(|(index, node)| (node.id.clone(), index))
            .collect::<HashMap<_, _>>();

        for link in &self.links {
            let Some(source_index) = node_index.get(&link.source).copied() else {
                continue;
            };
            let Some(target_index) = node_index.get(&link.target).copied() else {
                continue;
            };

            let dx = self.nodes[target_index].x - self.nodes[source_index].x;
            let dy = self.nodes[target_index].y - self.nodes[source_index].y;
            let distance = dx.hypot(dy).max(1.0);
            let desired = 72.0 + (1.0 - link.strength) * 48.0;
            let force = ((distance - desired) / distance) * (0.02 + link.strength * 0.025) * step;
            let fx = dx * force;
            let fy = dy * force;

            self.nodes[source_index].vx += fx;
            self.nodes[source_index].vy += fy;
            self.nodes[target_index].vx -= fx;
            self.nodes[target_index].vy -= fy;
        }

        for left_index in 0..self.nodes.len() {
            for right_index in (left_index + 1)..self.nodes.len() {
                let dx = self.nodes[right_index].x - self.nodes[left_index].x;
                let dy = self.nodes[right_index].y - self.nodes[left_index].y;
                let distance_sq = (dx * dx + dy * dy).max(16.0);
                let distance = distance_sq.sqrt();
                let min_gap = self.nodes[left_index].radius + self.nodes[right_index].radius + 18.0;
                let repel = if distance < min_gap { 0.34 } else { 0.09 } * step;
                let fx = (dx / distance) * (repel * 1600.0) / distance_sq;
                let fy = (dy / distance) * (repel * 1600.0) / distance_sq;
                self.nodes[left_index].vx -= fx;
                self.nodes[left_index].vy -= fy;
                self.nodes[right_index].vx += fx;
                self.nodes[right_index].vy += fy;

                if distance < min_gap {
                    let overlap = ((min_gap - distance) / distance) * 0.2 * step;
                    self.nodes[left_index].vx -= dx * overlap;
                    self.nodes[left_index].vy -= dy * overlap;
                    self.nodes[right_index].vx += dx * overlap;
                    self.nodes[right_index].vy += dy * overlap;
                }
            }
        }

        let mut moved = false;
        for node in &mut self.nodes {
            if self.dragging_node_id.as_ref() == Some(&node.id) {
                if let Some((pointer_x, pointer_y)) = self.last_pointer_world {
                    node.x = pointer_x;
                    node.y = pointer_y;
                    node.vx = 0.0;
                    node.vy = 0.0;
                    moved = true;
                }
                continue;
            }

            node.vx *= 0.86;
            node.vy *= 0.86;
            node.x += node.vx * step;
            node.y += node.vy * step;
            if node.vx.abs() > 0.015 || node.vy.abs() > 0.015 {
                moved = true;
            }
        }

        moved
    }
}

fn hash_node_id(value: &str) -> u32 {
    let mut hash: u32 = 2_166_136_261;
    for character in value.chars() {
        hash ^= character as u32;
        hash = hash.wrapping_mul(16_777_619);
    }
    hash
}
