// ============================================================
// STAMINA & STABILITY LAB — WORLD
// One scene: the floor (the approved 3.2 m bowl, or a flat stage for the
// ladder views), lights, the Bey(s) under test with all three language
// layers attached, an optional sparring opponent, and pooled particles.
//
// The bowl uses the approved depth (3.2 m rim over the centre, radius
// 12 m — decisions doc §2.1) with a neutral dark floor on purpose: the
// arena's look (Foundry Pit / Rift Crater / Tournament Stadium) is still
// an open choice and this lab must not pre-empt it.
// ============================================================

import * as THREE from 'three';
import type { ConceptDefinition } from '../../../bey-visual-concepts/src/model/types';
import { Particles } from '../fx/Particles';
import { InstrumentLayer } from '../languages/instrument';
import { MechanicalLayer } from '../languages/mechanical';
import { SpiritLayer } from '../languages/spirit';
import type { ConditionLayer, LanguageId, LayerFrame, LayerWorld } from '../languages/types';
import { BeyMotion, type MotionAnchor } from '../sim/BeyMotion';
import { ConditionSim, HIT_LEAD_SECONDS, type ConditionEvent } from '../sim/ConditionSim';
import type { Tuning } from '../tuning';
import { BeyRig } from './BeyRig';

// ---------------- WORLD TUNING ----------------
export const ARENA_RADIUS_M = 12;             // src/arena/colliders/ArenaTuning.ts
export const BOWL_DEPTH_M = 3.2;              // Approved (decisions doc §2.1).
const WALL_HEIGHT_M = 2;                      // Above the rim.
const FLOOR_COLOR = 0x1b1f26;
const WALL_COLOR = 0x262b33;
const BACKGROUND = 0x06080c;
const OPPONENT_IDLE_DIST_M = 3.2;             // Sparring partner's usual distance from the Bey under test.
const OPPONENT_ORBIT_RAD_S = 0.5;
const OPPONENT_BOUNCE_S = 0.55;               // Time to bounce back out after contact.
const CONTACT_SPARKS = 14;                    // Neutral contact sparks on every hit (placeholder for the approved hybrid hit VFX).
// -------------------------------------------------

export type FloorKind = 'bowl' | 'flat';

export interface BeyEntry {
  readonly sim: ConditionSim;
  readonly motion: BeyMotion;
  readonly rig: BeyRig;
  readonly layers: Readonly<Record<LanguageId, ConditionLayer>>;
  /** Label shown under the Bey in the ladder views. */
  label: string;
  lastFrame: LayerFrame | null;
}

interface Opponent {
  readonly rig: BeyRig;
  readonly motion: BeyMotion;
  readonly sim: ConditionSim;
  angle: number;
  dist: number;
}

export function bowlHeight(r: number): number {
  const k = Math.min(r, ARENA_RADIUS_M) / ARENA_RADIUS_M;
  return BOWL_DEPTH_M * k * k;
}

export class World implements LayerWorld {
  readonly scene = new THREE.Scene();
  readonly glow = new Particles(1400, true);
  readonly soft = new Particles(900, false);
  readonly entries: BeyEntry[] = [];
  private opponent: Opponent | null = null;
  private enabled: Record<LanguageId, boolean> = { A: true, B: true, C: true };
  private time = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    readonly kind: FloorKind,
    readonly camera: THREE.PerspectiveCamera,
    private readonly tuning: Tuning,
    environment: THREE.Texture | null,
  ) {
    this.scene.background = new THREE.Color(BACKGROUND);
    this.scene.fog = new THREE.Fog(BACKGROUND, 22, 48);
    if (environment) {
      this.scene.environment = environment;
      this.scene.environmentIntensity = 0.35;
    }
    this.buildLights();
    this.buildFloor();
    this.scene.add(this.glow.points, this.soft.points);
  }

  floorHeightAt(x: number, z: number): number {
    return this.kind === 'bowl' ? bowlHeight(Math.hypot(x, z)) : 0;
  }

  floorNormalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    if (this.kind !== 'bowl') return out.set(0, 1, 0);
    const r = Math.hypot(x, z);
    if (r < 1e-4 || r > ARENA_RADIUS_M) return out.set(0, 1, 0);
    const slope = (2 * BOWL_DEPTH_M * r) / (ARENA_RADIUS_M * ARENA_RADIUS_M);
    return out.set((-slope * x) / r, 1, (-slope * z) / r).normalize();
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0x9fb4d6, 0x0b0c10, 0.6));
    const key = new THREE.DirectionalLight(0xfff1dc, 2.4);
    key.position.set(6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -14;
    key.shadow.camera.right = 14;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -14;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 40;
    key.shadow.bias = -0.0005;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8fb8ff, 1.1);
    rim.position.set(-8, 6, -10);
    this.scene.add(rim);
  }

  private buildFloor(): void {
    const floorMat = new THREE.MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.85, metalness: 0.15 });
    if (this.kind === 'bowl') {
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 64; i++) {
        const r = (i / 64) * ARENA_RADIUS_M;
        pts.push(new THREE.Vector2(r, bowlHeight(r)));
      }
      const floor = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), floorMat);
      floor.material.side = THREE.DoubleSide;
      floor.receiveShadow = true;
      this.scene.add(floor);
      // Scale rings every 3 m, so distance and slope read at a glance.
      for (const r of [3, 6, 9]) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(r, 0.012, 4, 128),
          new THREE.MeshBasicMaterial({ color: 0x3a4250, transparent: true, opacity: 0.55 }),
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = bowlHeight(r) + 0.01;
        this.scene.add(ring);
      }
      const wall = new THREE.Mesh(
        new THREE.CylinderGeometry(ARENA_RADIUS_M + 0.3, ARENA_RADIUS_M + 0.3, WALL_HEIGHT_M, 96, 1, true),
        new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }),
      );
      wall.position.y = BOWL_DEPTH_M + WALL_HEIGHT_M / 2 - 0.2;
      wall.receiveShadow = true;
      this.scene.add(wall);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(ARENA_RADIUS_M + 0.3, 0.08, 8, 128), new THREE.MeshStandardMaterial({ color: 0x59606c, roughness: 0.4, metalness: 0.8 }));
      lip.rotation.x = Math.PI / 2;
      lip.position.y = BOWL_DEPTH_M + WALL_HEIGHT_M - 0.2;
      this.scene.add(lip);
    } else {
      const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 96).rotateX(-Math.PI / 2), floorMat);
      floor.receiveShadow = true;
      this.scene.add(floor);
      const grid = new THREE.GridHelper(32, 32, 0x2c333d, 0x1f252d);
      grid.position.y = 0.002;
      this.scene.add(grid);
    }
  }

  addBey(definition: ConceptDefinition, sim: ConditionSim, anchor: MotionAnchor, phaseOffset = 0, label = ''): BeyEntry {
    const rig = new BeyRig(definition, this.tuning);
    const motion = new BeyMotion(this.tuning, rig.dims, anchor, (x, z) => this.floorHeightAt(x, z), phaseOffset);
    const ctx = { world: this, rig, tuning: this.tuning };
    const layers: Record<LanguageId, ConditionLayer> = {
      A: new MechanicalLayer(ctx),
      B: new SpiritLayer(ctx),
      C: new InstrumentLayer(ctx),
    };
    for (const id of ['A', 'B', 'C'] as const) layers[id].setEnabled(this.enabled[id]);
    this.scene.add(rig.root);
    const entry: BeyEntry = { sim, motion, rig, layers, label, lastFrame: null };
    this.entries.push(entry);
    return entry;
  }

  /** A sparring partner that dashes in to land each scheduled hit (arena views). */
  setOpponent(definition: ConceptDefinition | null): void {
    if (this.opponent) {
      this.opponent.rig.root.removeFromParent();
      this.opponent.rig.dispose();
      this.opponent = null;
    }
    if (!definition) return;
    const rig = new BeyRig(definition, this.tuning);
    const sim = new ConditionSim('hold', 99);
    sim.setHold(1, 1, false);
    const motion = new BeyMotion(this.tuning, rig.dims, { kind: 'fixed', x: 0, z: 0 }, (x, z) => this.floorHeightAt(x, z), 2.1);
    this.scene.add(rig.root);
    this.opponent = { rig, motion, sim, angle: Math.PI * 0.75, dist: OPPONENT_IDLE_DIST_M };
  }

  get opponentPosition(): THREE.Vector3 | null {
    return this.opponent ? this.opponent.rig.root.position : null;
  }

  setLayers(enabled: Record<LanguageId, boolean>): void {
    this.enabled = { ...enabled };
    for (const e of this.entries) for (const id of ['A', 'B', 'C'] as const) e.layers[id].setEnabled(enabled[id]);
  }

  /** Advance everything. `events` holds what each sim emitted this frame (sims are stepped by the lab, once each). */
  update(dt: number, events: ReadonlyMap<ConditionSim, readonly ConditionEvent[]>): void {
    this.time += dt;
    for (const entry of this.entries) {
      const state = entry.sim.state;
      const evs = events.get(entry.sim) ?? [];
      for (const e of evs) entry.motion.onEvent(e);
      const motion = entry.motion.update(state, dt);
      entry.rig.update(motion, dt);
      entry.rig.resetMods();
      const frame: LayerFrame = { state, motion, time: this.time };
      entry.lastFrame = frame;
      for (const e of evs) {
        if (e.kind === 'hit') this.contactSparks(entry, e.dirAngle, e.magnitude);
        for (const id of ['A', 'B', 'C'] as const) entry.layers[id].onEvent(e, frame);
      }
      for (const id of ['A', 'B', 'C'] as const) entry.layers[id].update(frame, dt);
      entry.rig.applyMods(this.enabled.A ? this.tuning.aShudder : 0);
    }
    this.updateOpponent(dt);
    this.glow.update(dt);
    this.soft.update(dt);
  }

  private updateOpponent(dt: number): void {
    const opp = this.opponent;
    const target = this.entries[0];
    if (!opp || !target) return;
    const s = target.sim.state;
    const pending = s.pendingHit;
    let dist = OPPONENT_IDLE_DIST_M;
    const contact = target.rig.dims.ringRadius + opp.rig.dims.ringRadius - 0.05;
    if (pending && !s.down) {
      const lead = Math.max(0, pending.at - s.time);
      const k = 1 - Math.min(1, lead / HIT_LEAD_SECONDS);
      // Swing to the attack angle, then dash in.
      opp.angle += shortestAngle(opp.angle, pending.dirAngle) * Math.min(1, dt * (4 + 20 * k));
      dist = OPPONENT_IDLE_DIST_M + (contact - OPPONENT_IDLE_DIST_M) * k * k;
    } else if (s.lastHit && s.sinceHit < OPPONENT_BOUNCE_S) {
      const k = s.sinceHit / OPPONENT_BOUNCE_S;
      dist = contact + (OPPONENT_IDLE_DIST_M - contact) * (1 - (1 - k) * (1 - k));
    } else {
      opp.angle += OPPONENT_ORBIT_RAD_S * dt;
    }
    opp.dist += (dist - opp.dist) * Math.min(1, dt * 18);
    const tp = target.rig.root.position;
    const x = tp.x + Math.cos(opp.angle) * opp.dist;
    const z = tp.z + Math.sin(opp.angle) * opp.dist;
    opp.sim.step(dt);
    const frame = opp.motion.update(opp.sim.state, dt);
    opp.rig.update(frame, dt);
    opp.rig.resetMods();
    opp.rig.applyMods(0);
    opp.rig.root.position.set(x, this.floorHeightAt(x, z), z);
  }

  private contactSparks(entry: BeyEntry, dirAngle: number, magnitude: number): void {
    const p = entry.rig.root.position;
    const R = entry.rig.dims.ringRadius;
    this.tmp.set(p.x + Math.cos(dirAngle) * R, p.y + entry.rig.dims.ringMidY, p.z + Math.sin(dirAngle) * R);
    const n = Math.round(CONTACT_SPARKS * (0.5 + magnitude));
    for (let i = 0; i < n; i++) {
      const a = dirAngle + Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const sp = 2 + Math.random() * 4 * magnitude;
      this.glow.spawn({
        x: this.tmp.x, y: this.tmp.y, z: this.tmp.z,
        vx: Math.cos(a) * sp * (Math.random() < 0.5 ? 1 : -1), vy: 0.5 + Math.random() * 2.5, vz: Math.sin(a) * sp,
        life: 0.2 + Math.random() * 0.25, size: 0.06, sizeEnd: 0.01, color: 0xfff2b0, gravity: 7, drag: 0.3,
      });
    }
  }

  setPointScale(pxPerMeter: number): void {
    this.glow.setScale(pxPerMeter);
    this.soft.setScale(pxPerMeter);
  }

  dispose(): void {
    for (const e of this.entries) {
      for (const id of ['A', 'B', 'C'] as const) e.layers[id].dispose();
      e.rig.root.removeFromParent();
      e.rig.dispose();
    }
    this.entries.length = 0;
    this.setOpponent(null);
    this.glow.dispose();
    this.soft.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m: THREE.Material) => m.dispose());
      }
    });
  }
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
