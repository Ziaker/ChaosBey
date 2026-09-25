// ============================================================
// DODGE CONTROLLER
// State machine for Action.Dodge (GDD section 14/22). Grounded: Idle ->
// Dodging (a momentum-preserving burst + i-frames, with an early
// "perfect" sub-window) -> Cooldown -> Idle. The Dodging/Cooldown timers
// advance every tick on simulated time regardless of grounded state (an
// airborne stretch mid-dodge must not pause the cooldown), but i-frames,
// the grip override, and starting a fresh dodge all require actually being
// grounded right now. Airborne: NOT another evasion window — pressing
// Dodge only does anything if this specific airborne period was caused by
// a knockback/launch (registerLaunch()), in which case it triggers a
// one-shot air recovery instead (GDD section 21: a normal jump, or a
// wall/floor bounce that leaves the Bey grounded, must never grant it).
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

  /**
   * Call when a knockback/launch impulse (normal knockback or the
   * Circular-catches-Dash upward launch) is applied to this Bey — arms Air
   * Recovery for the airborne period the launch causes (GDD section 21). A
   * normal jump, or a wall/floor bounce that leaves the Bey grounded, must
   * never call this.
   *
   * @param currentlyAirborne Whether this Bey is airborne right now, at the
   * moment of the launch (e.g. it was already mid-jump when the knockback
   * landed). If true, Air Recovery is armed immediately for this same
   * airborne period — there will be no further grounded->airborne
   * transition to catch it on. If false (still grounded when launched),
   * arms a short pending window instead, consumed the next time this Bey
   * actually leaves the ground.
   */
  registerLaunch(currentlyAirborne: boolean): void {
    if (currentlyAirborne) {
      this.airRecoveryAvailable = true;
      this.launchPending = false;
    } else {
      this.launchPending = true;
      this.launchPendingRemainingS = LAUNCH_PENDING_WINDOW_S;
    }
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
    if (!grounded && dodgePressed && this.airRecoveryAvailable) {
      this.airRecoveryAvailable = false;
      triggeredAirRecovery = true;
    }

    // The ground dodge/cooldown state machine keeps advancing on the fixed
    // timestep regardless of grounded state — an airborne Bey (e.g. a
    // dodge that carried it off a ledge, or a knockback mid-dodge) must not
    // get a free pause on its own cooldown, nor an i-frame window that
    // silently outlives its intended duration. Only *starting* a fresh
    // ground dodge, and the i-frames/grip override a Dodging state grants,
    // require actually being grounded right now.
    let staminaCostThisTick = 0;
    switch (this.state) {
      case DodgeState.Idle:
        if (grounded && dodgePressed && staminaValue >= DODGE_STAMINA_COST) {
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

    const grantsGroundIFrames = grounded && this.state === DodgeState.Dodging;

    return {
      state: this.state,
      lateralGripOverridePerS: grantsGroundIFrames ? DODGE_GRIP_OVERRIDE_PER_S : null,
      hasIFrames: grantsGroundIFrames,
      isPerfectWindow: grantsGroundIFrames && this.activeTimerS <= DODGE_PERFECT_WINDOW_S,
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
