// ============================================================
// CIRCULAR TORNADO (owner, 2026-10-04: "o ataque giratório precisa se destacar mais visualmente … um vortex
// helicoidal 20% maior" → "melhore a animação do ataque giratório, deixe mais bonita, como um tornado").
// A funnel that is narrow at the Bey and opens upward to 20% wider than the Circular's slash ring (1.72 m):
// a translucent swirling shell, five helical bands turning at different speeds, and debris spiralling up it.
// Presentation only: it never reads or writes gameplay.
// ============================================================

import * as THREE from 'three';

/** The Circular's slash ring radius (anime.ts circularSweep: 1.25 + 0.3 × 0.6) × 1.2 — the funnel's top. */
export const CIRCULAR_VORTEX_RADIUS_M = (1.25 + 0.3 * 0.6) * 1.2;
const BOTTOM_RADIUS_M = 0.45;
const HEIGHT_M = 2.6;
const BANDS = 5;
const DEBRIS = 90;

/** Funnel radius at height fraction u (0 = floor, 1 = top): opens faster near the top, like a tornado. */
function funnel(u: number): number {
  return BOTTOM_RADIUS_M + (CIRCULAR_VORTEX_RADIUS_M - BOTTOM_RADIUS_M) * Math.pow(u, 0.7);
}

export class CircularVortex {
  readonly object = new THREE.Group();
  private readonly bands: THREE.Mesh[] = [];
  private readonly bandMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly shell: THREE.Mesh;
  private readonly shellMaterial: THREE.MeshBasicMaterial;
  private readonly debris: THREE.Points;
  private readonly debrisMaterial: THREE.PointsMaterial;
  private readonly debrisU = new Float32Array(DEBRIS);
  private readonly debrisA = new Float32Array(DEBRIS);
  private time = 0;

  constructor(color: THREE.Color) {
    const light = color.clone().lerp(new THREE.Color(0xffffff), 0.55);
    // The shell: an open funnel, faint and swirling.
    const profile: THREE.Vector2[] = [];
    for (let i = 0; i <= 24; i++) profile.push(new THREE.Vector2(funnel(i / 24), (i / 24) * HEIGHT_M));
    this.shellMaterial = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    this.shell = new THREE.Mesh(new THREE.LatheGeometry(profile, 40), this.shellMaterial);
    this.object.add(this.shell);
    // The bands: helices hugging the funnel, alternating colour and thickness.
    for (let b = 0; b < BANDS; b++) {
      const phase = (b / BANDS) * Math.PI * 2;
      const turns = 1.4 + (b % 3) * 0.35;
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 80; i++) {
        const u = i / 80;
        const r = funnel(u) * (0.92 + 0.08 * Math.sin(u * 9 + b));
        const a = phase + u * turns * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(a) * r, u * HEIGHT_M, Math.sin(a) * r));
      }
      const material = new THREE.MeshBasicMaterial({ color: b % 2 === 0 ? color : light, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const band = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 120, b === 0 ? 0.07 : 0.035 + (b % 2) * 0.015, 6, false), material);
      this.bands.push(band);
      this.bandMaterials.push(material);
      this.object.add(band);
    }
    // Debris spiralling up the funnel.
    for (let i = 0; i < DEBRIS; i++) {
      this.debrisU[i] = (i * 0.61803) % 1;
      this.debrisA[i] = (i * 2.39996) % (Math.PI * 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DEBRIS * 3), 3));
    this.debrisMaterial = new THREE.PointsMaterial({ color: light, size: 0.09, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.debris = new THREE.Points(geometry, this.debrisMaterial);
    this.object.add(this.debris);
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
    this.time += dt;
    this.object.position.copy(pos);
    this.object.position.y -= 0.3;
    // Each band turns at its own speed (the inner ones faster), the shell slower: a twisting funnel.
    this.bands.forEach((band, i) => (band.rotation.y = this.time * (16 + i * 3)));
    this.shell.rotation.y = this.time * 9;
    // Debris climbs and spins faster as it rises (a tornado's suction).
    const positions = (this.debris.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < DEBRIS; i++) {
      this.debrisU[i] = (this.debrisU[i]! + dt * (0.55 + (i % 5) * 0.08)) % 1;
      const u = this.debrisU[i]!;
      this.debrisA[i] = this.debrisA[i]! + dt * (10 + 10 * u);
      const r = funnel(u) * (0.75 + 0.35 * ((i * 7) % 10) / 10);
      positions[i * 3] = Math.cos(this.debrisA[i]!) * r;
      positions[i * 3 + 1] = u * HEIGHT_M;
      positions[i * 3 + 2] = Math.sin(this.debrisA[i]!) * r;
    }
    this.debris.geometry.getAttribute('position').needsUpdate = true;
    // Rises out of the floor, holds, then lifts off and fades at the end.
    const grow = Math.min(1, t / 0.15);
    const alpha = grow * Math.min(1, (1 - t) / 0.22);
    for (const m of this.bandMaterials) m.opacity = 0.9 * alpha;
    this.shellMaterial.opacity = 0.16 * alpha;
    this.debrisMaterial.opacity = 0.95 * alpha;
    this.object.scale.set(0.8 + 0.2 * grow, 0.35 + 0.65 * grow, 0.8 + 0.2 * grow);
    if (t > 0.8) this.object.position.y += (t - 0.8) * 2.5;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    for (const m of this.bandMaterials) m.dispose();
    this.shellMaterial.dispose();
    this.debrisMaterial.dispose();
  }
}
