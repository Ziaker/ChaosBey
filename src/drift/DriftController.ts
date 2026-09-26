// ============================================================
// DRIFT / JUMP CONTROLLER
// State machine for the hop -> hold -> drift -> recover flow (GDD section
// 19), plus the Milestone 3 variable-height jump that sits on top of the
// same hop (see DriftTuning.ts). Talks to MovementController only through
// the lateralGripOverridePerS value it hands back each tick — it never
// touches heading/thrust itself, keeping drift/jump and movement
// independently diagnosable (GDD section 17.4 component separation).
//
// Jump vs. drift share the same liftoff (JumpDrift/X) but are told apart
// by steering (GDD section 19 vs. 20): holding X *without* steering keeps
// adding height (variable jump); the moment steering is held, that signals
// drift intent — height assist stops immediately and the hop stays at its
// small Milestone 1 liftoff, so a drift-into slide never accidentally
// becomes a tall jump.
//
// Landing is detected generically, independent of DriftState: any
// grounded<-airborne transition (a hop, a knockback launch, falling off a
// ledge) reports justLanded plus descent speed/intensity/jump-assist data
// for Milestone 4's VFX/camera to react to — it never gates on being in
// the Hopping state, and carries no handling penalty of its own.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import { Action, type ControllerActions } from '../input/actions/Action';
import { LATERAL_GRIP_PER_S } from '../bey/movement/MovementTuning';
import {
  DRIFT_GRIP_RECOVERY_DURATION_S,
  DRIFT_LATERAL_GRIP_PER_S,
  HOP_IMPULSE_MPS,
  HOP_MIN_AIRBORNE_DURATION_S,
  JUMP_ASSIST_ACCEL_MPS2,
  JUMP_ASSIST_MAX_DURATION_S,
  LANDING_INTENSITY_REFERENCE_DESCENT_SPEED_MPS,
} from './DriftTuning';

export enum DriftState {
  Idle = 'Idle',
  Hopping = 'Hopping',
  Drifting = 'Drifting',
  Recovering = 'Recovering',
}

export interface DriftTickResult {
  /** Passed straight to MovementController.applyPreStep's lateralGripOverridePerS parameter; null means "use normal grip". */
  lateralGripOverridePerS: number | null;
  driftState: DriftState;
  /** True for exactly one tick: this Bey just transitioned from airborne to grounded — any cause (a hop, a knockback launch, falling off a ledge), independent of DriftState. */
  justLanded: boolean;
  /** Descent speed (m/s, >= 0) measured the tick before touchdown was detected. Only meaningful when justLanded is true. */
  landingDescentSpeedMps: number;
  /** A tunable 0..1 metric derived from landingDescentSpeedMps, for Milestone 4's VFX/camera (dust/sparks/shockwave/camera shake) to scale by. Only meaningful when justLanded is true. */
  landingIntensity: number;
  /** How long (seconds) the variable-jump height assist applied during the airborne period that just ended; 0 if this wasn't a jump (e.g. a knockback fall) or was a bare tap. Only meaningful when justLanded is true. */
  landingJumpAssistElapsedS: number;
}

export class DriftController {
  private state = DriftState.Idle;
  private hopTimerS = 0;
  private recoveryTimerS = 0;
  private jumpAssistElapsedS = 0;
  private wasGrounded = true;
  private lastAirborneVerticalVelocityMps = 0;

  /**
   * normalLateralGripPerS: the grip Recovering eases back toward — must be
   * this Bey's own BeyHandlingProfile.lateralGripPerS (Milestone 6: grip
   * differs per archetype), not the global MovementTuning default, or the
   * recovery ends at the wrong value and grip snaps the moment the
   * override is released.
   */
  constructor(private readonly normalLateralGripPerS: number = LATERAL_GRIP_PER_S) {}

  /** Current state without advancing anything — for read-only consumers (e.g. a frozen post-round snapshot) that must not progress the state machine. */
  getState(): DriftState {
    return this.state;
  }

  tick(body: RAPIER.RigidBody, actions: ControllerActions, grounded: boolean, fixedDeltaSeconds: number): DriftTickResult {
    const jumpDriftHeld = actions.held.has(Action.JumpDrift);
    const jumpDriftPressed = actions.pressedThisFrame.has(Action.JumpDrift);
    // The approved control is hop, then hold JumpDrift *while steering* to
    // slide (GDD section 19) — holding JumpDrift straight must not drift.
    const steering = actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight);

    if (!grounded) {
      // Keep sampling this every tick while airborne so the last value
      // recorded (read the tick before landing is detected) is the closest
      // available proxy for actual pre-impact descent speed.
      this.lastAirborneVerticalVelocityMps = body.linvel().y;
    }

    let justLanded = false;
    let landingDescentSpeedMps = 0;
    let landingIntensity = 0;
    let landingJumpAssistElapsedS = 0;

    if (this.wasGrounded && !grounded) {
      // Leaving the ground for any reason starts a fresh airborne period
      // with no jump-height assist accrued yet — beginHop() below only
      // adds to it if this period turns out to actually be a jump.
      this.jumpAssistElapsedS = 0;
    } else if (!this.wasGrounded && grounded) {
      justLanded = true;
      landingDescentSpeedMps = Math.max(0, -this.lastAirborneVerticalVelocityMps);
      landingIntensity = Math.min(1, landingDescentSpeedMps / LANDING_INTENSITY_REFERENCE_DESCENT_SPEED_MPS);
      landingJumpAssistElapsedS = this.jumpAssistElapsedS;
    }
    this.wasGrounded = grounded;

    switch (this.state) {
      case DriftState.Idle:
        if (jumpDriftPressed && grounded) {
          this.beginHop(body);
        }
        break;

      case DriftState.Hopping: {
        this.hopTimerS += fixedDeltaSeconds;

        // Variable jump height (Milestone 3): held *without* steering keeps
        // adding lift, up to a cap. Steering signals drift intent instead —
        // stop adding height so the drift hop stays small and consistent.
        // Never applies once falling (vel.y <= 0) — this is height assist,
        // not a hover.
        if (jumpDriftHeld && !steering && this.jumpAssistElapsedS < JUMP_ASSIST_MAX_DURATION_S) {
          const vel = body.linvel();
          if (vel.y > 0) {
            body.setLinvel({ x: vel.x, y: vel.y + JUMP_ASSIST_ACCEL_MPS2 * fixedDeltaSeconds, z: vel.z }, true);
            this.jumpAssistElapsedS += fixedDeltaSeconds;
          }
        }

        if (this.hopTimerS >= HOP_MIN_AIRBORNE_DURATION_S && grounded) {
          this.state = jumpDriftHeld && steering ? DriftState.Drifting : DriftState.Idle;
        }
        break;
      }

      case DriftState.Drifting:
        if (!jumpDriftHeld || !grounded || !steering) {
          this.state = DriftState.Recovering;
          this.recoveryTimerS = 0;
        }
        break;

      case DriftState.Recovering:
        this.recoveryTimerS += fixedDeltaSeconds;
        if (jumpDriftPressed && grounded) {
          // Chaining into a fresh drift is allowed mid-recovery.
          this.beginHop(body);
        } else if (this.recoveryTimerS >= DRIFT_GRIP_RECOVERY_DURATION_S) {
          this.state = DriftState.Idle;
        }
        break;
    }

    return {
      lateralGripOverridePerS: this.computeLateralGripOverride(),
      driftState: this.state,
      justLanded,
      landingDescentSpeedMps,
      landingIntensity,
      landingJumpAssistElapsedS,
    };
  }

  private beginHop(body: RAPIER.RigidBody): void {
    this.state = DriftState.Hopping;
    this.hopTimerS = 0;
    this.jumpAssistElapsedS = 0;
    const vel = body.linvel();
    body.setLinvel({ x: vel.x, y: vel.y + HOP_IMPULSE_MPS, z: vel.z }, true);
  }

  private computeLateralGripOverride(): number | null {
    if (this.state === DriftState.Drifting) {
      return DRIFT_LATERAL_GRIP_PER_S;
    }
    if (this.state === DriftState.Recovering) {
      const t = Math.min(1, this.recoveryTimerS / DRIFT_GRIP_RECOVERY_DURATION_S);
      return DRIFT_LATERAL_GRIP_PER_S + (this.normalLateralGripPerS - DRIFT_LATERAL_GRIP_PER_S) * t;
    }
    return null;
  }
}
