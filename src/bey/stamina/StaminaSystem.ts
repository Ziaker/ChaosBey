// ============================================================
// STAMINA SYSTEM
// Owns the Stamina resource and derives the physical-condition
// multipliers MovementController/SpinController apply — Stamina itself
// never touches physics directly (GDD section 1.4 separation).
// ============================================================

import { Resource } from '../core/Resource';
import {
  STAMINA_BASE_DRAIN_PER_S,
  STAMINA_DRAIN_SPEED_THRESHOLD_FRACTION,
  STAMINA_EXTRA_DRAIN_PER_S_AT_FULL_SPEED,
  STAMINA_MAX,
  STAMINA_MAX_SPIN_DECAY_MULTIPLIER,
  STAMINA_MAX_WOBBLE_ENERGY_FLOOR,
  STAMINA_MIN_ACCEL_FACTOR,
  STAMINA_MIN_RECOVERY_TORQUE_FACTOR,
  STAMINA_PENALTY_START_FRACTION,
} from './StaminaTuning';
import { INTENDED_MAX_SPEED_MPS } from '../movement/MovementTuning';

/** Physical-condition multipliers derived from current Stamina, consumed by movement/spin (never raw Stamina numbers). */
export interface PhysicalCondition {
  accelFactor: number;
  recoveryTorqueFactor: number;
  spinDecayMultiplier: number;
  ambientWobbleFloor: number;
}

/** No penalty at all — for contexts with no Stamina system (e.g. Milestone 1 physics-only tests). */
export const FULL_PHYSICAL_CONDITION: PhysicalCondition = {
  accelFactor: 1,
  recoveryTorqueFactor: 1,
  spinDecayMultiplier: 1,
  ambientWobbleFloor: 0,
};

export class StaminaSystem {
  readonly resource: Resource;

  /** staminaStat: archetype Stamina multiplier (GDD section 6/31, Milestone 6) — 1 = neutral. Higher gives a larger max pool and divides drain, so it degrades slower; see BeyStats.ts. */
  constructor(private readonly staminaStat: number = 1) {
    this.resource = new Resource(STAMINA_MAX * staminaStat);
  }

  /** Stamina only ever drains during a round (owner decision 2026-09-25: no passive in-round regen) — a small baseline drain from continuous spin/combat, plus extra drain the faster the Bey moves. */
  tick(currentSpeedMps: number, fixedDeltaSeconds: number): void {
    const speedFraction = currentSpeedMps / INTENDED_MAX_SPEED_MPS;
    const extraEffortFraction = Math.max(0, speedFraction - STAMINA_DRAIN_SPEED_THRESHOLD_FRACTION) / (1 - STAMINA_DRAIN_SPEED_THRESHOLD_FRACTION);
    const drainPerS = STAMINA_BASE_DRAIN_PER_S + STAMINA_EXTRA_DRAIN_PER_S_AT_FULL_SPEED * Math.min(1, extraEffortFraction);
    this.resource.subtract((drainPerS / this.staminaStat) * fixedDeltaSeconds);
  }

  getPhysicalCondition(): PhysicalCondition {
    const penaltyProgress = 1 - Math.min(1, this.resource.fraction / STAMINA_PENALTY_START_FRACTION);
    return {
      accelFactor: lerp(1, STAMINA_MIN_ACCEL_FACTOR, penaltyProgress),
      recoveryTorqueFactor: lerp(1, STAMINA_MIN_RECOVERY_TORQUE_FACTOR, penaltyProgress),
      spinDecayMultiplier: lerp(1, STAMINA_MAX_SPIN_DECAY_MULTIPLIER, penaltyProgress),
      ambientWobbleFloor: lerp(0, STAMINA_MAX_WOBBLE_ENERGY_FLOOR, penaltyProgress),
    };
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}
