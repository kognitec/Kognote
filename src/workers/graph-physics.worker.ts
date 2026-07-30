/**
 * Dedicated Web Worker for Off-Main-Thread Organic Graph Physics Simulation.
 * Implements ForceAtlas2 Degree Repulsion, Dynamic Logarithmic Spring Distances,
 * Non-Linear Distance-Squared Adaptive Gravity, Soft Cluster Attraction,
 * and Bounding-Box Label Collision Padding.
 */

import { Particle, BarnesHutTree, Bounds } from "./barnes-hut";

export interface WorkerLink {
  sourceIndex: number;
  targetIndex: number;
  type: "folder" | "tag-in-notes" | "backlink" | "semantic";
  weight?: number;
}

export interface PhysicsParams {
  repulsion: number;
  linkDistance: number;
  linkStrength: number;
  gravity: number;
  collisionRadius: number;
  friction: number;
  theta: number;
}

let particles: Particle[] = [];
let links: WorkerLink[] = [];
let params: PhysicsParams = {
  repulsion: 2200,
  linkDistance: 180,
  linkStrength: 0.35,
  gravity: 0.05,
  collisionRadius: 28,
  friction: 0.82,
  theta: 0.5,
};
let alpha = 1.0;
let draggedNodeIndex: number | null = null;

ctxSelfHandler();

function ctxSelfHandler() {
  self.onmessage = (e: MessageEvent) => {
    const msg = e.data;
    if (!msg) return;

    switch (msg.type) {
      case "INIT": {
        particles = msg.particles || [];
        links = msg.links || [];
        if (msg.params) params = { ...params, ...msg.params };
        alpha = 1.0;
        break;
      }

      case "UPDATE_NODES": {
        particles = msg.particles || [];
        alpha = Math.max(alpha, 0.4);
        break;
      }

      case "UPDATE_LINKS": {
        links = msg.links || [];
        alpha = Math.max(alpha, 0.4);
        break;
      }

      case "SET_PARAMS": {
        if (msg.params) params = { ...params, ...msg.params };
        alpha = Math.max(alpha, 0.5);
        break;
      }

      case "DRAG_NODE": {
        draggedNodeIndex = msg.index;
        if (msg.index !== null && particles[msg.index]) {
          particles[msg.index].x = msg.x;
          particles[msg.index].y = msg.y;
          particles[msg.index].vx = 0;
          particles[msg.index].vy = 0;
        }
        alpha = Math.max(alpha, 0.15); // Gentle alpha bump to prevent violent shaking
        break;
      }

      case "SET_PINNED": {
        if (particles[msg.index]) {
          particles[msg.index].pinned = msg.pinned;
        }
        break;
      }

      case "BUMP_ALPHA": {
        alpha = Math.max(alpha, msg.alpha ?? 0.5);
        break;
      }

      case "STEP": {
        runPhysicsStep();
        sendPositionsBack();
        break;
      }
    }
  };
}

function runPhysicsStep(): void {
  if (particles.length === 0) return;

  // 1. Decay Alpha
  alpha = Math.max(0.012, alpha * 0.982);
  const currentAlpha = alpha;

  // 2. Compute Bounding Box for Quadtree
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const padding = 100;
  const bounds: Bounds = {
    xMin: minX - padding,
    xMax: maxX + padding,
    yMin: minY - padding,
    yMax: maxY + padding,
  };

  // 3. ForceAtlas2 Degree-Weighted Repulsion O(N log N)
  const tree = new BarnesHutTree(bounds);
  tree.build(particles);
  tree.applyRepulsion(particles, params.theta, params.repulsion, currentAlpha);

  // 4. Bounding-Box Label Collision Padding (Prevents Rectangular Label Overlaps)
  if (params.collisionRadius > 0) {
    const pad = params.collisionRadius;
    for (let i = 0; i < particles.length; i++) {
      const p1 = particles[i];
      const w1 = p1.radius + Math.min((p1.label?.length || 6) * 6, 120) / 2;
      const h1 = p1.radius + 10;
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const w2 = p2.radius + Math.min((p2.label?.length || 6) * 6, 120) / 2;
        const h2 = p2.radius + 10;

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const minW = w1 + w2 + pad;
        const minH = h1 + h2 + pad;

        const overlapX = minW - Math.abs(dx);
        const overlapY = minH - Math.abs(dy);

        if (overlapX > 0 && overlapY > 0) {
          if (overlapX < overlapY) {
            const sign = dx > 0 ? 1 : -1;
            const push = overlapX * 0.4 * currentAlpha * sign;
            if (!p1.pinned && p1.index !== draggedNodeIndex) p1.vx -= push;
            if (!p2.pinned && p2.index !== draggedNodeIndex) p2.vx += push;
          } else {
            const sign = dy > 0 ? 1 : -1;
            const push = overlapY * 0.4 * currentAlpha * sign;
            if (!p1.pinned && p1.index !== draggedNodeIndex) p1.vy -= push;
            if (!p2.pinned && p2.index !== draggedNodeIndex) p2.vy += push;
          }
        }
      }
    }
  }

  // 5. Sequence-Aware Dynamic Spring Distances & Type-Specific Stiffness
  const baseSpringStrength = params.linkStrength;
  const baseDistance = params.linkDistance;

  for (let i = 0; i < links.length; i++) {
    const link = links[i];
    const source = particles[link.sourceIndex];
    const target = particles[link.targetIndex];
    if (source && target) {
      // Degree-Aware Logarithmic Multiplier (gives hub nodes breathing room)
      const maxDegree = Math.max(source.degree || 0, target.degree || 0);
      const dynamicMultiplier = 1 + Math.log10(maxDegree + 1) * 0.4;

      // Filter-Sequence Aware Type Multipliers
      let typeMultiplier = 1.0;
      if (link.type === "folder") typeMultiplier = 0.75;
      else if (link.type === "backlink") typeMultiplier = 1.00;
      else if (link.type === "tag-in-notes") typeMultiplier = 1.30;
      else if (link.type === "semantic") typeMultiplier = 1.60;

      // Category-Specific Distance Adjustment for Daily & Template notes
      if (source.category === "daily" || target.category === "daily") typeMultiplier += 0.15;
      if (source.category === "template" || target.category === "template") typeMultiplier += 0.25;

      // Ring Level Separation (prevents edge crisscrossing between different hierarchy rings)
      const ringDiff = Math.abs((source.ringIndex ?? 0) - (target.ringIndex ?? 0));
      const ringMultiplier = 1 + ringDiff * 0.15;

      const targetDist = baseDistance * typeMultiplier * ringMultiplier * dynamicMultiplier;

      // Type-Specific Spring Stiffness
      // Folder links are structural (stiffer = 1.3x) to keep folder trees intact.
      // Tag & Semantic links are conceptual (softer = 0.5x) so they don't collapse separate folders together.
      const effectiveStrength = baseSpringStrength * (
        link.type === "folder" ? 1.3 :
        link.type === "tag-in-notes" ? 0.5 :
        link.type === "semantic" ? 0.4 : 1.0
      );

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      const force = (dist - targetDist) * effectiveStrength * 0.12 * currentAlpha;
      const factor = force / dist;

      if (!source.pinned && source.index !== draggedNodeIndex) {
        source.vx += dx * factor;
        source.vy += dy * factor;
      }
      if (!target.pinned && target.index !== draggedNodeIndex) {
        target.vx -= dx * factor;
        target.vy -= dy * factor;
      }
    }
  }

  // 6. Soft Cluster Attraction Force (Organic Community Islands)
  const clusterTotals: Record<string, { sumX: number; sumY: number; count: number }> = {};
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const cat = p.category || "standard";
    if (!clusterTotals[cat]) clusterTotals[cat] = { sumX: 0, sumY: 0, count: 0 };
    clusterTotals[cat].sumX += p.x;
    clusterTotals[cat].sumY += p.y;
    clusterTotals[cat].count += 1;
  }
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.pinned || p.index === draggedNodeIndex) continue;
    const cat = p.category || "standard";
    const cluster = clusterTotals[cat];
    if (cluster && cluster.count > 1) {
      const cx = cluster.sumX / cluster.count;
      const cy = cluster.sumY / cluster.count;
      const dx = cx - p.x;
      const dy = cy - p.y;
      p.vx += dx * 0.01 * currentAlpha;
      p.vy += dy * 0.01 * currentAlpha;
    }
  }

  // 7. Non-Linear Adaptive Distance-Squared Gravity & Friction Damping
  const friction = params.friction;
  const gravityBase = params.gravity;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    if (p.index === draggedNodeIndex || p.pinned) {
      if (p.index !== draggedNodeIndex) {
        p.vx = 0;
        p.vy = 0;
      }
      continue;
    }

    // Distance-squared adaptive gravity (weak at origin, strong containment fence further out)
    const distFromCenter = Math.sqrt(p.x * p.x + p.y * p.y) || 1;
    const gravityForce = (distFromCenter * distFromCenter) / 500000;
    p.vx -= (p.x / distFromCenter) * gravityForce * gravityBase * currentAlpha;
    p.vy -= (p.y / distFromCenter) * gravityForce * gravityBase * currentAlpha;

    // Velocity clamping to prevent jiggling & wild vibrations
    const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    const maxSpeed = 5.0;
    if (speed > maxSpeed) {
      p.vx = (p.vx / speed) * maxSpeed;
      p.vy = (p.vy / speed) * maxSpeed;
    }

    p.vx *= friction;
    p.vy *= friction;

    // Minimum movement threshold (prevents sub-pixel micro-jiggling)
    if (Math.abs(p.vx) < 0.005) p.vx = 0;
    if (Math.abs(p.vy) < 0.005) p.vy = 0;

    p.x += p.vx;
    p.y += p.vy;
  }
}

function sendPositionsBack(): void {
  const count = particles.length;
  const buffer = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    buffer[i * 2] = particles[i].x;
    buffer[i * 2 + 1] = particles[i].y;
  }

  (self.postMessage as any)(
    {
      type: "STEP_COMPLETE",
      positions: buffer.buffer,
      alpha,
    },
    [buffer.buffer]
  );
}
