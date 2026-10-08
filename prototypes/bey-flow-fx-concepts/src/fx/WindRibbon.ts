// ============================================================
// BEY FLOW FX LAB — WIND RIBBON
// A tapered, camera-facing band that trails a point on the Bey's rim and
// follows its real path (the cyan/white air streak in the owner's
// references). The same class draws the thin helix strands that spiral
// around the main ribbon: they share the path history and only differ in
// width, colour and the helical offset.
//
// History is a small ring of timestamped samples; geometry is rebuilt each
// frame into one pre-allocated triangle strip, so there is no per-frame
// allocation. Samples carry their own width and strength, so a Dash that
// ended a moment ago still draws its thick part of the trail.
// ============================================================

import * as THREE from 'three';

// ---------------- TUNING ----------------
const MAX_SAMPLES = 96;
const HEAD_FADE_IN = 0.08;       // fraction of the ribbon over which the head grows from a point
const WIDTH_TAPER_POWER = 0.8;
const ALPHA_TAPER_POWER = 0.7;
const WAVE_ONSET = 0.3;          // the sideways wave reaches full size this far along the ribbon
const HELIX_ONSET = 0.25;
const COLOR_BLEND_POWER = 0.5;
// -----------------------------------------

export interface RibbonShape {
  lifeS: number;
  opacity: number;
  /** Sideways sine wave, metres at full size. */
  waveM: number;
  waveHz: number;
  /** Helix around the path: 0 = a plain ribbon. */
  helixRadiusM: number;
  helixTurnsPerS: number;
  helixPhase: number;
  /** Multiplies every sample's width (a helix strand is much thinner). */
  widthScale: number;
  /** Replaces the sample width when set (m); the sample's strength still applies. */
  widthOverrideM?: number;
  headColor: THREE.Color;
  tailColor: THREE.Color;
}

const _side = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tan = new THREE.Vector3();
const _view = new THREE.Vector3();
const _p = new THREE.Vector3();
const _col = new THREE.Color();

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class WindRibbon {
  readonly mesh: THREE.Mesh;
  private readonly geometry = new THREE.BufferGeometry();
  private readonly positions = new Float32Array(MAX_SAMPLES * 2 * 3);
  private readonly colors = new Float32Array(MAX_SAMPLES * 2 * 4);
  // Ring of samples, oldest at `start`.
  private readonly sx = new Float32Array(MAX_SAMPLES);
  private readonly sy = new Float32Array(MAX_SAMPLES);
  private readonly sz = new Float32Array(MAX_SAMPLES);
  private readonly st = new Float32Array(MAX_SAMPLES);
  private readonly sw = new Float32Array(MAX_SAMPLES);
  private readonly ss = new Float32Array(MAX_SAMPLES);
  private start = 0;
  private count = 0;
  private readonly material: THREE.MeshBasicMaterial;

  constructor() {
    const index: number[] = [];
    for (let i = 0; i < MAX_SAMPLES - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(index);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  get sampleCount(): number {
    return this.count;
  }

  /** Records one point of the path. `strength` 0..1 scales the opacity, `widthM` is the full width there. */
  push(timeS: number, pos: THREE.Vector3, strength: number, widthM: number): void {
    const slot = (this.start + this.count) % MAX_SAMPLES;
    if (this.count === MAX_SAMPLES) this.start = (this.start + 1) % MAX_SAMPLES;
    else this.count++;
    this.sx[slot] = pos.x;
    this.sy[slot] = pos.y;
    this.sz[slot] = pos.z;
    this.st[slot] = timeS;
    this.ss[slot] = strength;
    this.sw[slot] = widthM;
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  /** Rebuilds the strip for time `nowS`, facing `cameraPos`. */
  update(nowS: number, cameraPos: THREE.Vector3, shape: RibbonShape): void {
    // Drop expired samples from the old end.
    while (this.count > 0 && nowS - this.st[this.start]! > shape.lifeS) {
      this.start = (this.start + 1) % MAX_SAMPLES;
      this.count--;
    }
    const n = this.count;
    if (n < 2) {
      this.geometry.setDrawRange(0, 0);
      return;
    }
    // Newest sample first so index 0 is the head (u = 0).
    for (let k = 0; k < n; k++) {
      const slot = (this.start + (n - 1 - k)) % MAX_SAMPLES;
      const newer = (this.start + Math.min(n - 1, n - k)) % MAX_SAMPLES; // toward the head
      const older = (this.start + Math.max(0, n - 2 - k)) % MAX_SAMPLES; // toward the tail
      const age = nowS - this.st[slot]!;
      const u = Math.min(1, Math.max(0, age / shape.lifeS));

      _tan.set(this.sx[newer]! - this.sx[older]!, this.sy[newer]! - this.sy[older]!, this.sz[newer]! - this.sz[older]!);
      if (_tan.lengthSq() < 1e-10) _tan.set(1, 0, 0);
      _tan.normalize();
      _p.set(this.sx[slot]!, this.sy[slot]!, this.sz[slot]!);
      _view.copy(cameraPos).sub(_p);
      _side.crossVectors(_tan, _view);
      if (_side.lengthSq() < 1e-10) _side.set(0, 0, 1).cross(_tan);
      _side.normalize();
      _up.crossVectors(_side, _tan).normalize();

      // Offsets: sideways wave, then helix around the path.
      const wave = shape.waveM * Math.sin(Math.PI * 2 * shape.waveHz * this.st[slot]!) * smoothstep(0, WAVE_ONSET, u);
      let ox = _side.x * wave;
      let oy = _side.y * wave;
      let oz = _side.z * wave;
      if (shape.helixRadiusM > 0) {
        const phi = Math.PI * 2 * shape.helixTurnsPerS * this.st[slot]! + shape.helixPhase;
        const rad = shape.helixRadiusM * smoothstep(0, HELIX_ONSET, u);
        const c = Math.cos(phi) * rad;
        const s = Math.sin(phi) * rad;
        ox += _side.x * c + _up.x * s;
        oy += _side.y * c + _up.y * s;
        oz += _side.z * c + _up.z * s;
      }

      const baseWidth = shape.widthOverrideM ?? this.sw[slot]!;
      const half =
        0.5 * baseWidth * shape.widthScale * smoothstep(0, HEAD_FADE_IN, u) * Math.pow(1 - u, WIDTH_TAPER_POWER);
      const cx = _p.x + ox;
      const cy = _p.y + oy;
      const cz = _p.z + oz;
      const v = k * 2 * 3;
      this.positions[v] = cx + _side.x * half;
      this.positions[v + 1] = cy + _side.y * half;
      this.positions[v + 2] = cz + _side.z * half;
      this.positions[v + 3] = cx - _side.x * half;
      this.positions[v + 4] = cy - _side.y * half;
      this.positions[v + 5] = cz - _side.z * half;

      _col.copy(shape.headColor).lerp(shape.tailColor, Math.pow(u, COLOR_BLEND_POWER));
      const alpha = shape.opacity * this.ss[slot]! * Math.pow(1 - u, ALPHA_TAPER_POWER);
      const c4 = k * 2 * 4;
      for (let s = 0; s < 2; s++) {
        this.colors[c4 + s * 4] = _col.r;
        this.colors[c4 + s * 4 + 1] = _col.g;
        this.colors[c4 + s * 4 + 2] = _col.b;
        this.colors[c4 + s * 4 + 3] = alpha;
      }
    }
    this.geometry.setDrawRange(0, (n - 1) * 6);
    (this.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
