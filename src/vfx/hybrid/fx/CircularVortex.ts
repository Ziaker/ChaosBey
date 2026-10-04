// ============================================================
// CIRCULAR VORTEX (owner, 2026-10-04: "o ataque giratório precisa se destacar mais visualmente, apenas um círculo é
// pouco, faz ter um vortex helicoidal 20% maior"). Three helical ribbons in the Bey's colour, 20% wider than the
// Circular's slash ring (1.43 m → 1.72 m), rising from the floor and spinning fast while the Circular is active.
// Presentation only: it never reads or writes gameplay.
// ============================================================

import * as THREE from 'three';

/** The Circular's slash ring radius (anime.ts circularSweep: 1.25 + 0.3 × 0.6) × 1.2. */
export const CIRCULAR_VORTEX_RADIUS_M = (1.25 + 0.3 * 0.6) * 1.2;
const HEIGHT_M = 1.9;
const STRANDS = 3;
const TURNS = 1.6;
const SPIN_RAD_S = 15;
const TUBE_RADIUS_M = 0.06;

export class CircularVortex {
  readonly object = new THREE.Group();
  private readonly materials: THREE.MeshBasicMaterial[] = [];
  private spin = 0;

  constructor(color: THREE.Color) {
    for (let s = 0; s < STRANDS; s++) {
      const phase = (s / STRANDS) * Math.PI * 2;
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 64; i++) {
        const u = i / 64;
        // Wide at the floor, narrowing as it rises: a vortex, not a cylinder.
        const r = CIRCULAR_VORTEX_RADIUS_M * (1 - 0.35 * u);
        const a = phase + u * TURNS * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(a) * r, u * HEIGHT_M, Math.sin(a) * r));
      }
      const geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 96, TUBE_RADIUS_M * (s === 0 ? 1.3 : 1), 6, false);
      const material = new THREE.MeshBasicMaterial({ color: s === 0 ? color : color.clone().lerp(new THREE.Color(0xffffff), 0.45), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      this.materials.push(material);
      this.object.add(new THREE.Mesh(geometry, material));
    }
    this.object.visible = false;
    this.object.renderOrder = 5;
  }

  /** `t` 0..1 through the Circular; null hides it. */
  update(pos: THREE.Vector3 | null, t: number | null, dt: number): void {
    if (pos === null || t === null) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    this.object.position.copy(pos);
    this.object.position.y -= 0.25;
    this.spin += SPIN_RAD_S * dt;
    this.object.rotation.y = this.spin;
    // Flares in fast, holds, fades out at the end; swells slightly as it builds.
    const alpha = Math.min(1, t / 0.12) * Math.min(1, (1 - t) / 0.2);
    for (const m of this.materials) m.opacity = 0.85 * alpha;
    const swell = 0.85 + 0.15 * Math.min(1, t / 0.3);
    this.object.scale.set(swell, 0.6 + 0.4 * Math.min(1, t / 0.25), swell);
  }

  dispose(): void {
    this.object.removeFromParent();
    for (const child of this.object.children) (child as THREE.Mesh).geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
