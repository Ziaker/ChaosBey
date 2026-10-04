// ============================================================
// CIRCULAR VORTEX (owner, 2026-10-04)
// "um vortex helicoidal 20% maior" → "como um tornado" → "o ataque giratório tem que ter seu efeito visual ao redor
// do bey, não dentro dele […] faça ser uma animação de efeito visual, não só um tornado girando, algo como um vortex
// que se dissipa".
// A whirl AROUND the Bey — nothing inside its body (every piece starts outside INNER_RADIUS_M): spiral wind arms that
// coil in tight as the Circular starts, spin, and shed energy outward the whole time (pulse rings and motes peel off,
// widen and fade); in the last third the arms unwind, widen and dissolve. Its reach is 20% past the Circular's slash
// ring (1.72 m). Presentation only: it never reads or writes gameplay.
// ============================================================

import * as THREE from 'three';

/** The Circular's slash ring radius (anime.ts circularSweep: 1.25 + 0.3 × 0.6) × 1.2 — the vortex's outer edge. */
export const CIRCULAR_VORTEX_RADIUS_M = (1.25 + 0.3 * 0.6) * 1.2;
/** Clear of the Bey's body (its visual radius is ~0.6 m): the effect is around it, never inside. */
export const CIRCULAR_VORTEX_INNER_RADIUS_M = 0.85;
const ARMS = 6;
const PULSES = 4;
const PULSE_PERIOD_S = 0.32;
const MOTES = 80;
const MOTE_LIFE_S = 0.55;

export class CircularVortex {
  readonly object = new THREE.Group();
  private readonly lowerArms = new THREE.Group();
  private readonly upperArms = new THREE.Group();
  private readonly armMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly pulses: THREE.Mesh[] = [];
  private readonly pulseMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly motes: THREE.Points;
  private readonly moteMaterial: THREE.PointsMaterial;
  private readonly moteAge = new Float32Array(MOTES);
  private readonly moteAngle = new Float32Array(MOTES);
  private readonly moteColor: THREE.Color;
  private time = 0;

  constructor(color: THREE.Color) {
    const light = color.clone().lerp(new THREE.Color(0xffffff), 0.55);
    this.moteColor = light;
    // Spiral arms: each coils from just outside the Bey out to the edge, with a gentle vertical wave (a 3D whirl,
    // not a flat decal). Two layers turning at different speeds.
    const span = CIRCULAR_VORTEX_RADIUS_M - CIRCULAR_VORTEX_INNER_RADIUS_M;
    for (const [group, layer] of [[this.lowerArms, 0], [this.upperArms, 1]] as const) {
      for (let a = 0; a < ARMS; a++) {
        const phase = (a / ARMS) * Math.PI * 2 + layer * 0.5;
        const points: THREE.Vector3[] = [];
        for (let i = 0; i <= 40; i++) {
          const u = i / 40;
          const r = CIRCULAR_VORTEX_INNER_RADIUS_M + span * u;
          const angle = phase - u * Math.PI * (1.05 + 0.25 * layer); // trailing back against the spin
          points.push(new THREE.Vector3(Math.cos(angle) * r, Math.sin(u * Math.PI) * (0.12 + 0.1 * layer), Math.sin(angle) * r));
        }
        const material = new THREE.MeshBasicMaterial({ color: (a + layer) % 2 === 0 ? color : light, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
        const arm = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 48, layer === 0 ? 0.05 : 0.032, 5, false), material);
        this.armMaterials.push(material);
        group.add(arm);
      }
    }
    this.upperArms.position.y = 0.32;
    this.upperArms.rotation.x = 0.08;
    this.object.add(this.lowerArms, this.upperArms);
    // Pulse rings: a new one peels off the vortex every PULSE_PERIOD_S, widening past the edge and fading.
    const ringGeometry = new THREE.TorusGeometry(1, 0.03, 6, 72);
    for (let p = 0; p < PULSES; p++) {
      const material = new THREE.MeshBasicMaterial({ color: light, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring = new THREE.Mesh(ringGeometry, material);
      ring.rotation.x = Math.PI / 2;
      this.pulses.push(ring);
      this.pulseMaterials.push(material);
      this.object.add(ring);
    }
    // Motes: born at the inner edge, flung outward along the spin, slowing and fading as they leave (dissipation).
    for (let i = 0; i < MOTES; i++) {
      this.moteAge[i] = (i / MOTES) * MOTE_LIFE_S;
      this.moteAngle[i] = (i * 2.39996) % (Math.PI * 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3));
    // Additive + vertex colour: a mote fades by darkening toward black.
    this.moteMaterial = new THREE.PointsMaterial({ size: 0.1, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.motes = new THREE.Points(geometry, this.moteMaterial);
    this.object.add(this.motes);
    this.object.visible = false;
    this.object.renderOrder = 5;
  }

  /** `t` 0..1 through the Circular; null hides it. */
  update(pos: THREE.Vector3 | null, t: number | null, dt: number): void {
    if (pos === null || t === null) {
      this.object.visible = false;
      this.time = 0;
      return;
    }
    this.object.visible = true;
    this.time += dt;
    this.object.position.copy(pos);
    this.object.position.y -= 0.15;

    // Form → spin → dissipate. Forming: the arms coil in from wider and fainter; dissipating (t > 0.65): they
    // unwind outward, slow down and fade.
    const form = Math.min(1, t / 0.14);
    const dissipate = Math.max(0, (t - 0.65) / 0.35);
    const armAlpha = form * (1 - dissipate * dissipate);
    const armScale = 1.25 - 0.25 * easeOut(form) + 0.6 * dissipate;
    const spin = 1 - 0.55 * dissipate;
    this.lowerArms.rotation.y += dt * 14 * spin;
    this.upperArms.rotation.y += dt * 19 * spin;
    this.lowerArms.scale.set(armScale, 1 + 0.8 * dissipate, armScale);
    this.upperArms.scale.set(armScale * 0.95, 1 + 1.2 * dissipate, armScale * 0.95);
    this.upperArms.position.y = 0.32 + 0.5 * dissipate;
    this.armMaterials.forEach((m, i) => (m.opacity = (i < ARMS ? 0.85 : 0.6) * armAlpha));

    // Pulses: shed continuously while the vortex is up; each widens from the inner edge to ~1.5× the reach.
    for (let p = 0; p < PULSES; p++) {
      const ring = this.pulses[p]!;
      const phase = (((this.time / PULSE_PERIOD_S + p / PULSES) % 1) + 1) % 1;
      const radius = CIRCULAR_VORTEX_INNER_RADIUS_M + (CIRCULAR_VORTEX_RADIUS_M * 1.5 - CIRCULAR_VORTEX_INNER_RADIUS_M) * easeOut(phase);
      ring.scale.set(radius, radius, radius * (1 - 0.7 * phase));
      ring.position.y = 0.05 + 0.35 * phase;
      this.pulseMaterials[p]!.opacity = 0.7 * (1 - phase) * (1 - phase) * form * (1 - dissipate);
    }

    // Motes: spiral outward, the angular speed dropping with radius (a real vortex), and fade out.
    const positions = (this.motes.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const colors = (this.motes.geometry.getAttribute('color') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < MOTES; i++) {
      this.moteAge[i] = this.moteAge[i]! + dt;
      if (this.moteAge[i]! >= MOTE_LIFE_S) {
        this.moteAge[i] = this.moteAge[i]! - MOTE_LIFE_S;
        this.moteAngle[i] = this.moteAngle[i]! + 2.39996;
      }
      const u = this.moteAge[i]! / MOTE_LIFE_S;
      const r = CIRCULAR_VORTEX_INNER_RADIUS_M + (CIRCULAR_VORTEX_RADIUS_M * 1.35 - CIRCULAR_VORTEX_INNER_RADIUS_M) * easeOut(u);
      this.moteAngle[i] = this.moteAngle[i]! + dt * 16 * spin * (CIRCULAR_VORTEX_INNER_RADIUS_M / r);
      positions[i * 3] = Math.cos(this.moteAngle[i]!) * r;
      positions[i * 3 + 1] = (((i * 7) % 10) / 10) * 0.45 + u * 0.5;
      positions[i * 3 + 2] = Math.sin(this.moteAngle[i]!) * r;
      const fade = (1 - u) * Math.min(1, u * 6);
      colors[i * 3] = this.moteColor.r * fade;
      colors[i * 3 + 1] = this.moteColor.g * fade;
      colors[i * 3 + 2] = this.moteColor.b * fade;
    }
    this.motes.geometry.getAttribute('position').needsUpdate = true;
    this.motes.geometry.getAttribute('color').needsUpdate = true;
    this.moteMaterial.opacity = form * (1 - dissipate * 0.6);
  }

  dispose(): void {
    this.object.removeFromParent();
    const geometries = new Set<THREE.BufferGeometry>();
    this.object.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
    });
    for (const g of geometries) g.dispose();
    for (const m of this.armMaterials) m.dispose();
    for (const m of this.pulseMaterials) m.dispose();
    this.moteMaterial.dispose();
  }
}

function easeOut(x: number): number {
  return 1 - (1 - x) * (1 - x);
}
