// ============================================================
// BEY HANDLING PROFILE — ARCHETYPE MOVEMENT FEEL (MILESTONE 6)
// The subset of MovementController's tuning chosen to vary per archetype:
// acceleration/reverse acceleration, top speed, turn rate and lateral
// grip. Everything else in MovementTuning.ts (drag, airborne factors,
// post-impact grip suppression, steering response) stays a single global
// constant — not every number needs to be an archetype axis, and the GDD's
// Attack/Defense/Stamina identity is expressed clearly enough through this
// subset (GDD section 6/31).
// DEFAULT_HANDLING_PROFILE mirrors the current MovementTuning constants
// exactly, so a Bey created without an explicit profile (or with this one)
// behaves identically to every pre-Milestone-6 self-test.
// ============================================================

import {
  ACCELERATION_MPS2,
  INTENDED_MAX_SPEED_MPS,
  LATERAL_GRIP_PER_S,
  REVERSE_ACCELERATION_MPS2,
  STEERING_MAX_TURN_RATE_RAD_S,
} from '../movement/MovementTuning';

export interface BeyHandlingProfile {
  accelerationMps2: number;
  reverseAccelerationMps2: number;
  maxSpeedMps: number;
  turnRateRadS: number;
  lateralGripPerS: number;
}

export const DEFAULT_HANDLING_PROFILE: BeyHandlingProfile = {
  accelerationMps2: ACCELERATION_MPS2,
  reverseAccelerationMps2: REVERSE_ACCELERATION_MPS2,
  maxSpeedMps: INTENDED_MAX_SPEED_MPS,
  turnRateRadS: STEERING_MAX_TURN_RATE_RAD_S,
  lateralGripPerS: LATERAL_GRIP_PER_S,
};
