// ============================================================
// DRIFT CONTROLLER
// State machine for the hop -> hold -> drift -> recover flow (GDD section
// 19). Talks to MovementController only through the lateralGripOverridePerS
// value it hands back each tick — it never touches heading/thrust itself,
// keeping drift and movement independently diagnosable (GDD section 17.4
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
}

export class DriftController {
  private state = DriftState.Idle;
  private hopTimerS = 0;
  private recoveryTimerS = 0;

  tick(body: RAPIER.RigidBody, actions: ControllerActions, grounded: boolean, fixedDeltaSeconds: number): DriftTickResult {
    const jumpDriftHeld = actions.held.has(Action.JumpDrift);
    const jumpDriftPressed = actions.pressedThisFrame.has(Action.JumpDrift);
    // The approved control is hop, then hold JumpDrift *while steering* to
    // slide (GDD section 19) — holding JumpDrift straight must not drift.
    const steering = actions.held.has(Action.SteerLeft) || actions.held.has(Action.SteerRight);

    switch (this.state) {
      case DriftState.Idle:
        if (jumpDriftPressed && grounded) {
          this.state = DriftState.Hopping;
          this.hopTimerS = 0;
          const vel = body.linvel();
          body.setLinvel({ x: vel.x, y: vel.y + HOP_IMPULSE_MPS, z: vel.z }, true);
        }
        break;

      case DriftState.Hopping:
        this.hopTimerS += fixedDeltaSeconds;
        if (this.hopTimerS >= HOP_MIN_AIRBORNE_DURATION_S && grounded) {
          this.state = jumpDriftHeld && steering ? DriftState.Drifting : DriftState.Idle;
        }
        break;

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
          this.state = DriftState.Hopping;
          this.hopTimerS = 0;
          const vel = body.linvel();
          body.setLinvel({ x: vel.x, y: vel.y + HOP_IMPULSE_MPS, z: vel.z }, true);
        } else if (this.recoveryTimerS >= DRIFT_GRIP_RECOVERY_DURATION_S) {
          this.state = DriftState.Idle;
        }
        break;
    }

    return {
      lateralGripOverridePerS: this.computeLateralGripOverride(),
      driftState: this.state,
    };
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
