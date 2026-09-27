// ============================================================
// STAMINA & STABILITY LAB — PHYSICAL CHOREOGRAPHY (shared by A, B and C)
// Turns the condition state into how the Bey physically moves: spin rate,
// lean, precession, nutation, the tip drawing a rosette, the kick of a hit
// and the spin-out collapse. GDD 30 / 84 / 123: low Stamina and low
// Stability must show as physical degradation, not only as a bar, so this
// layer is always on whatever language is selected.
//
// Visual choreography only — not the game's physics (that is Rapier +
// src/bey/*). Deterministic (no Math.random), so three views that share
// one ConditionSim move identically side by side.
//
// Lean convention: the lean is a 2D vector (x, z) in the floor plane. Its
// direction is where the TOP of the Bey leans toward; its length is the
// lean angle in radians. The pivot is the tip contact point.
// ============================================================

import * as THREE from 'three';
import type { ConditionEvent, ConditionState } from './ConditionSim';
import type { Tuning } from '../tuning';

// ---------------- MOTION TUNING (choreography constants) ----------------
const DEG = Math.PI / 180;
const IDLE_WOBBLE_DEG = 0.6;                // A healthy top is never perfectly still.
const PRECESSION_LOW_STAMINA_BOOST = 1.6;   // Precession speeds up as spin slows (real tops do).
const NUTATION_HZ = 5.3;                    // Fast axis tremor frequency.
const HIT_SPRING_DAMPING = 0.45;            // < 1 so the Bey rocks back past upright once after a hit.
const HIT_PEAK_GAIN = 1.74;                 // Impulse gain so the first swing peaks at the requested angle (for damping 0.45).
const KNOCK_SPRING_RATE = 2.2;              // rad/s: how fast the knock offset returns to the path.
const KNOCK_SPEED_MPS = 3.2;                // Initial knock speed for a full-magnitude hit on zero Stability.
const FIXED_ANCHOR_KNOCK_SCALE = 0.35;      // Ladder/close views keep the Bey near its spot.
const MAX_LEAN_RAD = 80 * DEG;
const SPIN_OUT_LEAN_DEG = 76;               // Lean when lying on the ring rim after a spin-out.
const SPIN_OUT_PRECESSION_HZ = 3.6;         // The death wobble speeds up while it falls.
const DOWN_ROLL_STOP_S = 1.3;               // Seconds for the rim roll to stop once down.
const BROKEN_BLEND_RATE = 3;                // Per second: ease in/out of the Broken lean.
const STUTTER_PERIOD_S = 0.8;               // Broken: one spin hiccup every this many seconds.
const PATH_RADIUS_M = 5;                    // Arena view: the Bey circles the bowl at about this radius.
const PATH_SPEED_FULL = 0.42;               // rad/s around the bowl at full Stamina…
const PATH_SPEED_EMPTY = 0.16;              // …and when nearly empty.
// -------------------------------------------------------------------------

export interface MotionDims {
  /** Ring outer radius (m). */
  readonly ringRadius: number;
  /** Height of the ring's bottom edge above the tip (m). */
  readonly ringBottomY: number;
}

export type MotionAnchor = { readonly kind: 'path' } | { readonly kind: 'fixed'; readonly x: number; readonly z: number };

export interface MotionFrame {
  /** Tip contact point (or, when lying on the rim, the pivot lifted so the rim touches). */
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** Total lean angle (radians). */
  readonly lean: number;
  /** Direction the top leans toward (radians in the XZ plane). */
  readonly leanDir: number;
  /** Ring bottom edge clearance above the floor before any lift (m); <= 0 means the rim touches. */
  readonly rimClearance: number;
  /** Visual spin rate the language layers read (revolutions per second). */
  readonly rps: number;
  /** Rotation drawn on the actual pieces (clamped to meshMaxRps). */
  readonly meshSpin: number;
  /** Rotation at the true rate — the blur disc and spin lines use it. */
  readonly trueSpin: number;
  /** 0 above wobbleStart, 1 at zero Stamina. */
  readonly wobbleFactor: number;
  /** Eased 0..1 version of `broken`. */
  readonly brokenBlend: number;
  /** Decaying 0..1 shudder after a hit (scaled by how weak Stability was). */
  readonly shudder: number;
  /** Decaying 0..1 flash right after a hit. */
  readonly hitFlash: number;
  /** Precession phase (radians). */
  readonly phase: number;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export class BeyMotion {
  private phase = 0;
  private time = 0;
  private meshSpin = 0;
  private trueSpin = 0;
  private pathAngle: number;
  private readonly kick = new THREE.Vector2();
  private readonly kickVel = new THREE.Vector2();
  private readonly knock = new THREE.Vector2();
  private readonly knockVel = new THREE.Vector2();
  private brokenBlend = 0;
  private shudder = 0;
  private hitFlash = 0;
  private downTime = 0;
  private spinOutStartLean = 0;
  private wasSpinningOut = false;
  private readonly lean = new THREE.Vector2();
  private readonly axis = new THREE.Vector3();

  readonly frame: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    lean: number;
    leanDir: number;
    rimClearance: number;
    rps: number;
    meshSpin: number;
    trueSpin: number;
    wobbleFactor: number;
    brokenBlend: number;
    shudder: number;
    hitFlash: number;
    phase: number;
  } = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    lean: 0,
    leanDir: 0,
    rimClearance: 1,
    rps: 0,
    meshSpin: 0,
    trueSpin: 0,
    wobbleFactor: 0,
    brokenBlend: 0,
    shudder: 0,
    hitFlash: 0,
    phase: 0,
  };

  constructor(
    /** Live tuning object (read every frame, so slider changes apply at once). */
    private readonly tuning: Tuning,
    private readonly dims: MotionDims,
    private readonly anchor: MotionAnchor,
    private readonly floorHeightAt: (x: number, z: number) => number,
    /** Phase offset so ladder Beys don't wobble in lockstep. */
    phaseOffset = 0,
  ) {
    this.phase = phaseOffset;
    this.pathAngle = -Math.PI / 2;
  }

  reset(): void {
    this.kick.set(0, 0);
    this.kickVel.set(0, 0);
    this.knock.set(0, 0);
    this.knockVel.set(0, 0);
    this.brokenBlend = 0;
    this.shudder = 0;
    this.hitFlash = 0;
    this.downTime = 0;
    this.wasSpinningOut = false;
    this.pathAngle = -Math.PI / 2;
  }

  onEvent(e: ConditionEvent): void {
    if (e.kind === 'reset') {
      this.reset();
      return;
    }
    if (e.kind !== 'hit') return;
    // "Away from the attacker": the hit pushes the Bey opposite to dirAngle.
    const ax = -Math.cos(e.dirAngle);
    const az = -Math.sin(e.dirAngle);
    const weakness = 1 - e.stabilityBefore;
    const T = this.tuning;
    const peakRad = T.hitTiltDeg * DEG * (T.hitTiltFull + (1 - T.hitTiltFull) * weakness) * e.magnitude;
    const omega = T.recoverySpeed * 2;
    this.kickVel.x += ax * peakRad * omega * HIT_PEAK_GAIN;
    this.kickVel.y += az * peakRad * omega * HIT_PEAK_GAIN;
    const knockScale = this.anchor.kind === 'fixed' ? FIXED_ANCHOR_KNOCK_SCALE : 1;
    const speed = KNOCK_SPEED_MPS * T.knockback * (0.6 + 1.2 * weakness) * e.magnitude * knockScale;
    this.knockVel.x += ax * speed;
    this.knockVel.y += az * speed;
    this.shudder = Math.max(this.shudder, e.magnitude * (0.3 + 0.7 * weakness));
    this.hitFlash = 1;
  }

  update(state: ConditionState, dt: number): MotionFrame {
    const T = this.tuning;
    this.time += dt;
    const spinOut = state.spinOut;
    const spinningOut = spinOut > 0;

    // ---- Spin rate ----
    const staminaCurve = 1 - Math.pow(1 - state.stamina, T.spinCurve);
    let rps = T.spinMinRps + (T.spinMaxRps - T.spinMinRps) * staminaCurve;
    this.brokenBlend += ((state.broken ? 1 : 0) - this.brokenBlend) * Math.min(1, dt * BROKEN_BLEND_RATE);
    const stutterPhase = (this.time / STUTTER_PERIOD_S) % 1;
    const dip = Math.exp(-(((stutterPhase - 0.1) / 0.05) ** 2));
    rps *= 1 - T.brokenStutter * 0.55 * dip * this.brokenBlend;
    if (spinningOut) rps *= Math.pow(1 - spinOut, 1.4);
    this.meshSpin += Math.min(rps, T.meshMaxRps) * Math.PI * 2 * dt;
    this.trueSpin += rps * Math.PI * 2 * dt;

    // ---- Precession phase ----
    const wobbleFactor = smoothstep(T.wobbleStart, 0, state.stamina);
    let precHz = T.precessionHz * (1 + PRECESSION_LOW_STAMINA_BOOST * (1 - state.stamina));
    if (spinningOut && !state.down) precHz += SPIN_OUT_PRECESSION_HZ * spinOut;
    if (state.down) {
      this.downTime += dt;
      precHz = SPIN_OUT_PRECESSION_HZ * Math.max(0, 1 - this.downTime / DOWN_ROLL_STOP_S);
    } else {
      this.downTime = 0;
    }
    this.phase += precHz * Math.PI * 2 * dt;

    // ---- Lean: wobble + nutation + broken lean + hit kick ----
    const wobbleDeg = IDLE_WOBBLE_DEG + T.wobbleMaxDeg * wobbleFactor + T.stabilityWobble * 5 * (1 - state.stability) ** 2;
    this.lean.set(Math.cos(this.phase), Math.sin(this.phase)).multiplyScalar(wobbleDeg * DEG);

    const nutDeg = T.nutation * (0.35 + 2.2 * (1 - state.stamina) + 1.5 * (1 - state.stability)) * (0.5 + 0.5 * Math.sin(this.time * 2 * Math.PI * 1.7));
    const psi = this.phase + this.time * 2 * Math.PI * NUTATION_HZ;
    this.lean.x += Math.cos(psi) * nutDeg * DEG;
    this.lean.y += Math.sin(psi) * nutDeg * DEG;

    const brokenDir = this.phase * 0.6;
    this.lean.x += Math.cos(brokenDir) * T.brokenLeanDeg * DEG * this.brokenBlend;
    this.lean.y += Math.sin(brokenDir) * T.brokenLeanDeg * DEG * this.brokenBlend;

    // Hit kick: under-damped 2D spring back to upright.
    const omega = T.recoverySpeed * 2;
    const ax = -omega * omega * this.kick.x - 2 * HIT_SPRING_DAMPING * omega * this.kickVel.x;
    const az = -omega * omega * this.kick.y - 2 * HIT_SPRING_DAMPING * omega * this.kickVel.y;
    this.kickVel.x += ax * dt;
    this.kickVel.y += az * dt;
    this.kick.x += this.kickVel.x * dt;
    this.kick.y += this.kickVel.y * dt;
    this.lean.add(this.kick);

    // Spin-out: fall onto the ring rim with an accelerating death wobble.
    if (spinningOut) {
      if (!this.wasSpinningOut) this.spinOutStartLean = this.lean.length();
      const fall = spinOut * spinOut;
      const mag = this.spinOutStartLean + (SPIN_OUT_LEAN_DEG * DEG - this.spinOutStartLean) * fall;
      // Once down, the precession decays to zero, so the lean direction settles.
      this.lean.set(Math.cos(this.phase) * mag, Math.sin(this.phase) * mag);
    }
    this.wasSpinningOut = spinningOut;

    let leanMag = this.lean.length();
    if (leanMag > MAX_LEAN_RAD) {
      this.lean.multiplyScalar(MAX_LEAN_RAD / leanMag);
      leanMag = MAX_LEAN_RAD;
    }
    const leanDir = Math.atan2(this.lean.y, this.lean.x);

    // ---- Position ----
    let bx: number;
    let bz: number;
    if (this.anchor.kind === 'path') {
      const speed = (PATH_SPEED_EMPTY + (PATH_SPEED_FULL - PATH_SPEED_EMPTY) * state.stamina) * (1 - spinOut);
      this.pathAngle += speed * dt;
      const r = PATH_RADIUS_M + 0.7 * Math.sin(this.time * 0.31 + 1);
      bx = Math.cos(this.pathAngle) * r;
      bz = Math.sin(this.pathAngle) * r;
    } else {
      bx = this.anchor.x;
      bz = this.anchor.z;
    }
    // Knock offset: critically-ish damped spring back to the path.
    const kr = KNOCK_SPRING_RATE;
    this.knockVel.x += (-kr * kr * this.knock.x - 2 * 0.8 * kr * this.knockVel.x) * dt;
    this.knockVel.y += (-kr * kr * this.knock.y - 2 * 0.8 * kr * this.knockVel.y) * dt;
    this.knock.x += this.knockVel.x * dt;
    this.knock.y += this.knockVel.y * dt;
    // Tip wander: the tip circles opposite the lean, drawing a rosette.
    const wander = spinningOut ? 0 : T.tipWander * (0.015 + 0.2 * wobbleFactor + 0.08 * (1 - state.stability) + 0.15 * this.brokenBlend);
    const x = bx + this.knock.x + Math.cos(this.phase + Math.PI) * wander;
    const z = bz + this.knock.y + Math.sin(this.phase + Math.PI) * wander;

    // Lift the pivot when the lean would push the ring rim into the floor.
    const rimClearance = this.dims.ringBottomY * Math.cos(leanMag) - this.dims.ringRadius * Math.sin(leanMag);
    const lift = Math.max(0, -rimClearance);

    // ---- Decays ----
    this.shudder = Math.max(0, this.shudder - dt * 2.8);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);

    // ---- Output ----
    const f = this.frame;
    f.position.set(x, this.floorHeightAt(x, z) + lift, z);
    if (leanMag > 1e-6) {
      this.axis.set(this.lean.y, 0, -this.lean.x).normalize();
      f.quaternion.setFromAxisAngle(this.axis, leanMag);
    } else {
      f.quaternion.identity();
    }
    f.lean = leanMag;
    f.leanDir = leanDir;
    f.rimClearance = rimClearance;
    f.rps = rps;
    f.meshSpin = this.meshSpin;
    f.trueSpin = this.trueSpin;
    f.wobbleFactor = wobbleFactor;
    f.brokenBlend = this.brokenBlend;
    f.shudder = this.shudder;
    f.hitFlash = this.hitFlash;
    f.phase = this.phase;
    return f;
  }
}
