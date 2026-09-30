// ============================================================
// SPIN CONTROLLER
// Owns rotational state: the Bey's attitude (tilt), a decoupled
// continuous visual spin value, and a bounded wobble oscillation. See
// SpinTuning.ts for the GDD section 17/83/84 rationale behind this split.
//
// M11 (Motion Lab integration): the attitude is the Motion Lab's model
// (prototypes/bey-motion-concepts/src/physics/model.ts "Tilt dynamics"),
// with the motion direction's values: a 2D tilt vector pulled toward a
// lean target (into the measured acceleration, forward with speed, capped
// at maxTilt; upright in the air) by a damped spring that drops to 15% on
// an impact and fades back in over postImpactRecovery (weaker while
// tumbling), a stiffer stop past maxTilt, impact kicks (with a tumble past
// the direction's threshold) and a precession-like gyroscopic coupling.
//
// The physics body no longer tilts (BeyRigidBody locks its rotations).
// The game's body does not really spin, so nothing gyroscopic held it up:
// measured over 24 AI matches before this change, a Bey's body was tipped
// past 57° in 25.6% of ticks — lying on its flat cylinder's rim, rolling
// like a coin and being dragged around (a stopped Bey kept a 12 rad/s roll
// and drifted off by itself). A top touches the floor at one point under
// its axis; the Lab's attitude has no rim to roll on either. So the tilt
// is this model, and the render shows it; physics only carries the Bey.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import type { Vec2 } from '../../physics/Vec2';
import type { PhysicalCondition } from '../stamina/StaminaSystem';
import {
  AIR_RECOVERY_ATTITUDE_RETURN_PER_S,
  AIR_RECOVERY_WOBBLE_REDUCTION,
  ATTITUDE_TILT_CLAMP_RAD,
  BASE_SPIN_RATE_RAD_S,
  LEAN_ACCEL_SMOOTHING_PER_S,
  SPIN_DECAY_FRACTION_PER_S,
  TILT_OVERSHOOT_STOP_GAIN,
  TUMBLE_BASE_DURATION_S,
  TUMBLE_DURATION_PER_MPS,
  TUMBLE_RECOVERY_FACTOR,
  WOBBLE_ENERGY_MAX,
} from './SpinTuning';
import type { CanonicalRecord } from '../../replay/state/CanonicalValue';
import { labImpactSpeed, motionParams, type MotionParams } from '../motion/MotionPresets';

const DEG = Math.PI / 180;

export interface SpinSnapshot {
  /** The attitude's tilt from upright (rad): |lean|. */
  tiltRad: number;
  /** The physics body's angular velocity (zero: its rotations are locked); kept for the debug views and anomaly checks. */
  angularVelocity: { x: number; y: number; z: number };
  spinRateRadPerSec: number;
  visualSpinAngleRad: number;
  wobbleEnergy: number;
  wobbleOffsetRad: number;
  /** The attitude: which way the top leans (world XZ), magnitude = angle (rad). */
  lean: Vec2;
  /** Motion Lab tumble: a hit above the direction's tumble threshold weakens the upright spring for a moment. */
  isTumbling: boolean;
  /** Upright spring strength right now, as a fraction of full (fades back in after an impact). */
  recoveryFraction: number;
}

function clampLength(v: Vec2, max: number): Vec2 {
  const l = Math.hypot(v.x, v.z);
  return l > max && l > 0 ? { x: (v.x / l) * max, z: (v.z / l) * max } : v;
}

export class SpinController {
  private spinRateRadPerSec = BASE_SPIN_RATE_RAD_S;
  private visualSpinAngleRad = 0;
  private wobbleEnergy = 0;
  private wobbleTimeAccumulatorS = 0;
  /** Seconds since the last registered impact (the upright spring fades back in over the direction's postImpactRecovery). */
  private sinceImpactS = 99;
  private tumbleRemainingS = 0;
  // The attitude (tilt vector), its rate, and the smoothed measured acceleration that drives its lean target.
  private lean: Vec2 = { x: 0, z: 0 };
  private leanRate: Vec2 = { x: 0, z: 0 };
  private accel: Vec2 = { x: 0, z: 0 };
  private prevVel: Vec2 | null = null;

  constructor(private readonly motion: MotionParams = motionParams()) {}

  /**
   * Call once per fixed tick, before physics.step(). Advances the attitude
   * and the visual spin/wobble accumulators.
   *
   * `staminaCondition` degrades this as Stamina drops (GDD section 30/123):
   * a weaker upright spring, faster spin decay, and an ambient wobble floor
   * — a tired Bey visibly loses physical confidence, it doesn't get a
   * config flag flipped.
   */
  tick(body: RAPIER.RigidBody, fixedDeltaSeconds: number, staminaCondition: PhysicalCondition, grounded = true): void {
    const m = this.motion;
    const dt = fixedDeltaSeconds;

    this.spinRateRadPerSec *= Math.max(0, 1 - SPIN_DECAY_FRACTION_PER_S * staminaCondition.spinDecayMultiplier * dt);
    this.visualSpinAngleRad += this.spinRateRadPerSec * dt;

    this.wobbleEnergy = Math.max(this.wobbleEnergy * Math.exp(-m.wobbleDecay * dt), staminaCondition.ambientWobbleFloor);
    this.wobbleTimeAccumulatorS += dt;

    this.tickAttitude(body, dt, grounded, staminaCondition.recoveryTorqueFactor);
  }

  private tickAttitude(body: RAPIER.RigidBody, dt: number, grounded: boolean, staminaFactor: number): void {
    const m = this.motion;
    this.sinceImpactS += dt;
    this.tumbleRemainingS = Math.max(0, this.tumbleRemainingS - dt);
    const tumbling = this.tumbleRemainingS > 0;

    const v = body.linvel();
    const vel = { x: v.x, z: v.z };
    if (this.prevVel) {
      const a = 1 - Math.exp(-LEAN_ACCEL_SMOOTHING_PER_S * dt);
      this.accel.x += ((vel.x - this.prevVel.x) / dt - this.accel.x) * a;
      this.accel.z += ((vel.z - this.prevVel.z) / dt - this.accel.z) * a;
    }
    this.prevVel = vel;

    const maxTilt = m.maxTilt * DEG;
    const target = grounded
      ? clampLength({ x: m.leanStrength * this.accel.x + m.speedTilt * vel.x, z: m.leanStrength * this.accel.z + m.speedTilt * vel.z }, maxTilt)
      : { x: 0, z: 0 };
    const k = m.uprightStrength * this.recoveryFraction() * (tumbling ? TUMBLE_RECOVERY_FACTOR : 1) * staminaFactor;
    let fx = -k * (this.lean.x - target.x) - m.recoveryDamping * this.leanRate.x;
    let fz = -k * (this.lean.z - target.z) - m.recoveryDamping * this.leanRate.z;
    // Beyond the normal clamp (and not tumbling): a stiffer stop.
    const tl = Math.hypot(this.lean.x, this.lean.z);
    if (!tumbling && tl > maxTilt) {
      fx -= TILT_OVERSHOOT_STOP_GAIN * m.uprightStrength * (this.lean.x / tl) * (tl - maxTilt);
      fz -= TILT_OVERSHOOT_STOP_GAIN * m.uprightStrength * (this.lean.z / tl) * (tl - maxTilt);
    }
    // Gyroscopic coupling: a tilt rate is turned sideways, scaled by spin.
    const gyro = m.precession * (this.spinRateRadPerSec / BASE_SPIN_RATE_RAD_S);
    fx += -gyro * this.leanRate.z;
    fz += gyro * this.leanRate.x;
    this.leanRate = clampLength({ x: this.leanRate.x + fx * dt, z: this.leanRate.z + fz * dt }, m.maxAngularSpeed);
    this.lean = clampLength({ x: this.lean.x + this.leanRate.x * dt, z: this.lean.z + this.leanRate.z * dt }, ATTITUDE_TILT_CLAMP_RAD);
  }

  /** Upright spring strength as a fraction of full: 15% right after an impact, back to 100% over postImpactRecovery (Motion Lab). */
  private recoveryFraction(): number {
    const window = this.motion.postImpactRecovery;
    return window <= 0 ? 1 : Math.min(1, 0.15 + 0.85 * (this.sinceImpactS / window));
  }

  /**
   * Call when MovementController reports a significant impact this tick.
   * The Motion Lab's impact response on the attitude (model.ts
   * applyImpact): a tilt kick along the push (the top keeps going where
   * the base was stopped), a wobble bump, the upright spring's fade-in
   * restarted, and above the direction's tumble threshold a tumble with an
   * extra kick. `impactHorizontalDirection` is the direction of the
   * velocity change; the body itself is untouched.
   */
  registerImpact(_body: RAPIER.RigidBody, impactDeltaSpeedMps: number, impactHorizontalDirection: Vec2): void {
    const m = this.motion;
    const push = { x: -impactHorizontalDirection.x, z: -impactHorizontalDirection.z };
    const labSpeed = labImpactSpeed(impactDeltaSpeedMps, m);
    let kick = m.impactAngularImpulse * labSpeed;
    if (labSpeed > m.tumbleThreshold) {
      const excess = labSpeed - m.tumbleThreshold;
      kick += m.tumbleStrength * excess * 0.5;
      this.tumbleRemainingS = Math.max(this.tumbleRemainingS, TUMBLE_BASE_DURATION_S + TUMBLE_DURATION_PER_MPS * excess);
    }
    this.leanRate = clampLength({ x: this.leanRate.x + push.x * kick, z: this.leanRate.z + push.z * kick }, m.maxAngularSpeed);

    this.wobbleEnergy = Math.min(WOBBLE_ENERGY_MAX, this.wobbleEnergy + labSpeed * m.wobbleFromImpact);
    this.sinceImpactS = 0;
  }

  /**
   * Milestone 3 — player-triggered air recovery (see DodgeController):
   * instantly cuts wobble and swings the attitude back toward upright, on
   * top of (not instead of) the passive upright spring. Self-contained —
   * callers never need to know how tilt/wobble are represented internally.
   */
  applyAirRecovery(_body: RAPIER.RigidBody): void {
    this.wobbleEnergy = Math.max(0, this.wobbleEnergy - AIR_RECOVERY_WOBBLE_REDUCTION);
    this.leanRate = { x: -this.lean.x * AIR_RECOVERY_ATTITUDE_RETURN_PER_S, z: -this.lean.z * AIR_RECOVERY_ATTITUDE_RETURN_PER_S };
    this.tumbleRemainingS = 0;
  }

  getWobbleOffsetRad(): number {
    return Math.sin(this.wobbleTimeAccumulatorS * this.motion.wobbleFrequency * Math.PI * 2) * this.motion.wobbleAmplitude * DEG * this.wobbleEnergy;
  }

  getSnapshot(body: RAPIER.RigidBody): SpinSnapshot {
    return {
      tiltRad: Math.hypot(this.lean.x, this.lean.z),
      angularVelocity: body.angvel(),
      spinRateRadPerSec: this.spinRateRadPerSec,
      visualSpinAngleRad: this.visualSpinAngleRad,
      wobbleEnergy: this.wobbleEnergy,
      wobbleOffsetRad: this.getWobbleOffsetRad(),
      lean: { ...this.lean },
      isTumbling: this.tumbleRemainingS > 0,
      recoveryFraction: this.recoveryFraction(),
    };
  }

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). The attitude is render-only (no gameplay reads it) and stays out. */
  getDeterministicState(): CanonicalRecord {
    return { spinRateRadPerSec: this.spinRateRadPerSec };
  }
}
