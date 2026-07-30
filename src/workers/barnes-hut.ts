/**
 * High-Performance Barnes-Hut Quadtree for O(N log N) N-body repulsion calculations.
 * Upgraded with ForceAtlas2 degree-weighted mass aggregation.
 */

export interface Particle {
  id: string;
  index: number;
  label?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pinned: boolean;
  degree: number;
  category?: string;
  ringIndex?: number;
}

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export class QuadtreeNode {
  x: number;
  y: number;
  width: number;
  height: number;
  mass: number = 0;
  cx: number = 0;
  cy: number = 0;
  particle: Particle | null = null;
  children: QuadtreeNode[] | null = null;

  constructor(x: number, y: number, width: number, height: number) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }

  isLeaf(): boolean {
    return this.children === null;
  }

  insert(p: Particle): void {
    if (this.particle === null && this.children === null) {
      this.particle = p;
      return;
    }

    if (this.children === null) {
      this.subdivide();
      if (this.particle !== null) {
        const oldP = this.particle;
        this.particle = null;
        this.insertToChild(oldP);
      }
    }

    this.insertToChild(p);
  }

  private subdivide(): void {
    const halfW = this.width / 2;
    const halfH = this.height / 2;
    this.children = [
      new QuadtreeNode(this.x, this.y, halfW, halfH), // Top-Left (NW)
      new QuadtreeNode(this.x + halfW, this.y, halfW, halfH), // Top-Right (NE)
      new QuadtreeNode(this.x, this.y + halfH, halfW, halfH), // Bottom-Left (SW)
      new QuadtreeNode(this.x + halfW, this.y + halfH, halfW, halfH), // Bottom-Right (SE)
    ];
  }

  private insertToChild(p: Particle): void {
    if (!this.children) return;
    const midX = this.x + this.width / 2;
    const midY = this.y + this.height / 2;

    const isEast = p.x >= midX;
    const isSouth = p.y >= midY;

    let index = 0;
    if (isEast && !isSouth) index = 1;
    else if (!isEast && isSouth) index = 2;
    else if (isEast && isSouth) index = 3;

    this.children[index].insert(p);
  }

  /**
   * ForceAtlas2 Mass Aggregation: Mass is weighted by (particle.degree + 1)
   */
  calculateMasses(): void {
    if (this.particle !== null) {
      this.mass = (this.particle.degree || 0) + 1;
      this.cx = this.particle.x;
      this.cy = this.particle.y;
      return;
    }

    if (this.children !== null) {
      this.mass = 0;
      let totalX = 0;
      let totalY = 0;

      for (const child of this.children) {
        child.calculateMasses();
        if (child.mass > 0) {
          this.mass += child.mass;
          totalX += child.cx * child.mass;
          totalY += child.cy * child.mass;
        }
      }

      if (this.mass > 0) {
        this.cx = totalX / this.mass;
        this.cy = totalY / this.mass;
      }
    }
  }

  /**
   * ForceAtlas2 Degree-Weighted Repulsion calculation.
   */
  calculateRepulsionForce(
    p: Particle,
    theta: number,
    baseRepulsion: number,
    alpha: number
  ): void {
    if (this.mass === 0) return;

    const dx = this.cx - p.x;
    const dy = this.cy - p.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq) || 1;

    // Barnes-Hut criterion: ratio s/d < theta
    const size = Math.max(this.width, this.height);

    if (this.isLeaf() || size / dist < theta) {
      if (this.particle === p) return; // Don't repel self

      const clampedDist = Math.max(dist, 22);
      if (clampedDist < 1000) {
        // Degree-dependent repulsion charge
        const particleMass = (p.degree || 0) + 1;
        const totalCharge = -baseRepulsion * particleMass;
        let force = (totalCharge * this.mass / (clampedDist * clampedDist)) * 1.6 * alpha;
        const maxForce = 3.5;
        force = Math.max(Math.min(force, maxForce), -maxForce);
        const factor = force / dist;

        p.vx += dx * factor;
        p.vy += dy * factor;
      }
    } else if (this.children !== null) {
      for (const child of this.children) {
        child.calculateRepulsionForce(p, theta, baseRepulsion, alpha);
      }
    }
  }
}

export class BarnesHutTree {
  root: QuadtreeNode;

  constructor(bounds: Bounds) {
    const width = bounds.xMax - bounds.xMin;
    const height = bounds.yMax - bounds.yMin;
    const size = Math.max(width, height, 100);
    this.root = new QuadtreeNode(bounds.xMin, bounds.yMin, size, size);
  }

  build(particles: Particle[]): void {
    for (const p of particles) {
      this.root.insert(p);
    }
    this.root.calculateMasses();
  }

  applyRepulsion(particles: Particle[], theta: number, baseRepulsion: number, alpha: number): void {
    for (const p of particles) {
      if (p.pinned) continue;
      this.root.calculateRepulsionForce(p, theta, baseRepulsion, alpha);
    }
  }
}
