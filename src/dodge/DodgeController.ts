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
import { vec2, type CanonicalRecord } from '../replay/state/CanonicalValue';
import { intentMagnitude } from '../bey/movement/directionalIntent';

export enum DodgeState {
  Idle = 'Idle',
  Dodging = 'Dodging',
  Cooldown = 'Cooldown',
}

export interface DodgeTickResult {
  state: DodgeState;
  /** Passed straight to MovementController.applyPreStep's lateralGripOverridePerS parameter; null means "defer to whatever else wants it (e.g. Drift)". Only still meaningful while dodgeOverride is null (an airborne dodge, or once MovementController adds a grounded-only check) — see dodgeOverride below for the grounded flat-velocity phase. */
  lateralGripOverridePerS: number | null;
  /**
   * MovementController.applyPreStep's highest-priority override, set for
   * every tick of the ground dodge's flat-velocity phase (owner decision,
   * "Fix 1" of the movement/weight/dodge playtest pass): the direction
   * latched the instant Dodge was pressed, at DODGE_BURST_SPEED_MPS,
   * replacing the Bey's entire horizontal velocity regardless of prior
   * momentum or any input since. Null outside that phase (Idle, Cooldown,
   * or the one-shot airborne recovery path, which never calls applyBurst).
   */
  dodgeOverride: { velocityMps: Vec2 } | null;
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
  /** MatchConfig.dodgeCooldownS (owner, 2026-10-02: a Pregame slider). */
  constructor(
    private readonly cooldownS: number = DODGE_COOLDOWN_S,
    /** MatchConfig.dodgeStaminaCost (owner, 2026-10-04: 0 — "remover isso completamente"). */
    private readonly staminaCost: number = DODGE_STAMINA_COST,
    /** MatchConfig.dodgeDistanceScale (owner, 2026-10-04): × the burst speed, so × the distance (same duration). */
    private readonly distanceScale: number = 1,
    /**
     * Owner, 2026-10-04 ("faça com que o recovery use a barra de dodge e não deixe utilizá-lo caso não tenha dodge
     * utilizável"): in a match the Air Recovery needs a ready dodge (Idle) and puts it into its cooldown. Bare
     * constructions keep the old free recovery.
     */
    private readonly recoveryUsesDodge: boolean = false,
  ) {}

  /** 0..1 for the HUD's dodge line: 1 = a dodge can start now, refilling during the cooldown, 0 while dodging. */
  getReadiness(): number {
    if (this.state === DodgeState.Cooldown) return this.cooldownS <= 0 ? 1 : Math.max(0, Math.min(1, this.cooldownTimerS / this.cooldownS));
    return this.state === DodgeState.Idle ? 1 : 0;
  }

  private state = DodgeState.Idle;
  private activeTimerS = 0;
  private cooldownTimerS = 0;
  private wasGrounded = true;
  private airRecoveryAvailable = false;
  private launchPending = false;
  private launchPendingRemainingS = 0;
  /** Direction latched once at the Idle->Dodging transition ("Fix 1" — see dodgeOverride on DodgeTickResult). Null outside Dodging. */
  private latchedDirection: Vec2 | null = null;
  /** Opponent attacks (by activation id) this dodge has already reported as evaded: the hit is nullified every tick, the event is told once. */
  private readonly evadedThisDodge = new Set<number>();

  getState(): DodgeState {
    return this.state;
  }

  /** Debug Lab "reset cooldowns" (GDD section 70) — explicit mutation, never called by gameplay. */
  debugResetCooldown(): void {
    if (this.state === DodgeState.Cooldown) this.state = DodgeState.Idle;
    this.cooldownTimerS = 0;
  }

  /** Read-only timers for Debug Lab inspection (GDD section 69). No gameplay code may branch on this. */
  getDebugTimers(): { activeTimerS: number; cooldownRemainingS: number; airRecoveryAvailable: boolean; launchPending: boolean } {
    return {
      activeTimerS: this.state === DodgeState.Dodging ? this.activeTimerS : 0,
      cooldownRemainingS: this.state === DodgeState.Cooldown ? Math.max(0, this.cooldownS - this.cooldownTimerS) : 0,
      airRecoveryAvailable: this.isAirRecoveryAvailable(),
      launchPending: this.launchPending,
    };
  }

  /**
   * Whether pressing Dodge right now (while airborne) would trigger air
   * recovery. Read by Milestone 7's AIController for its OWN Bey only.
   *
   * Why this is not privileged information (GDD section 63/129 — the AI
   * plays by the player's rules): it is true exactly while "I was hit by a
   * knockback/launch, I am airborne because of it, and I have not used
   * recovery yet" — all things a player sees about their own Bey (the hit,
   * the launch, their own C press). It is current state for the current
   * airborne period, one-shot (cleared by the recovery press in tick()),
   * and never turns a normal jump into an air dodge — including the first
   * airborne tick of a hop that follows an unused launch (see the body).
   * The one edge case (a launch that only lifts off after
   * LAUNCH_PENDING_WINDOW_S does not arm recovery) gives no advantage
   * either: an airborne Dodge press with no recovery armed is a no-op with
   * no Stamina cost and no cooldown, so a player who presses C whenever
   * launched gets the same outcome the AI gets from reading this.
   */
  /** isAirRecoveryAvailable() and, when the recovery uses the dodge bar, a dodge ready right now: a press would recover. */
  canAirRecoverNow(): boolean {
    return this.isAirRecoveryAvailable() && (!this.recoveryUsesDodge || this.state === DodgeState.Idle);
  }

  isAirRecoveryAvailable(): boolean {
    // Armed AND already airborne as of the last tick. The armed flag alone
    // survives landing (it is only overwritten inside the next takeoff
    // tick), so on the first airborne tick of a later plain hop it would
    // read true although a press on that tick recovers nothing.
    return this.airRecoveryAvailable && !this.wasGrounded;
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
    if (!grounded && dodgePressed && this.airRecoveryAvailable && (!this.recoveryUsesDodge || this.state === DodgeState.Idle)) {
      this.airRecoveryAvailable = false;
      triggeredAirRecovery = true;
      if (this.recoveryUsesDodge) {
        // It spends the dodge: the dodge bar empties and refills over the normal cooldown.
        this.state = DodgeState.Cooldown;
        this.cooldownTimerS = 0;
      }
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
        if (grounded && dodgePressed && staminaValue >= this.staminaCost) {
          this.state = DodgeState.Dodging;
          this.activeTimerS = 0;
          this.evadedThisDodge.clear();
          staminaCostThisTick = this.staminaCost;
          this.latchedDirection = this.computeDodgeDirection(actions, headingRad);
        }
        break;

      case DodgeState.Dodging:
        this.activeTimerS += fixedDeltaSeconds;
        if (this.activeTimerS >= DODGE_ACTIVE_DURATION_S) {
          this.state = DodgeState.Cooldown;
          this.cooldownTimerS = 0;
          this.latchedDirection = null;
        }
        break;

      case DodgeState.Cooldown:
        this.cooldownTimerS += fixedDeltaSeconds;
        if (this.cooldownTimerS >= this.cooldownS) {
          this.state = DodgeState.Idle;
        }
        break;
    }

    const grantsGroundIFrames = grounded && this.state === DodgeState.Dodging;
    // Fix 1 (movement/weight/dodge playtest pass): for the Dodging state's
    // entire duration — including a tick or two airborne if the dodge
    // carries the Bey off a ledge, since this is one short committed action,
    // not something that should flicker on/off with ground contact — the
    // latched direction and DODGE_BURST_SPEED_MPS fully replace horizontal
    // velocity. Never set outside Dodging (Idle, Cooldown, or the one-shot
    // airborne recovery path above, which only flips triggeredAirRecovery
    // and never touches latchedDirection).
    const dodgeOverride = this.state === DodgeState.Dodging && this.latchedDirection ? { velocityMps: scale(this.latchedDirection, DODGE_BURST_SPEED_MPS * this.distanceScale) } : null;

    return {
      state: this.state,
      lateralGripOverridePerS: grantsGroundIFrames ? DODGE_GRIP_OVERRIDE_PER_S : null,
      dodgeOverride,
      hasIFrames: grantsGroundIFrames,
      isPerfectWindow: grantsGroundIFrames && this.activeTimerS <= DODGE_PERFECT_WINDOW_S,
      triggeredAirRecovery,
      staminaCostThisTick,
    };
  }

  /**
   * True the first time this dodge evades the opponent attack `attackActivationId`, false for every later tick of the
   * same overlap. The hit stays nullified on every tick; only the dodged / perfectDodge events are reported once
   * (owner, 2026-10-02: the Perfect Dodge effect fired once per overlapping tick, ~7 times for one dodge).
   */
  firstEvasionOf(attackActivationId: number): boolean {
    if (this.evadedThisDodge.has(attackActivationId)) return false;
    this.evadedThisDodge.add(attackActivationId);
    return true;
  }

  /** GDD section 22: dodges in the direction currently pressed/selected, relative to the Bey (forward/back/lateral, diagonals normalized) — defaults to forward when no direction is held. Only computes the direction; Fix 1 latches it once and the dodge's own flat speed replaces velocity for the whole Dodging state instead of adding a burst on top of whatever momentum existed at press time (GDD section 15/88 "momentum stays relevant" is now scoped to normal movement only — see DodgeTickResult.dodgeOverride). */
  private computeDodgeDirection(actions: ControllerActions, headingRad: number): Vec2 {
    const forward = fromYaw(headingRad);
    const right = perpendicular(forward);

    if (actions.moveIntent) {
      // Directional control (M11): dodge toward the held world direction.
      return intentMagnitude(actions.moveIntent) > 0 ? normalize(actions.moveIntent) : forward;
    }
    const lateralInput = (actions.held.has(Action.SteerRight) ? 1 : 0) - (actions.held.has(Action.SteerLeft) ? 1 : 0);
    const forwardInput = (actions.held.has(Action.MoveForward) ? 1 : 0) - (actions.held.has(Action.MoveBackward) ? 1 : 0);
    if (lateralInput === 0 && forwardInput === 0) return forward; // no direction held — default to forward.
    return normalize(add(scale(forward, forwardInput), scale(right, lateralInput)));
  }

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). */
  getDeterministicState(): CanonicalRecord {
    return {
      state: this.state,
      activeTimerS: this.activeTimerS,
      cooldownTimerS: this.cooldownTimerS,
      wasGrounded: this.wasGrounded,
      airRecoveryAvailable: this.airRecoveryAvailable,
      launchPending: this.launchPending,
      launchPendingRemainingS: this.launchPendingRemainingS,
      latchedDirection: vec2(this.latchedDirection),
      evadedThisDodge: [...this.evadedThisDodge].sort((a, b) => a - b),
    };
  }
}
