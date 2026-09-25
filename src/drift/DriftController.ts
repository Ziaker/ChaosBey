// ============================================================
// DRIFT / JUMP CONTROLLER
// State machine for the hop -> hold -> drift -> recover flow (GDD section
// 19), plus the Milestone 3 variable-height jump and landing-recovery that
// sit on top of the same hop (see DriftTuning.ts). Talks to
// MovementController only through the lateralGripOverridePerS value it
// hands back each tick — it never touches heading/thrust itself, keeping
// drift/jump and movement independently diagnosable (GDD section 17.4
// component separation).
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
  LANDING_RECOVERY_DURATION_S,
} from './DriftTuning';

export enum DriftState {
  Idle = 'Idle',
  Hopping = 'Hopping',
  Drifting = 'Drifting',
  Recovering = 'Recovering',
  /** Grip easing back after landing from a big (held) jump — mechanically identical to Recovering, reported distinctly since no drift actually happened. */
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

        // Variable jump height (Milestone 3): still holding while ascending
        // adds extra lift, up to a cap. Never applies once falling (vel.y
        // <= 0) — this is height assist, not a hover.
        if (jumpDriftHeld && this.jumpAssistElapsedS < JUMP_ASSIST_MAX_DURATION_S) {
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
            this.recoveryTimerS = 0;
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
        this.recoveryTimerS += fixedDeltaSeconds;
        if (jumpDriftPressed && grounded) {
          this.beginHop(body);
        } else if (this.recoveryTimerS >= LANDING_RECOVERY_DURATION_S) {
          this.state = DriftState.Idle;
        }
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
    if (this.state === DriftState.Landing) {
      const t = Math.min(1, this.recoveryTimerS / LANDING_RECOVERY_DURATION_S);
      return DRIFT_LATERAL_GRIP_PER_S + (LATERAL_GRIP_PER_S - DRIFT_LATERAL_GRIP_PER_S) * t;
    }
    return null;
  }
}
