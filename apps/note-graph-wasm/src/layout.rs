use std::collections::HashMap;

use crate::types::GraphState;

impl GraphState {
    pub fn assign_targets(&mut self) {
        let active_node_indexes = self.renderable_node_indexes();
        if self.cluster_mode == "none" || active_node_indexes.is_empty() {
            return;
        }

        let mut ordered_keys = active_node_indexes
            .iter()
            .map(|index| match self.cluster_mode.as_str() {
                "status" => self.nodes[*index].clusters.status.clone(),
                "month" => self.nodes[*index].clusters.month.clone(),
                "trainingBlock" => self.nodes[*index].clusters.trainingBlock.clone(),
                _ => self.nodes[*index].clusters.eventType.clone(),
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
        for index in active_node_indexes {
            let key = match self.cluster_mode.as_str() {
                "status" => self.nodes[index].clusters.status.clone(),
                "month" => self.nodes[index].clusters.month.clone(),
                "trainingBlock" => self.nodes[index].clusters.trainingBlock.clone(),
                _ => self.nodes[index].clusters.eventType.clone(),
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
        let active_node_indexes = self.renderable_node_indexes();
        if active_node_indexes.is_empty() {
            return false;
        }

        if self.paused && self.dragging_node_id.is_none() {
            return false;
        }

        self.assign_targets();
        let step = (dt_ms / 16.0).clamp(0.45, 1.8);

        for index in &active_node_indexes {
            let node = &mut self.nodes[*index];
            let attraction = if self.dragging_node_id.as_ref() == Some(&node.id) {
                0.38
            } else if node.node_kind == "folder" {
                0.038
            } else if node.node_kind == "document" {
                0.024
            } else {
                0.012
            };
            node.vx += (node.target_x - node.x) * attraction * step;
            node.vy += (node.target_y - node.y) * attraction * step;
        }

        let node_index = active_node_indexes
            .iter()
            .map(|index| (self.nodes[*index].id.clone(), *index))
            .collect::<HashMap<_, _>>();
        let renderable_node_ids = self.renderable_node_ids();

        for link in &self.links {
            if let Some(renderable_node_ids_value) = renderable_node_ids.as_ref() {
                if !renderable_node_ids_value.contains(&link.source) || !renderable_node_ids_value.contains(&link.target) {
                    continue;
                }
            }

            let Some(source_index) = node_index.get(&link.source).copied() else {
                continue;
            };
            let Some(target_index) = node_index.get(&link.target).copied() else {
                continue;
            };

            let dx = self.nodes[target_index].x - self.nodes[source_index].x;
            let dy = self.nodes[target_index].y - self.nodes[source_index].y;
            let distance = dx.hypot(dy).max(1.0);
            let desired = get_link_desired_length(
                link.kind.as_str(),
                self.nodes[source_index].node_kind.as_str(),
                self.nodes[target_index].node_kind.as_str(),
                link.strength,
            );
            let stretch = (distance - desired).clamp(-140.0, 140.0);
            let stiffness = get_link_stiffness(
                link.kind.as_str(),
                link.source_type.as_str(),
                self.nodes[source_index].node_kind.as_str(),
                self.nodes[target_index].node_kind.as_str(),
                self.nodes[source_index].degree,
                self.nodes[target_index].degree,
                link.strength,
            ) * step;
            let fx = (dx / distance) * stretch * stiffness;
            let fy = (dy / distance) * stretch * stiffness;

            self.nodes[source_index].vx += fx;
            self.nodes[source_index].vy += fy;
            self.nodes[target_index].vx -= fx;
            self.nodes[target_index].vy -= fy;
        }

        for left_position in 0..active_node_indexes.len() {
            let left_index = active_node_indexes[left_position];
            for right_position in (left_position + 1)..active_node_indexes.len() {
                let right_index = active_node_indexes[right_position];
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
        for index in active_node_indexes {
            let node = &mut self.nodes[index];
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
            clamp_velocity(node, 24.0);
            node.x += node.vx * step;
            node.y += node.vy * step;
            if !node.x.is_finite() || !node.y.is_finite() {
                node.x = node.target_x;
                node.y = node.target_y;
                node.vx = 0.0;
                node.vy = 0.0;
            }
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

fn clamp_velocity(node: &mut crate::types::GraphNode, max_speed: f64) {
    let speed = node.vx.hypot(node.vy);
    if speed <= max_speed || speed == 0.0 {
        return;
    }

    let scale = max_speed / speed;
    node.vx *= scale;
    node.vy *= scale;
}

fn get_link_desired_length(kind: &str, source_kind: &str, target_kind: &str, strength: f64) -> f64 {
    if kind == "contains" {
        return 138.0;
    }

    if source_kind != "workout" || target_kind != "workout" {
        return if kind == "references" { 112.0 } else { 96.0 };
    }

    76.0 + (1.0 - strength) * 42.0
}

fn get_link_stiffness(
    kind: &str,
    source_type: &str,
    source_kind: &str,
    target_kind: &str,
    source_degree: usize,
    target_degree: usize,
    strength: f64,
) -> f64 {
    let hub_degree = source_degree.max(target_degree).max(1) as f64;
    let hub_scale = (1.0 / hub_degree.sqrt()).max(0.03);
    let base_stiffness = 0.006 + strength * 0.01;

    let kind_scale = if kind == "contains" {
        0.12
    } else if kind == "references" {
        if source_kind == "workout" && target_kind == "workout" {
            0.34
        } else {
            0.18
        }
    } else if source_type == "derived" {
        0.26
    } else {
        1.0
    };

    base_stiffness * kind_scale * hub_scale
}
