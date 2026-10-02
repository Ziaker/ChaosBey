// ============================================================
// CONDITION DISPLAY — the shared physical expression, display side only
// The lab's "shared physical layer" (always on, whatever languages the player
// picked) is the degradation the GDD requires to show on the body (GDD 30, 84,
// 123). In the lab one choreography module invented all of it. In the game most
// of it already exists for real: the SpinController gives the attitude, wobble
// and tumble, and the physics gives knockback. So this class does NOT move a
// Bey. It only turns Stamina / Stability / Broken and the REAL pose into the
// readouts the approved layers and the blur shell need:
//
//   - a display spin rate (the real spin barely changes with Stamina, so the
//     approved slow-down is drawn here: rps from Stamina, hiccups while Broken,
//     collapse once Stamina is gone) and the clamped angle drawn on the pieces;
//   - the eased Broken blend, the post-hit shudder and flash;
//   - the lean direction and rim clearance, measured from the pose the Bey
//     actually has, so a rim scrape happens only when the real Bey leans enough.
//
// Everything is a pure function of its inputs and the previous frame's values:
// deterministic, no Math.random, nothing written back to a body.
// ============================================================

import * as THREE from 'three';
import type { ConditionState, MotionFrame, RigDimsLike } from './types';
import type { ConditionTuning } from './tuning';

const BROKEN_BLEND_RATE = 3;        // Per second: ease in/out of the Broken look (the lab's value).
const STUTTER_PERIOD_S = 0.8;       // Broken: one spin hiccup every this many seconds.
const SHUDDER_DECAY_PER_S = 2.8;
const HIT_FLASH_DECAY_PER_S = 4;
const NO_HIT_S = 99;

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** What the display needs from the real Bey each frame. */
export interface DisplayInput {
  readonly stamina: number;
  readonly stability: number;
  readonly broken: boolean;
}

export interface DisplayPose {
  /** The visual group's world position (the collider centre). */
  readonly position: THREE.Vector3;
  /** The visual group's world orientation (physics attitude, wobble and lean; not the spin). */
  readonly quaternion: THREE.Quaternion;
}

/** Mutable on purpose: one pair of objects per Bey, rewritten every frame (no allocation per frame). */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutableState = Mutable<ConditionState>;
type MutableFrame = Mutable<MotionFrame>;

export class ConditionDisplay {
  readonly state: MutableState = { time: 0, stamina: 1, stability: 1, broken: false, sinceHit: NO_HIT_S, spinOut: 0, down: false };
  readonly frame: MutableFrame = {
    position: new THREE.Vector3(),
    leanDir: 0,
    rimClearance: 1,
    rps: 0,
    meshSpin: 0,
    trueSpin: 0,
    wobbleFactor: 0,
    brokenBlend: 0,
    shudder: 0,
    hitFlash: 0,
  };

  private meshSpin = 0;
  private trueSpin = 0;
  private brokenBlend = 0;
  private shudder = 0;
  private hitFlash = 0;
  private emptyFor = 0;
  private readonly up = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();

  constructor(
    private readonly tuning: ConditionTuning,
    private readonly dims: RigDimsLike,
    /** Distance from the visual group's origin down to the tip (the collider half-height, m). */
    private readonly tipBelowOriginM: number,
  ) {}

  reset(): void {
    this.meshSpin = 0;
    this.trueSpin = 0;
    this.brokenBlend = 0;
    this.shudder = 0;
    this.hitFlash = 0;
    this.emptyFor = 0;
    this.state.time = 0;
    this.state.sinceHit = NO_HIT_S;
    this.state.spinOut = 0;
    this.state.down = false;
  }

  /** A combat hit landed on this Bey (`stabilityBefore` is the Stability it had just before). */
  onHit(magnitude: number, stabilityBefore: number): void {
    const weakness = 1 - Math.min(1, Math.max(0, stabilityBefore));
    this.shudder = Math.max(this.shudder, magnitude * (0.3 + 0.7 * weakness));
    this.hitFlash = 1;
    this.state.sinceHit = 0;
  }

  update(input: DisplayInput, pose: DisplayPose, dt: number): void {
    const T = this.tuning;
    const s = this.state;
    s.time += dt;
    s.stamina = input.stamina;
    s.stability = input.stability;
    s.broken = input.broken;
    s.sinceHit = Math.min(NO_HIT_S, s.sinceHit + dt);

    // Stamina gone: the spin collapses over spinOutSeconds, then the Bey is down.
    if (input.stamina <= 0) this.emptyFor += dt;
    else this.emptyFor = 0;
    s.spinOut = input.stamina <= 0 ? Math.min(1, this.emptyFor / Math.max(0.1, T.spinOutSeconds)) : 0;
    s.down = s.spinOut >= 1;

    // Display spin rate: the lab's curve, hiccups while Broken, collapse at zero Stamina.
    const staminaCurve = 1 - Math.pow(1 - input.stamina, T.spinCurve);
    let rps = T.spinMinRps + (T.spinMaxRps - T.spinMinRps) * staminaCurve;
    this.brokenBlend += ((input.broken ? 1 : 0) - this.brokenBlend) * Math.min(1, dt * BROKEN_BLEND_RATE);
    const stutterPhase = (s.time / STUTTER_PERIOD_S) % 1;
    const dip = Math.exp(-(((stutterPhase - 0.1) / 0.05) ** 2));
    rps *= 1 - T.brokenStutter * 0.55 * dip * this.brokenBlend;
    if (s.spinOut > 0) rps *= Math.pow(1 - s.spinOut, 1.4);
    this.meshSpin += Math.min(rps, T.meshMaxRps) * Math.PI * 2 * dt;
    this.trueSpin += rps * Math.PI * 2 * dt;

    this.shudder = Math.max(0, this.shudder - dt * SHUDDER_DECAY_PER_S);
    this.hitFlash = Math.max(0, this.hitFlash - dt * HIT_FLASH_DECAY_PER_S);

    // Lean and rim clearance from the pose the Bey really has.
    this.up.set(0, 1, 0).applyQuaternion(pose.quaternion);
    const leanMag = Math.acos(Math.min(1, Math.max(-1, this.up.y)));
    const f = this.frame;
    f.leanDir = Math.atan2(this.up.z, this.up.x);
    f.rimClearance = this.dims.ringBottomY * Math.cos(leanMag) - this.dims.ringRadius * Math.sin(leanMag);
    // The tip is the collider's bottom point, carried by the group's attitude.
    this.offset.set(0, -this.tipBelowOriginM, 0).applyQuaternion(pose.quaternion);
    f.position.copy(pose.position).add(this.offset);
    f.rps = rps;
    f.meshSpin = this.meshSpin;
    f.trueSpin = this.trueSpin;
    f.wobbleFactor = smoothstep(T.wobbleStart, 0, input.stamina);
    f.brokenBlend = this.brokenBlend;
    f.shudder = this.shudder;
    f.hitFlash = this.hitFlash;
  }
}
