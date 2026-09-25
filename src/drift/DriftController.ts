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
  JUMP_BIG_JUMP_ASSIST_THRESHOLD_S,
} from './DriftTuning';

export enum DriftState {
  Idle = 'Idle',
  Hopping = 'Hopping',
  Drifting = 'Drifting',
  Recovering = 'Recovering',
  /**
   * Momentary marker (a single tick) for touching down from a big (held)
   * jump — no gameplay effect (the GDD never approved a landing handling
   * penalty), purely an inspectable signal for Milestone 4's VFX/camera to
   * hook a strong-landing reaction onto. Immediately returns to Idle.
   */
  Landing = 'Landing',
}

export interface DriftTickResult {
  /** Passed straight to MovementController.applyPreStep's lateralGripOverridePerS parameter; null means "use normal grip". */
  lateralGripOverridePerS: number | null;
  driftState: DriftState;
}

export class DriftController {
  private state = DriftState.Idle;
  private hopTimerS = 0;
  private recoveryTimerS = 0;
  private jumpAssistElapsedS = 0;

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
          if (jumpDriftHeld && steering) {
            this.state = DriftState.Drifting;
          } else if (this.jumpAssistElapsedS >= JUMP_BIG_JUMP_ASSIST_THRESHOLD_S) {
            this.state = DriftState.Landing;
          } else {
            this.state = DriftState.Idle;
          }
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

      case DriftState.Landing:
        // No penalty, no timer — resolves on the very next tick.
        this.state = DriftState.Idle;
        break;
    }

    return {
      lateralGripOverridePerS: this.computeLateralGripOverride(),
      driftState: this.state,
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
      return DRIFT_LATERAL_GRIP_PER_S + (LATERAL_GRIP_PER_S - DRIFT_LATERAL_GRIP_PER_S) * t;
    }
    return null;
  }
}
