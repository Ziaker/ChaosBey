// ============================================================
// DODGE CONTROLLER
// State machine for Action.Dodge (Milestone 3, GDD section 14/19-ish
// evasion suite). Grounded: Idle -> Dodging (burst + i-frames, with an
// early "perfect" sub-window) -> Cooldown -> Idle. Airborne: a one-shot
// air-recovery trigger instead (consumed on landing, refreshed on the next
// airborne period) — see SpinController.applyAirRecovery.
//
// Only ever touches the body directly for the dodge's own one-time burst
// impulse (mirroring how DriftController applies its hop impulse
// directly) — otherwise talks to MovementController only through
// lateralGripOverridePerS, same as Drift, so the two can combine without
// either writing velocity behind the other's back.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import { Action, type ControllerActions } from '../input/actions/Action';
import { fromYaw, perpendicular } from '../physics/Vec2';
import {
  DODGE_ACTIVE_DURATION_S,
  DODGE_BURST_SPEED_MPS,
  DODGE_COOLDOWN_S,
  DODGE_GRIP_OVERRIDE_PER_S,
  DODGE_PERFECT_WINDOW_S,
} from './DodgeTuning';

export enum DodgeState {
  Idle = 'Idle',
  Dodging = 'Dodging',
  Cooldown = 'Cooldown',
}

export interface DodgeTickResult {
  state: DodgeState;
  /** Passed straight to MovementController.applyPreStep's lateralGripOverridePerS parameter; null means "defer to whatever else wants it (e.g. Drift)". */
  lateralGripOverridePerS: number | null;
  /** True while incoming hits must be ignored entirely (see tickMatch). */
  hasIFrames: boolean;
  /** True this tick if a hit landing right now would count as a Perfect Dodge — tighter than hasIFrames alone. */
  isPerfectWindow: boolean;
  /** True the one tick air recovery was just triggered — tickMatch applies SpinController.applyAirRecovery() when this fires. */
  triggeredAirRecovery: boolean;
}

export class DodgeController {
  private state = DodgeState.Idle;
  private activeTimerS = 0;
  private cooldownTimerS = 0;
  private wasGrounded = true;
  private airRecoveryAvailable = true;

  getState(): DodgeState {
    return this.state;
  }

  tick(body: RAPIER.RigidBody, actions: ControllerActions, headingRad: number, grounded: boolean, fixedDeltaSeconds: number): DodgeTickResult {
    const dodgePressed = actions.pressedThisFrame.has(Action.Dodge);

    if (!grounded && this.wasGrounded) {
      this.airRecoveryAvailable = true;
    }
    this.wasGrounded = grounded;

    let triggeredAirRecovery = false;

    if (!grounded) {
      // Airborne: Dodge is a one-shot recovery trigger, not another evasion
      // window — the ground dodge state machine below simply doesn't run
      // while airborne (its Idle/Cooldown transitions all require landing
      // first, matching Drift/Jump's own grounded-only liftoff rule).
      if (dodgePressed && this.airRecoveryAvailable) {
        this.airRecoveryAvailable = false;
        triggeredAirRecovery = true;
      }
      return {
        state: this.state,
        lateralGripOverridePerS: null,
        hasIFrames: false,
        isPerfectWindow: false,
        triggeredAirRecovery,
      };
    }

    switch (this.state) {
      case DodgeState.Idle:
        if (dodgePressed) {
          this.state = DodgeState.Dodging;
          this.activeTimerS = 0;
          this.applyBurst(body, actions, headingRad);
        }
        break;

      case DodgeState.Dodging:
        this.activeTimerS += fixedDeltaSeconds;
        if (this.activeTimerS >= DODGE_ACTIVE_DURATION_S) {
          this.state = DodgeState.Cooldown;
          this.cooldownTimerS = 0;
        }
        break;

      case DodgeState.Cooldown:
        this.cooldownTimerS += fixedDeltaSeconds;
        if (this.cooldownTimerS >= DODGE_COOLDOWN_S) {
          this.state = DodgeState.Idle;
        }
        break;
    }

    return {
      state: this.state,
      lateralGripOverridePerS: this.state === DodgeState.Dodging ? DODGE_GRIP_OVERRIDE_PER_S : null,
      hasIFrames: this.state === DodgeState.Dodging,
      isPerfectWindow: this.state === DodgeState.Dodging && this.activeTimerS <= DODGE_PERFECT_WINDOW_S,
      triggeredAirRecovery,
    };
  }

  private applyBurst(body: RAPIER.RigidBody, actions: ControllerActions, headingRad: number): void {
    const steerInput = (actions.held.has(Action.SteerRight) ? 1 : 0) - (actions.held.has(Action.SteerLeft) ? 1 : 0);
    const sign = steerInput !== 0 ? steerInput : 1; // default to the right if no steering input is held.
    const side = perpendicular(fromYaw(headingRad));

    const vel = body.linvel();
    body.setLinvel({ x: side.x * sign * DODGE_BURST_SPEED_MPS, y: vel.y, z: side.z * sign * DODGE_BURST_SPEED_MPS }, true);
  }
}
