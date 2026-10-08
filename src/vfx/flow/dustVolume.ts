// ============================================================
// BEY FLOW FX LAB — DUST AS REAL VOLUME
// The first four rounds drew the dust as flat pictures (stickers, then cutouts)
// and the owner said they were "paper": images laid over the game, not things
// inside it. This round the dust is geometry. Every puff is a pile of spheres
// and stretched ellipsoids (the blob chains of the owner's third reference
// sheet), cel-shaded in two or three flat tones by the arena's own lights,
// drawn in ONE instanced draw call, depth-tested against the floor and the
// Beys: a Bey passes in front of a cloud and behind another, a cloud sinks into
// the floor, and the arena's fog thins it with distance.
//
// Opacity is per puff and hashed (stochastic alpha with depth writes), so a
// hundred overlapping lumps still sort correctly. Dying is by shrinking: the
// small lumps and thin needles go first, the way the sheets' smoke breaks up.
//
// The lump layouts are plain functions of a seed (no THREE), so the tests can
// check them. Presentation only: nothing here reads or writes the simulation.
// ============================================================

import * as THREE from 'three';

// ---------------- TUNING ----------------
const SPHERE_DETAIL = 2;               // icosahedron subdivisions: ~320 triangles a lump
const DEFAULT_CAPACITY = 2600;
const GRADIENT_STEPS: readonly number[] = [0.6, 0.86, 1];   // flat tones of the cel shading, dark to lit
const EMISSIVE_INTENSITY = 0.28;       // keeps the white readable in the dim arenas
const GROW_TIME = 0.28;                // fraction of life to reach full size
const SHRINK_START_MIN = 0.35;         // a lump may start shrinking this early…
const SHRINK_START_SPAN = 0.35;        // …up to this much later, by its order
const DRAG_PER_S = 1.5;
const RISE_MPS = 0.35;
// -----------------------------------------

export type VolumeKind = 'puff' | 'wave' | 'burst' | 'crown';
export const VOLUME_KINDS: readonly VolumeKind[] = ['puff', 'wave', 'burst', 'crown'];

/**
 * One lump of a puff, in the puff's local frame: +x is the way it points (the direction the dust trails or rolls out), y is up,
 * z is sideways. The sizes are semi-axes in "puff units" (a puff is about 1 tall). `yaw` and `pitch` turn the lump's own long
 * axis (x) away from the puff's. `order` runs 0..1: the lumps with the smallest order shrink away first.
 */
export interface Lump {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly order: number;
}

/** mulberry32: a small deterministic generator. */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Draft {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  yaw: number;
  pitch: number;
  /** Thin features (needles, tails) die first whatever their size. */
  thin: boolean;
}

const ball = (x: number, y: number, z: number, r: number): Draft => ({ x, y, z, sx: r, sy: r, sz: r, yaw: 0, pitch: 0, thin: false });

/** Needles and tails: long and thin along their own x. */
const needle = (x: number, y: number, z: number, length: number, thickness: number, yaw: number, pitch: number): Draft => ({
  x,
  y,
  z,
  sx: length,
  sy: thickness * 0.55,
  sz: thickness,
  yaw,
  pitch,
  thin: true,
});

/** Turns drafts into lumps: smaller lumps get a smaller `order` (they shrink first), thin ones the smallest, with a little noise. */
function finish(drafts: readonly Draft[], rand: () => number): Lump[] {
  const radii = drafts.filter((d) => !d.thin).map((d) => Math.max(d.sx, d.sy, d.sz));
  const lo = Math.min(...radii);
  const hi = Math.max(...radii);
  return drafts.map((d) => {
    const r = Math.max(d.sx, d.sy, d.sz);
    const order = d.thin ? rand() * 0.18 : 0.2 + 0.65 * ((r - lo) / Math.max(1e-6, hi - lo)) + rand() * 0.15;
    return { x: d.x, y: d.y, z: d.z, sx: d.sx, sy: d.sy, sz: d.sz, yaw: d.yaw, pitch: d.pitch, order: Math.min(1, order) };
  });
}

/** A cumulus heap: a bell-shaped row of lumps on the floor, a second tier, big hero lumps near the peak, small satellites off the top. */
function heap(rand: () => number, span: number, centreX: number, scale: number): Draft[] {
  const out: Draft[] = [];
  const peak = 0.35 + rand() * 0.3;
  const baseN = 7 + Math.floor(rand() * 3);
  for (let i = 0; i < baseN; i++) {
    const t = i / (baseN - 1);
    const bell = Math.exp(-(((t - peak) / 0.32) ** 2));
    const r = (0.18 + 0.34 * bell) * (0.75 + 0.5 * rand()) * scale;
    out.push(ball(centreX + (t - 0.5) * span + (rand() - 0.5) * 0.12 * scale, r * 0.7, (rand() - 0.5) * 0.55 * bell * scale, r));
  }
  const px = centreX + (peak - 0.5) * span;
  for (let i = 0; i < 3 + Math.floor(rand() * 2); i++) {
    const r = (0.3 + 0.2 * rand()) * scale;
    out.push(ball(px + (rand() - 0.5) * 0.9 * scale, (0.55 + 0.3 * rand()) * scale, (rand() - 0.5) * 0.3 * scale, r));
  }
  for (let i = 0; i < 1 + Math.floor(rand() * 2); i++) {
    const r = (0.4 + 0.12 * rand()) * scale;
    out.push(ball(px + (rand() - 0.5) * 0.5 * scale, (0.6 + 0.2 * rand()) * scale, (rand() - 0.5) * 0.2 * scale, r));
  }
  const heads = out.length;
  for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) {
    const host = out[Math.floor(rand() * heads)]!;
    const a = Math.PI / 2 + (rand() - 0.5) * 2;
    out.push(ball(host.x + Math.cos(a) * host.sx * 0.9, host.y + Math.sin(a) * host.sy * 1.05, host.z, host.sx * (0.2 + 0.15 * rand())));
  }
  return out;
}

/** The lumps of one puff of `kind` for `seed`. Pure and deterministic. */
export function lumpsFor(kind: VolumeKind, seed: number): Lump[] {
  const rand = rng(seed * 7919 + kind.length * 104729 + kind.charCodeAt(0));
  let drafts: Draft[] = [];
  if (kind === 'puff') {
    drafts = heap(rand, 1.9, 0, 1);
  } else if (kind === 'wave') {
    // The billowing mass at the far end (+x), a bell of lumps hugging the floor; thin swept tails run back toward the Bey (x = 0).
    const peak = 0.4 + rand() * 0.25;
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      const bell = Math.exp(-(((t - peak) / 0.3) ** 2));
      const r = (0.2 + 0.36 * bell) * (0.8 + 0.4 * rand());
      drafts.push(ball(1.5 + 1.7 * t, r * 0.7, (rand() - 0.5) * 0.45, r));
    }
    for (let i = 0; i < 3; i++) drafts.push(ball(2 + 0.9 * rand(), 0.5 + 0.3 * rand(), (rand() - 0.5) * 0.3, 0.3 + 0.12 * rand()));
    for (let i = 0; i < 5; i++) {
      const length = 0.55 - i * 0.06 + rand() * 0.12;
      drafts.push(needle(0.2 + length + i * 0.14, 0.05 + 0.075 * i, (i % 2 === 0 ? 1 : -1) * (0.04 * i + rand() * 0.08), length, 0.09 - 0.01 * i, (rand() - 0.5) * 0.08, 0));
    }
  } else if (kind === 'burst') {
    drafts = heap(rand, 1.5, 0, 1.05);
    const n = 9 + Math.floor(rand() * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.4;
      const length = 0.3 + 0.45 * rand();
      const radius = 1.05 + 0.35 * rand();
      const pitch = 0.15 + 0.35 * rand();
      drafts.push(needle(Math.cos(a) * radius, 0.12 + Math.sin(pitch) * length, Math.sin(a) * radius, length, 0.05 + 0.03 * rand(), -a, pitch));
    }
  } else {
    // The crown: a ring of puffs lying in the floor with a hollow middle, and spikes radiating out and a little up.
    const n = 15 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (rand() - 0.5) * 0.2;
      const r = 0.13 + 0.12 * rand();
      const d = 0.95 + 0.14 * rand();
      drafts.push(ball(Math.cos(a) * d, r * 0.55, Math.sin(a) * d, r));
    }
    const m = 24 + Math.floor(rand() * 5);
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2 + (rand() - 0.5) * 0.15;
      const length = 0.22 + 0.4 * rand();
      const pitch = 0.15 + 0.35 * rand();
      const centre = 1.0 + length * Math.cos(pitch);
      drafts.push(needle(Math.cos(a) * centre, 0.05 + Math.sin(pitch) * length, Math.sin(a) * centre, length, 0.05 + 0.03 * rand(), -a, pitch));
    }
  }
  return finish(drafts, rand);
}

/** 0 at the start, 1 once grown: eased. */
export function growFactor(k: number, growFrom: number): number {
  const t = Math.min(1, Math.max(0, k / GROW_TIME));
  return growFrom + (1 - growFrom) * (1 - Math.pow(1 - t, 3));
}

/** Opacity over the life: `opacity` while whole, then down to zero. `fade` 0 holds it to the very end, 1 starts fading at once. */
export function lifeOpacity(k: number, opacity: number, fade: number): number {
  const start = 1 - Math.min(1, Math.max(0, fade));
  const t = Math.min(1, Math.max(0, (k - start) / Math.max(1e-4, 1 - start)));
  return opacity * (1 - t);
}

/** The scale a lump keeps at life `k`: 1 until its turn, then shrinking by `shrink` (1 = all the way to nothing at the end). */
export function shrinkFactor(k: number, order: number, shrink: number): number {
  const start = SHRINK_START_MIN + SHRINK_START_SPAN * order;
  const t = Math.min(1, Math.max(0, (k - start) / (1 - start)));
  return 1 - Math.min(1, Math.max(0, shrink)) * Math.pow(t, 1.2);
}

export interface VolumeParams {
  /** Starting opacity, 0..1. */
  readonly opacity: number;
  /** How early the puff starts turning transparent: 0 = only at the very end, 1 = from the first moment. */
  readonly fade: number;
  /** How much the lumps shrink by the end of the life, 0..1. */
  readonly shrink: number;
}

export interface VolumeSpawn {
  readonly kind: VolumeKind;
  /** Where the puff stands (its floor point); a copy is kept. */
  readonly pos: THREE.Vector3;
  /** Rotation about the vertical axis that turns the puff's +x onto the wanted direction: yaw = atan2(-dz, dx). */
  readonly yaw: number;
  /** One puff unit in metres (the puff's height). */
  readonly size: number;
  readonly life: number;
  readonly vel: THREE.Vector3;
  readonly seed: number;
  readonly growFrom?: number;
  /** Tilts the whole puff to the floor (the crown lies on the funnel's slope). */
  readonly tilt?: THREE.Quaternion;
  /** Metres per second the puff rises; 0 for a crown that must stay on the floor. */
  readonly rise?: number;
}

interface Puff {
  readonly lumps: readonly Lump[];
  readonly pos: THREE.Vector3;
  readonly vel: THREE.Vector3;
  readonly quat: THREE.Quaternion;
  readonly size: number;
  readonly life: number;
  readonly growFrom: number;
  readonly rise: number;
  age: number;
}

function gradientMap(): THREE.DataTexture {
  const data = new Uint8Array(GRADIENT_STEPS.length * 4);
  GRADIENT_STEPS.forEach((v, i) => {
    const b = Math.round(v * 255);
    data.set([b, b, b, 255], i * 4);
  });
  const tex = new THREE.DataTexture(data, GRADIENT_STEPS.length, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _lq = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _qz = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _axisZ = new THREE.Vector3(0, 0, 1);

export class DustVolume {
  readonly mesh: THREE.InstancedMesh;
  private readonly puffs: Puff[] = [];
  private readonly opacity: THREE.InstancedBufferAttribute;
  private readonly material: THREE.MeshToonMaterial;
  private readonly geometry: THREE.IcosahedronGeometry;
  private lumps = 0;

  constructor(
    scene: THREE.Object3D,
    private readonly capacity = DEFAULT_CAPACITY,
  ) {
    this.geometry = new THREE.IcosahedronGeometry(1, SPHERE_DETAIL);
    this.opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.opacity.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('instanceOpacity', this.opacity);
    this.material = new THREE.MeshToonMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: EMISSIVE_INTENSITY,
      gradientMap: gradientMap(),
      alphaHash: true,
    });
    // Per-instance opacity: multiplied into the colour's alpha before the hashed alpha test decides.
    this.material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float instanceOpacity;\nvarying float vInstanceOpacity;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceOpacity = instanceOpacity;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vInstanceOpacity;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vInstanceOpacity;');
    };
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.name = 'bey-flow-dust';
    scene.add(this.mesh);
  }

  /** Puffs alive. */
  get puffCount(): number {
    return this.puffs.length;
  }

  /** Lumps (instances) drawn. */
  get lumpCount(): number {
    return this.lumps;
  }

  spawn(o: VolumeSpawn): void {
    const lumps = lumpsFor(o.kind, o.seed);
    // Make room: the oldest puffs go first when the pool would overflow.
    let total = this.puffs.reduce((n, p) => n + p.lumps.length, 0) + lumps.length;
    while (total > this.capacity && this.puffs.length > 0) total -= this.puffs.shift()!.lumps.length;
    const quat = new THREE.Quaternion().setFromAxisAngle(_up, o.yaw);
    if (o.tilt) quat.premultiply(o.tilt);
    this.puffs.push({ lumps, pos: o.pos.clone(), vel: o.vel.clone(), quat, size: o.size, life: o.life, growFrom: o.growFrom ?? 0.55, rise: o.rise ?? RISE_MPS, age: 0 });
  }

  clear(): void {
    this.puffs.length = 0;
    this.lumps = 0;
    this.mesh.count = 0;
  }

  /** Ages every puff, drops the dead ones and rewrites the instances (positions, sizes and opacities). */
  update(dt: number, params: VolumeParams): void {
    let n = 0;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const puff = this.puffs[i]!;
      puff.age += dt;
      if (puff.age >= puff.life) this.puffs.splice(i, 1);
    }
    for (const puff of this.puffs) {
      const k = puff.age / puff.life;
      puff.vel.multiplyScalar(Math.max(0, 1 - DRAG_PER_S * dt));
      puff.pos.addScaledVector(puff.vel, dt);
      puff.pos.y += puff.rise * dt;
      const scale = puff.size * growFactor(k, puff.growFrom);
      const alpha = lifeOpacity(k, params.opacity, params.fade);
      for (const l of puff.lumps) {
        if (n >= this.capacity) break;
        const shrink = shrinkFactor(k, l.order, params.shrink);
        _p.set(l.x, l.y, l.z).multiplyScalar(scale).applyQuaternion(puff.quat).add(puff.pos);
        _qy.setFromAxisAngle(_up, l.yaw);
        _qz.setFromAxisAngle(_axisZ, l.pitch);
        _lq.copy(_qy).multiply(_qz);
        _q.copy(puff.quat).multiply(_lq);
        _s.set(l.sx * scale * shrink, l.sy * scale * shrink, l.sz * scale * shrink);
        _m.compose(_p, _q, _s);
        this.mesh.setMatrixAt(n, _m);
        this.opacity.setX(n, alpha);
        n++;
      }
    }
    this.lumps = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.opacity.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.material.gradientMap?.dispose();
    this.mesh.dispose();
  }
}
