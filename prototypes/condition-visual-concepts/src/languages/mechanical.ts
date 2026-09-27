// ============================================================
// LANGUAGE A — DESGASTE MECÂNICO (MECHANICAL WEAR)
// Nothing that couldn't physically exist. Condition is read from motion,
// material and contact with the floor — the same "mechanical" family as
// the approved VFX contact sparks, chips and dust (decisions doc §3b).
//
//   Stamina   → the tip scribes a rosette on the floor that opens up; the
//               rim starts to grind and throw sparks; faint smoke at the end.
//   Stability → the four pieces go loose and rattle, the seams open, the
//               paint darkens and loses its lacquer; hits knock chips off.
//   Broken    → limping lean with the rim grinding continuously, smoke from
//               the Driver, and the spin hiccups (shared physics).
// ============================================================

import * as THREE from 'three';
import type { ConditionEvent } from '../sim/ConditionSim';
import type { ConditionLayer, LayerContext, LayerFrame } from './types';

// ---------------- LANGUAGE A TUNING (multiplied by the sliders) ----------------
const TRAIL_MAX_POINTS = 320;
const TRAIL_SAMPLE_S = 1 / 40;
const TRAIL_WIDTH_M = 0.03;            // Scribe line width when healthy…
const TRAIL_WIDTH_WOBBLE_M = 0.035;    // …plus this much at full wobble.
const TRAIL_COLOR = 0xd9dce2;          // Bright steel scratch on a dark floor.
const GRIND_RATE_CONTACT = 70;         // Sparks per second while the rim touches.
const GRIND_RATE_BROKEN = 22;          // Extra sparks per second while broken.
const GRIND_RATE_LOW_STAMINA = 10;     // Extra sparks per second near zero Stamina.
const GRIND_COLORS = [0xffd27a, 0xffa640, 0xff7a1f];
const SMOKE_RATE_BROKEN = 5;           // Puffs per second while broken.
const SMOKE_RATE_LOW_STAMINA = 2;      // Puffs per second near zero Stamina.
const SMOKE_COLOR = 0xa3a8b0;
const CHIP_COLORS = [0x4a4f58, 0x8a9099, 0x2b2f36];
const RATTLE_WEAKNESS = 0.9;           // Rattle at zero Stability.
const RATTLE_BROKEN = 0.8;             // Extra rattle while broken.
const RATTLE_SHUDDER = 1.2;            // Extra rattle right after a hit.
const SEAM_WEAKNESS = 0.6;
const SEAM_BROKEN = 0.5;
// ---------------------------------------------------------------------------------

const TRAIL_VERT = /* glsl */ `
  attribute float aAlpha;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const TRAIL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() { gl_FragColor = vec4(uColor, vAlpha); }
`;

const pick = <T>(list: readonly T[], r: number): T => list[Math.min(list.length - 1, Math.floor(r * list.length))]!;
const smooth = THREE.MathUtils.smoothstep;

/** Ribbon of recent tip positions laid on the floor. */
class FloorTrail {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly px = new Float32Array(TRAIL_MAX_POINTS);
  private readonly py = new Float32Array(TRAIL_MAX_POINTS);
  private readonly pz = new Float32Array(TRAIL_MAX_POINTS);
  private readonly pt = new Float32Array(TRAIL_MAX_POINTS);
  private readonly pw = new Float32Array(TRAIL_MAX_POINTS);
  private readonly pa = new Float32Array(TRAIL_MAX_POINTS);
  private head = 0;
  private count = 0;
  private sinceSample = 0;
  private readonly positions = new Float32Array(TRAIL_MAX_POINTS * 2 * 3);
  private readonly alphas = new Float32Array(TRAIL_MAX_POINTS * 2);

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    const index: number[] = [];
    for (let i = 0; i < TRAIL_MAX_POINTS - 1; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(index);
    const m = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      uniforms: { uColor: { value: new THREE.Color(TRAIL_COLOR) } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  clear(): void {
    this.count = 0;
    this.mesh.geometry.setDrawRange(0, 0);
  }

  push(x: number, y: number, z: number, time: number, width: number, alpha: number, dt: number): void {
    this.sinceSample += dt;
    if (this.sinceSample < TRAIL_SAMPLE_S && this.count > 0) return;
    this.sinceSample = 0;
    this.px[this.head] = x;
    this.py[this.head] = y;
    this.pz[this.head] = z;
    this.pt[this.head] = time;
    this.pw[this.head] = width;
    this.pa[this.head] = alpha;
    this.head = (this.head + 1) % TRAIL_MAX_POINTS;
    this.count = Math.min(TRAIL_MAX_POINTS, this.count + 1);
  }

  rebuild(time: number, life: number): void {
    const n = this.count;
    const at = (k: number): number => (this.head - 1 - k + TRAIL_MAX_POINTS * 2) % TRAIL_MAX_POINTS;
    let written = 0;
    for (let k = 0; k < n; k++) {
      const i = at(k);
      const age = time - this.pt[i]!;
      if (age > life || age < 0) break;
      // Direction from the older neighbour to the newer one; the ribbon is offset perpendicular to it.
      const newer = at(Math.max(0, k - 1));
      const older = at(Math.min(n - 1, k + 1));
      let dx = this.px[newer]! - this.px[older]!;
      let dz = this.pz[newer]! - this.pz[older]!;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const hw = this.pw[i]! * 0.5;
      const o = written * 6;
      this.positions[o] = this.px[i]! - dz * hw;
      this.positions[o + 1] = this.py[i]!;
      this.positions[o + 2] = this.pz[i]! + dx * hw;
      this.positions[o + 3] = this.px[i]! + dz * hw;
      this.positions[o + 4] = this.py[i]!;
      this.positions[o + 5] = this.pz[i]! - dx * hw;
      const a = this.pa[i]! * (1 - age / life);
      this.alphas[written * 2] = a;
      this.alphas[written * 2 + 1] = a;
      written++;
    }
    const g = this.mesh.geometry;
    g.attributes.position!.needsUpdate = true;
    g.attributes.aAlpha!.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, written - 1) * 6);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export class MechanicalLayer implements ConditionLayer {
  readonly id = 'A' as const;
  enabled = true;
  private readonly trail = new FloorTrail();
  private grindDebt = 0;
  private smokeDebt = 0;
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Vector3();

  constructor(private readonly ctx: LayerContext) {
    ctx.world.scene.add(this.trail.mesh);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    this.trail.mesh.visible = on;
    if (!on) this.trail.clear();
  }

  update(frame: LayerFrame, dt: number): void {
    if (!this.enabled) return;
    const { rig, tuning: T, world } = this.ctx;
    const s = frame.state;
    const m = frame.motion;
    const weak = 1 - s.stability;

    // --- Piece looseness, open seams, worn material ---
    rig.mods.rattle += T.aRattle * (RATTLE_WEAKNESS * weak ** 1.3 + RATTLE_BROKEN * m.brokenBlend + RATTLE_SHUDDER * m.shudder);
    rig.mods.seamGap += T.aSeamGap * (SEAM_WEAKNESS * weak ** 1.5 + SEAM_BROKEN * m.brokenBlend);
    rig.mods.wear += T.aWear * (0.55 * (1 - s.stamina) + 0.45 * weak);

    // --- Tip scribe line (the rosette) ---
    const tipX = m.position.x;
    const tipZ = m.position.z;
    const floorY = world.floorHeightAt(tipX, tipZ) + 0.012;
    const touching = m.rimClearance > 0.02 && s.spinOut < 0.95; // tip on the floor (not lying on the rim)
    const alpha = Math.min(0.85, T.aTrail * (0.22 + 0.5 * m.wobbleFactor + 0.3 * m.brokenBlend + 0.2 * weak));
    if (touching) this.trail.push(tipX, floorY, tipZ, frame.time, TRAIL_WIDTH_M + TRAIL_WIDTH_WOBBLE_M * m.wobbleFactor, alpha, dt);
    this.trail.rebuild(frame.time, T.aTrailSeconds);

    if (m.rps < 0.25 && s.down) return;

    // --- Rim grinding sparks ---
    const contact = smooth(-m.rimClearance, -0.08, 0.01);
    const grindRate = T.aGrind * (GRIND_RATE_CONTACT * contact + GRIND_RATE_BROKEN * m.brokenBlend + GRIND_RATE_LOW_STAMINA * smooth(-s.stamina, -0.25, 0));
    this.grindDebt += grindRate * dt * (s.down ? 0 : 1);
    if (this.grindDebt >= 1) {
      rig.rimLowestWorld(m.leanDir, this.p);
      this.p.y = Math.max(this.p.y, world.floorHeightAt(this.p.x, this.p.z) + 0.02);
      // Spin is counter-clockwise from above, so the rim point moves along +90° of the lean direction.
      const tx = -Math.sin(m.leanDir);
      const tz = Math.cos(m.leanDir);
      while (this.grindDebt >= 1) {
        this.grindDebt -= 1;
        const r = Math.random();
        const speed = 2 + 3.5 * Math.random() * Math.min(1.5, m.rps / 6 + 0.3);
        world.glow.spawn({
          x: this.p.x, y: this.p.y, z: this.p.z,
          vx: tx * speed + (Math.random() - 0.5) * 1.2,
          vy: 0.6 + Math.random() * 2.2,
          vz: tz * speed + (Math.random() - 0.5) * 1.2,
          life: 0.22 + Math.random() * 0.3,
          size: 0.05 + Math.random() * 0.03,
          sizeEnd: 0.015,
          color: pick(GRIND_COLORS, r),
          gravity: 9,
          drag: 0.4,
          floor: (x, z) => world.floorHeightAt(x, z),
        });
      }
    }

    // --- Smoke from the Driver ---
    this.smokeDebt += T.aSmoke * (SMOKE_RATE_BROKEN * m.brokenBlend + SMOKE_RATE_LOW_STAMINA * smooth(-s.stamina, -0.15, 0)) * dt;
    while (this.smokeDebt >= 1) {
      this.smokeDebt -= 1;
      rig.bodyToWorld(this.q.set((Math.random() - 0.5) * 0.3, rig.dims.ringBottomY * 0.6, (Math.random() - 0.5) * 0.3), this.p);
      world.soft.spawn({
        x: this.p.x, y: this.p.y, z: this.p.z,
        vx: (Math.random() - 0.5) * 0.3, vy: 0.45 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.3,
        life: 1.3 + Math.random() * 0.6,
        size: 0.2, sizeEnd: 0.9 + Math.random() * 0.4,
        color: SMOKE_COLOR, alpha: 0.28, drag: 0.6,
      });
    }
  }

  onEvent(e: ConditionEvent, frame: LayerFrame): void {
    if (!this.enabled) return;
    const { rig, tuning: T, world } = this.ctx;
    const pos = frame.motion.position;
    if (e.kind === 'reset') {
      this.trail.clear();
      return;
    }
    if (e.kind === 'hit') {
      const cx = pos.x + Math.cos(e.dirAngle) * rig.dims.ringRadius;
      const cz = pos.z + Math.sin(e.dirAngle) * rig.dims.ringRadius;
      const cy = pos.y + rig.dims.ringMidY;
      const chips = Math.round(T.aDebris * (3 + 12 * (1 - e.stabilityBefore)) * e.magnitude);
      this.chips(cx, cy, cz, chips, -Math.cos(e.dirAngle), -Math.sin(e.dirAngle));
      return;
    }
    if (e.kind === 'break') {
      this.chips(pos.x, pos.y + rig.dims.ringMidY, pos.z, Math.round(18 * T.aDebris), 0, 0);
      this.dustRing(pos.x, pos.z, 14, 1.4);
      return;
    }
    if (e.kind === 'recover') {
      // The pieces re-seat with a click: a small dust ring.
      this.dustRing(pos.x, pos.z, 10, 0.8);
      return;
    }
    if (e.kind === 'down') {
      this.dustRing(pos.x, pos.z, 16, 1.6);
      this.chips(pos.x, pos.y + 0.1, pos.z, Math.round(6 * T.aDebris), 0, 0);
    }
  }

  private chips(x: number, y: number, z: number, count: number, dx: number, dz: number): void {
    const { world } = this.ctx;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3;
      world.soft.spawn({
        x, y, z,
        vx: Math.cos(a) * sp * 0.6 + dx * sp, vy: 1.5 + Math.random() * 3, vz: Math.sin(a) * sp * 0.6 + dz * sp,
        life: 0.7 + Math.random() * 0.5,
        size: 0.045 + Math.random() * 0.04,
        color: pick(CHIP_COLORS, Math.random()),
        gravity: 12, drag: 0.7,
        floor: (px, pz) => world.floorHeightAt(px, pz),
      });
    }
  }

  private dustRing(x: number, z: number, count: number, speed: number): void {
    const { world } = this.ctx;
    const y = world.floorHeightAt(x, z) + 0.06;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      world.soft.spawn({
        x: x + Math.cos(a) * 0.4, y, z: z + Math.sin(a) * 0.4,
        vx: Math.cos(a) * speed, vy: 0.15, vz: Math.sin(a) * speed,
        life: 0.7 + Math.random() * 0.3,
        size: 0.18, sizeEnd: 0.6,
        color: 0x8c8a85, alpha: 0.35, drag: 0.15,
      });
    }
  }

  dispose(): void {
    this.trail.mesh.removeFromParent();
    this.trail.dispose();
  }
}
