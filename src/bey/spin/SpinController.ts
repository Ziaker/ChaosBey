// ============================================================
// SPIN CONTROLLER
// Owns rotational state: the physics-driven tilt (via an upright recovery
// torque on the real rigid body), a decoupled continuous visual spin
// value, and a bounded visual-only wobble oscillation. See SpinTuning.ts
// for the GDD section 17/83/84 rationale behind this split.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import type { Vec2 } from '../../physics/Vec2';
import type { PhysicalCondition } from '../stamina/StaminaSystem';
import {
  BASE_SPIN_RATE_RAD_S,
  IMPACT_ANGULAR_IMPULSE_PER_MPS,
  RECOVERY_DAMPING_PER_S,
  SPIN_DECAY_FRACTION_PER_S,
  UPRIGHT_RECOVERY_TORQUE_GAIN,
  WOBBLE_AMPLITUDE_RAD,
  WOBBLE_DECAY_FRACTION_PER_S,
  WOBBLE_ENERGY_MAX,
  WOBBLE_FREQUENCY_HZ,
  WOBBLE_IMPACT_ENERGY_GAIN_PER_MPS,
} from './SpinTuning';

export interface SpinSnapshot {
  tiltRad: number;
  angularVelocity: { x: number; y: number; z: number };
  spinRateRadPerSec: number;
  visualSpinAngleRad: number;
  wobbleEnergy: number;
  wobbleOffsetRad: number;
}

/** Rotated +Y axis of a quaternion — see derivation comment in the source history; standard quat-to-matrix column 2. */
function quatUpVector(q: { x: number; y: number; z: number; w: number }): { x: number; y: number; z: number } {
  return {
    x: 2 * (q.x * q.y - q.w * q.z),
    y: 1 - 2 * (q.x * q.x + q.z * q.z),
    z: 2 * (q.y * q.z + q.w * q.x),
  };
}

function tiltRadFromUpVector(up: { y: number }): number {
  return Math.acos(Math.max(-1, Math.min(1, up.y)));
}

export class SpinController {
  private spinRateRadPerSec = BASE_SPIN_RATE_RAD_S;
  private visualSpinAngleRad = 0;
  private wobbleEnergy = 0;
  private wobbleTimeAccumulatorS = 0;

  /**
   * Call once per fixed tick, before physics.step(). Applies the upright
   * recovery torque and advances the visual spin/wobble accumulators.
   *
   * `staminaCondition` degrades this physically as Stamina drops (GDD
   * section 30/123): weaker recovery torque, faster spin decay, and an
   * ambient wobble floor — a tired Bey visibly loses physical confidence,
   * it doesn't get a config flag flipped.
   */
  tick(body: RAPIER.RigidBody, fixedDeltaSeconds: number, staminaCondition: PhysicalCondition): void {
    const up = quatUpVector(body.rotation());

    // torqueAxisRaw = cross(up, worldUp); its magnitude is already sin(tilt),
    // so this alone is a natural proportional controller (bigger tilt =>
    // stronger correction) without needing to normalize.
    const torqueAxisRaw = { x: -up.z, y: 0, z: up.x };
    const angvel = body.angvel();
    const recoveryGain = UPRIGHT_RECOVERY_TORQUE_GAIN * staminaCondition.recoveryTorqueFactor;
    const dampingGain = RECOVERY_DAMPING_PER_S * staminaCondition.recoveryTorqueFactor;

    body.addTorque(
      {
        x: torqueAxisRaw.x * recoveryGain - angvel.x * dampingGain,
        y: -angvel.y * dampingGain * 0.25, // light yaw damping only — this is not what drives visible spin, see class doc.
        z: torqueAxisRaw.z * recoveryGain - angvel.z * dampingGain,
      },
      true,
    );

    this.spinRateRadPerSec *= Math.max(0, 1 - SPIN_DECAY_FRACTION_PER_S * staminaCondition.spinDecayMultiplier * fixedDeltaSeconds);
    this.visualSpinAngleRad += this.spinRateRadPerSec * fixedDeltaSeconds;

    this.wobbleEnergy = Math.max(
      this.wobbleEnergy * Math.max(0, 1 - WOBBLE_DECAY_FRACTION_PER_S * fixedDeltaSeconds),
      staminaCondition.ambientWobbleFloor,
    );
    this.wobbleTimeAccumulatorS += fixedDeltaSeconds;
  }

  /** Call when MovementController reports a significant impact this tick. Knocks the Bey off-axis and bumps wobble energy. Never mutates physics beyond this one impulse — the recovery torque in tick() handles gradual return to upright. */
  registerImpact(body: RAPIER.RigidBody, impactDeltaSpeedMps: number, impactHorizontalDirection: Vec2): void {
    // Angular impulse axis perpendicular to the impact direction (in the
    // horizontal plane), so a hit from the +Z direction tips the Bey
    // around X, etc. — a believable "knocked over sideways" response.
    const impulseMagnitude = impactDeltaSpeedMps * IMPACT_ANGULAR_IMPULSE_PER_MPS;
    body.applyTorqueImpulse(
      {
        x: -impactHorizontalDirection.z * impulseMagnitude,
        y: 0,
        z: impactHorizontalDirection.x * impulseMagnitude,
      },
      true,
    );

    this.wobbleEnergy = Math.min(WOBBLE_ENERGY_MAX, this.wobbleEnergy + impactDeltaSpeedMps * WOBBLE_IMPACT_ENERGY_GAIN_PER_MPS);
  }

  getWobbleOffsetRad(): number {
    return Math.sin(this.wobbleTimeAccumulatorS * WOBBLE_FREQUENCY_HZ * Math.PI * 2) * WOBBLE_AMPLITUDE_RAD * this.wobbleEnergy;
  }

  getSnapshot(body: RAPIER.RigidBody): SpinSnapshot {
    // Recomputed fresh from the body's current orientation (rather than a
    // value cached from tick()'s pre-physics.step() call) so callers get
    // an up-to-date tilt regardless of whether they ask before or after
    // physics.step() this tick.
    return {
      tiltRad: tiltRadFromUpVector(quatUpVector(body.rotation())),
      angularVelocity: body.angvel(),
      spinRateRadPerSec: this.spinRateRadPerSec,
      visualSpinAngleRad: this.visualSpinAngleRad,
      wobbleEnergy: this.wobbleEnergy,
      wobbleOffsetRad: this.getWobbleOffsetRad(),
    };
  }
}
