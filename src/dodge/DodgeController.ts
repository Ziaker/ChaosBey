// ============================================================
// DODGE CONTROLLER
// State machine for Action.Dodge (GDD section 14/22). Grounded: Idle ->
// Dodging (a momentum-preserving burst + i-frames, with an early
// "perfect" sub-window) -> Cooldown -> Idle. Airborne: NOT another
// evasion window — Dodge only does anything if this specific airborne
// period was caused by a knockback/launch (registerLaunch()), in which
// case it triggers a one-shot air recovery instead (GDD section 21: a
// normal jump must never grant air recovery).
//
// Only ever touches the body directly for the dodge's own burst (mirroring
// how DriftController applies its hop impulse directly) — otherwise talks
// to MovementController only through lateralGripOverridePerS, same as
// Drift, so the two combine without either writing velocity behind the
// other's back.
// ============================================================

import type RAPIER from '@dimforge/rapier3d-compat';
import { Action, type ControllerActions } from '../input/actions/Action';
import { add, fromYaw, normalize, perpendicular, scale, type Vec2 } from '../physics/Vec2';
import {
  DODGE_ACTIVE_DURATION_S,
  DODGE_BURST_SPEED_MPS,
  DODGE_COOLDOWN_S,
  DODGE_GRIP_OVERRIDE_PER_S,
  DODGE_PERFECT_WINDOW_S,
  DODGE_STAMINA_COST,
  LAUNCH_PENDING_WINDOW_S,
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
  /** Stamina points to subtract this tick (0 most ticks) — tickMatch applies it; this controller never touches StaminaSystem directly. */
  staminaCostThisTick: number;
}

export class DodgeController {
  private state = DodgeState.Idle;
  private activeTimerS = 0;
  private cooldownTimerS = 0;
  private wasGrounded = true;
  private airRecoveryAvailable = false;
  private launchPending = false;
  private launchPendingRemainingS = 0;

  getState(): DodgeState {
    return this.state;
  }

  /** Call when a knockback/launch impulse (normal knockback or the Circular-catches-Dash upward launch) is applied to this Bey — arms air recovery for the airborne period that follows, if any (GDD section 21). A normal jump must never call this. */
  registerLaunch(): void {
    this.launchPending = true;
    this.launchPendingRemainingS = LAUNCH_PENDING_WINDOW_S;
  }

  tick(
    body: RAPIER.RigidBody,
    actions: ControllerActions,
    headingRad: number,
    grounded: boolean,
    staminaValue: number,
    fixedDeltaSeconds: number,
  ): DodgeTickResult {
    const dodgePressed = actions.pressedThisFrame.has(Action.Dodge);

    if (this.launchPending) {
      this.launchPendingRemainingS -= fixedDeltaSeconds;
      if (this.launchPendingRemainingS <= 0) this.launchPending = false;
    }

    if (!grounded && this.wasGrounded) {
      // Just left the ground this tick — arm recovery only if that was
      // caused by a recent launch, and consume the pending flag either way
      // so it can't leak into some later, unrelated jump.
      this.airRecoveryAvailable = this.launchPending;
      this.launchPending = false;
    }
    this.wasGrounded = grounded;

    let triggeredAirRecovery = false;

    if (!grounded) {
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
        staminaCostThisTick: 0,
      };
    }

    let staminaCostThisTick = 0;

    switch (this.state) {
      case DodgeState.Idle:
        if (dodgePressed && staminaValue >= DODGE_STAMINA_COST) {
          this.state = DodgeState.Dodging;
          this.activeTimerS = 0;
          staminaCostThisTick = DODGE_STAMINA_COST;
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
      staminaCostThisTick,
    };
  }

  /** GDD section 22: dodges in the direction currently pressed/selected, relative to the Bey (forward/back/lateral, diagonals normalized) — defaults to forward when no direction is held. Adds the burst on top of existing velocity rather than replacing it, so momentum stays relevant (GDD section 15/88). */
  private applyBurst(body: RAPIER.RigidBody, actions: ControllerActions, headingRad: number): void {
    const forward = fromYaw(headingRad);
    const right = perpendicular(forward);

    const lateralInput = (actions.held.has(Action.SteerRight) ? 1 : 0) - (actions.held.has(Action.SteerLeft) ? 1 : 0);
    const forwardInput = (actions.held.has(Action.MoveForward) ? 1 : 0) - (actions.held.has(Action.MoveBackward) ? 1 : 0);

    let direction: Vec2 = add(scale(forward, forwardInput), scale(right, lateralInput));
    if (lateralInput === 0 && forwardInput === 0) direction = forward; // no direction held — default to forward.
    direction = normalize(direction);

    const vel = body.linvel();
    const burst = scale(direction, DODGE_BURST_SPEED_MPS);
    body.setLinvel({ x: vel.x + burst.x, y: vel.y, z: vel.z + burst.z }, true);
  }
}
