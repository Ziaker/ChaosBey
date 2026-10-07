// ============================================================
// DRIFT VFX (owner playtest, after M11)
// "Hop, hold X, turn" had no visible drift: nothing showed that the Bey
// had entered it or left it. While a Bey is Drifting this draws, at its
// tip on the floor:
// - skid marks: the approved VFX language's (Hybrid C takes Mechanical's
//   high-speed skid marks, `skidMarks` 1): a black soft-dot decal, 2.5 s
//   life, held at full opacity for the first 60% — denser and wider than
//   the lab's high-speed marks so a drift leaves a continuous stripe;
// - contact sparks: the lab's streak sparks (hot → cool, gravity, floor
//   bounce), in the arena's own spark colors (Arena Concept Lab), thrown
//   back and outward from the slide at a rate that grows with how fast the
//   tip is sliding sideways;
// - a scuff at the drift's start and a bright grip-regain ring when it
//   ends, so entering and leaving are both readable at a glance.
// Render only: it reads the simulation's result each frame and never
// feeds anything back. Its "randomness" is a local fixed-seed generator,
// so the same fight draws the same effect.
// ============================================================

import * as THREE from 'three';

/** Seconds between skid-mark decals (lab high-speed marks: 0.035). */
const SKID_INTERVAL_S = 0.02;
/** Skid-mark decal size (m) and opacity (lab: 0.28 m, 0.35 × `skidMarks` 1). */
const SKID_SIZE_M = 0.36;
const SKID_OPACITY = 0.55;
/** Lab decal timing: 2.5 s life, full opacity for the first 60%. */
const SKID_LIFE_S = 2.5;
const SKID_HOLD = 0.6;
/** Sideways slide speed (m/s) at which sparks come every frame. */
const SPARK_FULL_RATE_SLIDE_MPS = 5;
const SPARK_MAX = 240;
const DRIFT_START_SCUFF_SIZE_M = 1.1;
const GRIP_RING_LIFE_S = 0.4;

interface Decal {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  age: number;
  life: number;
  hold: number;
  baseOpacity: number;
  size: [number, number];
}

interface Spark {
  p: THREE.Vector3;
  v: THREE.Vector3;
  life: number;
  max: number;
}

/** What one Bey's drift effect needs from the simulation this frame. */
export interface DriftVfxInput {
  readonly position: { x: number; y: number; z: number };
  readonly velocity: { x: number; y: number; z: number };
  readonly headingRad: number;
  readonly driftState: string;
  readonly grounded: boolean;
}

let softDotTexture: THREE.Texture | null = null;
/** The VFX Lab's soft round dot (textures.ts `softDot`), drawn once. Headless (no DOM, e.g. a Node test of a real session): a blank texture. */
function softDot(): THREE.Texture {
  if (softDotTexture) return softDotTexture;
  if (typeof document === 'undefined') return (softDotTexture = new THREE.Texture());
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (g) {
    const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,0.75)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, size, size);
  }
  softDotTexture = new THREE.CanvasTexture(canvas);
  return softDotTexture;
}

const PLANE = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

export class DriftVfx {
  readonly object3D = new THREE.Group();
  private readonly decals: Decal[] = [];
  private readonly sparks: Spark[] = [];
  private readonly sparkLines: THREE.LineSegments;
  private readonly sparkPos: THREE.BufferAttribute;
  private readonly sparkCol: THREE.BufferAttribute;
  private readonly hot: THREE.Color;
  private readonly cool: THREE.Color;
  private skidTimer = 0;
  private wasDrifting = false;
  private seed = 0x2f6b1a3;
  /** Drift entries/exits drawn so far (read by tests and the smoke). */
  private starts = 0;
  private ends = 0;

  constructor(
    hotHex: number,
    coolHex: number,
    private readonly floorHeightAt: (x: number, z: number) => number = () => 0,
    /** Owner, 2026-10-05: × every drift mark and spark (the Bey size × the effects size). 1 = the approved look. */
    private readonly effectScale = 1,
  ) {
    this.hot = new THREE.Color(hotHex);
    this.cool = new THREE.Color(coolHex);
    const g = new THREE.BufferGeometry();
    this.sparkPos = new THREE.BufferAttribute(new Float32Array(SPARK_MAX * 6), 3);
    this.sparkCol = new THREE.BufferAttribute(new Float32Array(SPARK_MAX * 6), 3);
    g.setAttribute('position', this.sparkPos);
    g.setAttribute('color', this.sparkCol);
    g.setDrawRange(0, 0);
    this.sparkLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.sparkLines.frustumCulled = false;
    this.object3D.add(this.sparkLines);
  }

  /** Effects spawned so far, for tests/inspection. */
  getCounts(): { drawnDecals: number; liveSparks: number; driftStarts: number; driftEnds: number } {
    return { drawnDecals: this.decals.length, liveSparks: this.sparks.length, driftStarts: this.starts, driftEnds: this.ends };
  }

  update(dt: number, bey: DriftVfxInput): void {
    const drifting = bey.driftState === 'Drifting';
    const tipY = this.floorHeightAt(bey.position.x, bey.position.z) + 0.015;
    const tip = new THREE.Vector3(bey.position.x, tipY, bey.position.z);

    if (drifting && !this.wasDrifting) {
      this.starts++;
      this.addDecal(tip, 0x000000, [DRIFT_START_SCUFF_SIZE_M * 0.6, DRIFT_START_SCUFF_SIZE_M], SKID_LIFE_S, 0.5, SKID_HOLD, false);
    }
    if (!drifting && this.wasDrifting) {
      this.ends++;
      // Grip back: a bright ring expanding from the tip.
      this.addDecal(tip.clone().setY(tipY + 0.005), this.hot.getHex(), [0.3, 1.8], GRIP_RING_LIFE_S, 0.9, 0, true);
    }
    this.wasDrifting = drifting;

    if (drifting && bey.grounded) {
      this.skidTimer -= dt;
      while (this.skidTimer <= 0) {
        this.skidTimer += SKID_INTERVAL_S;
        this.addDecal(tip, 0x000000, [SKID_SIZE_M, SKID_SIZE_M], SKID_LIFE_S, SKID_OPACITY, SKID_HOLD, false);
      }
      // Sideways slide speed: the velocity across the heading.
      const side = -bey.velocity.x * Math.cos(bey.headingRad) + bey.velocity.z * Math.sin(bey.headingRad);
      const rate = Math.min(0.95, Math.abs(side) / SPARK_FULL_RATE_SLIDE_MPS);
      if (this.random() < rate) {
        const speed = Math.hypot(bey.velocity.x, bey.velocity.z) || 1;
        const back = new THREE.Vector3(-bey.velocity.x / speed, 0, -bey.velocity.z / speed);
        this.emitSparks(tip, back, 3, 4, 0.9, [0.15, 0.35], 0.35);
      }
    } else {
      this.skidTimer = 0;
    }

    this.tickDecals(dt);
    this.tickSparks(dt);
  }

  dispose(): void {
    for (const d of this.decals) {
      this.object3D.remove(d.mesh);
      d.material.dispose();
    }
    this.decals.length = 0;
    this.sparkLines.geometry.dispose();
    (this.sparkLines.material as THREE.Material).dispose();
  }

  private addDecal(pos: THREE.Vector3, color: number, size: [number, number], life: number, opacity: number, hold: number, additive: boolean): void {
    const material = new THREE.MeshBasicMaterial({
      map: softDot(),
      color,
      transparent: true,
      depthWrite: false,
      opacity,
      side: THREE.DoubleSide,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mesh = new THREE.Mesh(PLANE, material);
    mesh.position.copy(pos);
    const scaled: [number, number] = [size[0] * this.effectScale, size[1] * this.effectScale];
    mesh.scale.set(scaled[0], 1, scaled[0]);
    this.object3D.add(mesh);
    this.decals.push({ mesh, material, age: 0, life, hold, baseOpacity: opacity, size: scaled });
  }

  private tickDecals(dt: number): void {
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i]!;
      d.age += dt;
      const k = Math.min(1, d.age / d.life);
      const grow = Math.min(1, k * (d.hold > 0 ? 6 : 1));
      const s = d.size[0] + (d.size[1] - d.size[0]) * (1 - (1 - grow) * (1 - grow));
      d.mesh.scale.set(s, 1, s);
      d.material.opacity = d.baseOpacity * (k < d.hold ? 1 : 1 - (k - d.hold) / (1 - d.hold));
      if (d.age >= d.life) {
        this.object3D.remove(d.mesh);
        d.material.dispose();
        this.decals.splice(i, 1);
      }
    }
  }

  /** The lab's StreakSparks.emit. */
  private emitSparks(at: THREE.Vector3, dir: THREE.Vector3, count: number, speed: number, spread: number, life: [number, number], upBias: number): void {
    for (let i = 0; i < count; i++) {
      if (this.sparks.length >= SPARK_MAX) this.sparks.shift();
      const v = dir
        .clone()
        .add(new THREE.Vector3(this.random() - 0.5, this.random() - 0.5 + upBias, this.random() - 0.5).multiplyScalar(spread))
        .normalize()
        .multiplyScalar(speed * this.effectScale * (0.35 + this.random() * 0.9));
      const l = life[0] + this.random() * (life[1] - life[0]);
      this.sparks.push({ p: at.clone(), v, life: l, max: l });
    }
  }

  /** The lab's StreakSparks.tick: gravity, floor bounce (0.35), hot → cool streaks. */
  private tickSparks(dt: number): void {
    const c = new THREE.Color();
    let n = 0;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      s.life -= dt;
      if (s.life <= 0) {
        this.sparks.splice(i, 1);
        continue;
      }
      s.v.y -= 9.8 * dt;
      s.p.addScaledVector(s.v, dt);
      const floor = this.floorHeightAt(s.p.x, s.p.z);
      if (s.p.y < floor) {
        s.p.y = floor;
        s.v.y = Math.abs(s.v.y) * 0.35;
        s.v.x *= 0.6;
        s.v.z *= 0.6;
      }
      const k = s.life / s.max;
      c.copy(this.cool).lerp(this.hot, k).multiplyScalar(0.4 + k);
      const stretch = 0.035;
      this.sparkPos.setXYZ(n * 2, s.p.x, s.p.y, s.p.z);
      this.sparkPos.setXYZ(n * 2 + 1, s.p.x - s.v.x * stretch, s.p.y - s.v.y * stretch, s.p.z - s.v.z * stretch);
      this.sparkCol.setXYZ(n * 2, c.r, c.g, c.b);
      this.sparkCol.setXYZ(n * 2 + 1, c.r * 0.2, c.g * 0.2, c.b * 0.2);
      n++;
    }
    this.sparkLines.geometry.setDrawRange(0, n * 2);
    this.sparkPos.needsUpdate = true;
    this.sparkCol.needsUpdate = true;
  }

  /** Fixed-seed LCG in [0, 1): the same fight draws the same sparks. */
  private random(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}
