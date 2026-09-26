// ============================================================
// VFX LAB — WORLD
// One scene = approved arena (3.2 m bowl) + two Beys + one visual
// language + the scenario clock. Split view runs two worlds (A | B) side
// by side with their own hitstop / slow motion, so timing differences
// between the languages stay visible.
// ============================================================

import * as THREE from 'three';
import type { ArenaConcept, BuiltArena } from '../../../arena-visual-concepts/src/arenas/types';
import { assembleConcept, type BuiltConcept } from '../../../bey-visual-concepts/src/model/assembleConcept';
import type { ConceptDefinition } from '../../../bey-visual-concepts/src/model/types';
import { FxLayer, StreakSparks } from '../fx/FxLayer';
import type { FxContext, LanguageRuntime, Slot, VfxLanguage } from '../languages/types';
import { RING_Y, type Pose, type Scenario, type WorldApi } from '../scenarios/scenarios';

// ---------------- TUNING ----------------
export const APPROVED_BOWL_DEPTH = 3.2;   // docs/design-decisions/visual-prototypes-approval.md
const BEY_SCALE = 0.24;                   // prototype units -> meters (~1.4 m Bey)
const SPIN_RAD_PER_SEC = 18;              // visual spin
const SLOPE_LEAN = 0.8;
const LOOP_PAUSE_SEC = 0.6;               // pause at the end of each loop
const HITSTOP_FX_RATE = 0.35;             // effects keep moving slowly during hitstop
// -----------------------------------------

interface BeySlot { built: BuiltConcept; holder: THREE.Group; spin: THREE.Group; color: THREE.Color; pos: THREE.Vector3; vel: THREE.Vector3 }

export interface FocusLinesReq { pos: THREE.Vector3; strength: number; remaining: number; total: number; color: string }

export class World {
  readonly scene = new THREE.Scene();
  readonly arena: BuiltArena;
  readonly layer: FxLayer;
  readonly sparks: StreakSparks;
  lang: LanguageRuntime;

  t = 0;
  private scenario: Scenario;
  private m: number;
  private readonly beys: [BeySlot | null, BeySlot | null] = [null, null];
  private hitstopT = 0;
  private slow = { factor: 1, remaining: 0 };
  private readonly flashLight = new THREE.PointLight(0xffffff, 0, 10, 2);
  private flashT = 0;

  // Screen-level requests read by the stage.
  impactT = 0;
  shake = { amp: 0, remaining: 0, total: 1 };
  readonly focus: FocusLinesReq[] = [];
  tint: { css: string; remaining: number } | null = null;

  constructor(
    readonly language: VfxLanguage,
    arenaConcept: ArenaConcept,
    private readonly camera: THREE.Camera,
    scenario: Scenario,
    m: number,
  ) {
    this.arena = arenaConcept.build(APPROVED_BOWL_DEPTH);
    this.scene.add(this.arena.root);
    this.scene.fog = this.arena.fog;
    this.flashLight.userData.peak = 0;
    this.scene.add(this.flashLight);
    this.layer = new FxLayer(this.scene, camera);
    this.sparks = new StreakSparks(1500, this.arena.floorHeightAt);
    this.scene.add(this.sparks.object);
    this.scenario = scenario;
    this.m = m;
    this.lang = language.create(this.context());
  }

  get api(): WorldApi {
    return {
      lang: this.lang,
      floorHeightAt: this.arena.floorHeightAt,
      R: this.arena.wallRadius,
      beyPos: (s) => this.beyPos(s),
      beyVel: (s) => this.beys[s]?.vel.clone() ?? new THREE.Vector3(),
    };
  }

  setBey(slot: Slot, def: ConceptDefinition): void {
    const old = this.beys[slot];
    if (old) {
      this.scene.remove(old.holder);
      old.built.dispose();
    }
    const built = assembleConcept(def);
    built.root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    const spin = new THREE.Group();
    spin.add(built.root);
    spin.scale.setScalar(BEY_SCALE);
    const holder = new THREE.Group();
    holder.add(spin);
    this.scene.add(holder);
    this.beys[slot] = { built, holder, spin, color: new THREE.Color(def.palette.glow), pos: new THREE.Vector3(), vel: new THREE.Vector3() };
    this.applyPoses(0);
  }

  setScenario(s: Scenario, m: number): void {
    this.scenario = s;
    this.m = m;
    this.replay();
  }

  replay(): void {
    this.t = 0;
    this.hitstopT = 0;
    this.slow = { factor: 1, remaining: 0 };
    this.impactT = 0;
    this.tint = null;
    this.focus.length = 0;
    this.layer.clear();
    this.sparks.clear();
    this.lang = this.language.create(this.context());
    this.applyPoses(0);
  }

  /** Advance by real time `dt` (already scaled by the global slow-motion toggle). */
  update(dt: number, time: number): void {
    const slow = this.slow.remaining > 0 ? this.slow.factor : 1;
    this.slow.remaining = Math.max(0, this.slow.remaining - dt);
    let sdt = dt * slow;
    let fxdt = sdt;
    if (this.hitstopT > 0) {
      this.hitstopT -= dt;
      sdt = 0;
      fxdt = dt * HITSTOP_FX_RATE;
    }
    const prev = this.t;
    this.t += sdt;
    if (this.t > this.scenario.duration + LOOP_PAUSE_SEC) {
      this.t = 0;
      this.lang = this.language.create(this.context());
    }
    this.applyPoses(sdt);
    const api = this.api;
    for (const ev of this.scenario.events) {
      if (prev < ev.t && this.t >= ev.t) ev.fire(api, this.m);
    }
    if (sdt > 0 && this.t <= this.scenario.duration) this.scenario.continuous?.(this.t, sdt, api, this.m);
    this.lang.tick(fxdt);
    this.layer.tick(fxdt);
    this.sparks.tick(fxdt);
    this.arena.update({ time, dt, clash: 0 });

    this.impactT = Math.max(0, this.impactT - dt);
    this.shake.remaining = Math.max(0, this.shake.remaining - dt);
    for (let i = this.focus.length - 1; i >= 0; i--) {
      this.focus[i]!.remaining -= dt;
      if (this.focus[i]!.remaining <= 0) this.focus.splice(i, 1);
    }
    if (this.tint) {
      this.tint.remaining -= dt;
      if (this.tint.remaining <= 0) this.tint = null;
    }
    this.flashT = Math.max(0, this.flashT - dt * 5);
    this.flashLight.intensity = this.flashLight.userData.peak * this.flashT;
  }

  focusPoint(): THREE.Vector3 {
    const f = this.scenario.focus?.(this.t, this.m, this.arena.wallRadius) ?? [0, 0];
    return new THREE.Vector3(f[0], this.arena.floorHeightAt(Math.hypot(f[0], f[1])) + 0.8, f[1]);
  }

  dispose(): void {
    this.layer.clear();
    this.beys.forEach((b) => b?.built.dispose());
    this.arena.dispose();
    this.sparks.object.geometry.dispose();
    (this.sparks.object.material as THREE.Material).dispose();
  }

  // ---------------- internals ----------------

  private beyPos(slot: Slot): THREE.Vector3 {
    const b = this.beys[slot];
    if (!b) return new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(b.holder.quaternion);
    return b.holder.position.clone().addScaledVector(up, RING_Y);
  }

  private applyPoses(dt: number): void {
    const poses = this.scenario.pose(Math.min(this.t, this.scenario.duration), this.m, this.arena.wallRadius);
    this.beys.forEach((b, i) => {
      if (!b) return;
      this.pose(b, poses[i]!, dt);
    });
  }

  private pose(b: BeySlot, p: Pose, dt: number): void {
    const r = Math.hypot(p.x, p.z);
    const floor = this.arena.floorHeightAt(Math.min(r, this.arena.wallRadius));
    const next = new THREE.Vector3(p.x, floor + p.lift, p.z);
    if (dt > 0) b.vel.copy(next).sub(b.holder.position).divideScalar(dt);
    b.holder.position.copy(next);
    b.holder.visible = p.visible;
    const eps = 0.05;
    const slope = (this.arena.floorHeightAt(Math.min(r + eps, 12)) - this.arena.floorHeightAt(Math.max(0, r - eps))) / (2 * eps);
    const grounded = p.lift < 0.05 ? 1 : 0;
    const n = r > 1e-3 ? new THREE.Vector3((-slope * p.x) / r, 1, (-slope * p.z) / r).normalize() : new THREE.Vector3(0, 1, 0);
    const up = new THREE.Vector3(0, 1, 0).lerp(n, SLOPE_LEAN * grounded).normalize();
    const lean = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    const tiltAxis = new THREE.Vector3(Math.sin(p.tiltDir), 0, -Math.cos(p.tiltDir));
    const tilt = new THREE.Quaternion().setFromAxisAngle(tiltAxis, p.tilt);
    b.holder.quaternion.copy(tilt).multiply(lean);
    b.spin.rotation.y += SPIN_RAD_PER_SEC * Math.max(dt, 0);
  }

  private context(): FxContext {
    return {
      scene: this.scene,
      camera: this.camera,
      layer: this.layer,
      sparks: this.sparks,
      floorHeightAt: this.arena.floorHeightAt,
      beyColor: (s) => this.beys[s]?.color.clone() ?? new THREE.Color(0xffffff),
      arenaSparks: this.arena.sparkColors,
      shake: (amp, sec) => {
        if (amp >= this.shake.amp * (this.shake.remaining / this.shake.total || 0)) this.shake = { amp, remaining: sec, total: sec };
      },
      hitstop: (sec) => { this.hitstopT = Math.max(this.hitstopT, sec); },
      slowMotion: (factor, sec) => { this.slow = { factor, remaining: sec }; },
      impactFrame: (sec) => { this.impactT = Math.max(this.impactT, sec); },
      focusLines: (pos, strength, sec, color = 'rgba(255,255,255,0.9)') => { this.focus.push({ pos: pos.clone(), strength, remaining: sec, total: sec, color }); },
      tint: (css, sec) => { this.tint = { css, remaining: sec }; },
      flash: (pos, color, intensity) => {
        this.flashLight.position.copy(pos).setY(pos.y + 0.5);
        this.flashLight.color.set(color);
        this.flashLight.userData.peak = intensity;
        this.flashT = 1;
      },
      ghost: (slot, material) => {
        const b = this.beys[slot];
        const g = b ? b.holder.clone(true) : new THREE.Group();
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.material = material;
            mesh.castShadow = false;
            mesh.userData.sharedGeometry = true;
          }
        });
        return g;
      },
    };
  }
}
