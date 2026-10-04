// ============================================================
// ATTACK CONTROLLER
// Tap Z (quick press, released before TAP_MAX_HOLD_S) = Circular Attack.
// Hold Z then release = Dash Attack, charged while held (GDD section 23).
// Owner, 2026-10-02: a Dash cooldown (not Attack Energy) spaces Dashes out;
// a hold while it runs waits, then starts charging once the Dash is ready.
// Never writes to the rigid body directly — hands MovementController a
// dashOverride the same way DriftController hands it a grip override, and
// exposes an activeHitbox for the hit-detection module to query.
// ============================================================

import { Action, type ControllerActions } from '../../input/actions/Action';
import { type Vec2 } from '../../physics/Vec2';
import type { MovementPreStepInput } from '../../bey/movement/MovementController';
import { DEFAULT_ATTACK_PROFILE, type BeyAttackProfile } from '../../bey/archetype/BeyAttackProfile';
import {
  CIRCULAR_ACTIVE_DURATION_S,
  CIRCULAR_BASE_KNOCKBACK_FORCE,
  CIRCULAR_RECOVERY_S,
  CIRCULAR_STABILITY_DAMAGE,
  DASH_ACTIVE_DURATION_S,
  DASH_COOLDOWN_DEFAULT_S,
  DASH_LOCK_ON_MAX_TURN_RATE_RAD_S,
  DASH_MAX_CHARGE_S,
  DASH_MAX_KNOCKBACK_FORCE,
  DASH_MAX_STABILITY_DAMAGE,
  DASH_MIN_CHARGE_S,
  DASH_MIN_KNOCKBACK_FORCE,
  DASH_MIN_STABILITY_DAMAGE,
  DASH_WHIFF_RECOVERY_S,
  TAP_MAX_HOLD_S,
} from './AttackTuning';
import type { CanonicalRecord } from '../../replay/state/CanonicalValue';

export enum AttackState {
  Neutral = 'Neutral',
  Buffering = 'Buffering',
  ChargingDash = 'ChargingDash',
  DashActive = 'DashActive',
  DashRecovery = 'DashRecovery',
  CircularActive = 'CircularActive',
  CircularRecovery = 'CircularRecovery',
}

export interface ActiveHitbox {
  kind: 'circular' | 'dash';
  radiusM: number;
  knockbackForce: number;
  stabilityDamage: number;
  /** Item 11: speed this hit's base damage was tuned for. Absent = attacker's ordinary top speed. */
  referenceSpeedMps?: number;
}

export interface AttackTickResult {
  state: AttackState;
  activeHitbox: ActiveHitbox | null;
  dashOverride: MovementPreStepInput['dashOverride'];
  chargeFraction: number;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t);
}

function headingRadToward(from: Vec2, to: Vec2): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function turnTowardRad(current: number, target: number, maxDeltaRad: number): number {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  const clampedDiff = Math.max(-maxDeltaRad, Math.min(maxDeltaRad, diff));
  return current + clampedDiff;
}

export class AttackController {
  private state = AttackState.Neutral;
  private bufferTimerS = 0;
  private chargeTimerS = 0;
  private activeTimerS = 0;
  private recoveryTimerS = 0;
  private activationCount = 0;
  private dashCooldownRemainingS = 0;
  private waitingForDash = false;
  /** B1: Attack press made during a recovery, retained while it stays held. */
  private heldSinceRecoveryPressS: number | null = null;
  /** Item 11: horizontal speed when the current Dash fired. */
  private dashEntrySpeedMps = 0;

  constructor(
    private readonly profile: BeyAttackProfile = DEFAULT_ATTACK_PROFILE,
    private readonly dashCooldownS: number = DASH_COOLDOWN_DEFAULT_S,
    /** If true, a Dash never runs slower than the speed already built before release. */
    private readonly dashCarriesSpeed: boolean = false,
  ) {}

  getState(): AttackState {
    return this.state;
  }

  getActivationId(): number {
    return this.activationCount;
  }

  debugResetDashCooldown(): void {
    this.dashCooldownRemainingS = 0;
  }

  getDashCooldownRemainingS(): number {
    return this.dashCooldownRemainingS;
  }

  getDashReadiness(): number {
    if (this.state === AttackState.DashActive) return 0;
    const blockedS = this.attackBlockedRemainingS();
    const remainingS = Math.max(this.dashCooldownRemainingS, blockedS.remainingS);
    const totalS = Math.max(this.dashCooldownS, blockedS.totalS);
    if (totalS <= 0) return 1;
    return clamp01(1 - remainingS / totalS);
  }

  private attackBlockedRemainingS(): { remainingS: number; totalS: number } {
    switch (this.state) {
      case AttackState.DashRecovery:
        return { remainingS: Math.max(0, DASH_WHIFF_RECOVERY_S - this.recoveryTimerS), totalS: DASH_WHIFF_RECOVERY_S };
      case AttackState.CircularActive:
        return { remainingS: Math.max(0, CIRCULAR_ACTIVE_DURATION_S - this.activeTimerS) + CIRCULAR_RECOVERY_S, totalS: CIRCULAR_ACTIVE_DURATION_S + CIRCULAR_RECOVERY_S };
      case AttackState.CircularRecovery:
        return { remainingS: Math.max(0, CIRCULAR_RECOVERY_S - this.recoveryTimerS), totalS: CIRCULAR_ACTIVE_DURATION_S + CIRCULAR_RECOVERY_S };
      default:
        return { remainingS: 0, totalS: 0 };
    }
  }

  getChargeFraction(): number {
    return this.dashChargeFraction();
  }

  getDebugState(): { bufferTimerS: number; chargeTimerS: number; activeTimerS: number; recoveryTimerS: number; activeHitbox: ActiveHitbox | null } {
    return {
      bufferTimerS: this.bufferTimerS,
      chargeTimerS: this.chargeTimerS,
      activeTimerS: this.activeTimerS,
      recoveryTimerS: this.recoveryTimerS,
      activeHitbox: this.computeActiveHitbox(),
    };
  }

  tick(
    actions: ControllerActions,
    ownHeadingRad: number,
    ownPositionXZ: Vec2,
    opponentPositionXZ: Vec2,
    fixedDeltaSeconds: number,
    /** Horizontal speed at this tick; sampled when a Dash actually fires. */
    ownSpeedMps = 0,
  ): AttackTickResult {
    const attackHeld = actions.held.has(Action.Attack);
    let dashOverride: MovementPreStepInput['dashOverride'] = null;
    const inRecovery = this.state === AttackState.DashActive || this.state === AttackState.DashRecovery || this.state === AttackState.CircularRecovery || this.state === AttackState.CircularActive;
    if (!attackHeld) this.heldSinceRecoveryPressS = null;
    else if (inRecovery && actions.pressedThisFrame.has(Action.Attack)) this.heldSinceRecoveryPressS = 0;
    else if (this.heldSinceRecoveryPressS !== null) this.heldSinceRecoveryPressS += fixedDeltaSeconds;
    if (this.state !== AttackState.DashActive) this.dashCooldownRemainingS = Math.max(0, this.dashCooldownRemainingS - fixedDeltaSeconds);

    switch (this.state) {
      case AttackState.Neutral:
        if (actions.pressedThisFrame.has(Action.Attack)) {
          this.state = AttackState.Buffering;
          this.bufferTimerS = 0;
          this.heldSinceRecoveryPressS = null;
        } else if (this.heldSinceRecoveryPressS !== null) {
          this.endRecovery(attackHeld);
        }
        break;

      case AttackState.Buffering:
        this.bufferTimerS += fixedDeltaSeconds;
        this.stepBuffering(attackHeld);
        break;

      case AttackState.ChargingDash:
        this.chargeTimerS = Math.min(DASH_MAX_CHARGE_S, this.chargeTimerS + fixedDeltaSeconds);
        if (!attackHeld) {
          this.state = AttackState.DashActive;
          this.activeTimerS = 0;
          this.activationCount++;
          this.dashEntrySpeedMps = this.dashCarriesSpeed ? Math.max(0, ownSpeedMps) : 0;
        }
        break;

      case AttackState.DashActive: {
        this.activeTimerS += fixedDeltaSeconds;
        const speed = Math.max(this.nominalDashSpeedMps(), this.dashEntrySpeedMps);
        const desiredHeading = headingRadToward(ownPositionXZ, opponentPositionXZ);
        const guidedHeading = turnTowardRad(ownHeadingRad, desiredHeading, DASH_LOCK_ON_MAX_TURN_RATE_RAD_S * fixedDeltaSeconds);
        dashOverride = { headingRad: guidedHeading, longitudinalSpeedMps: speed };
        if (this.activeTimerS >= DASH_ACTIVE_DURATION_S) {
          this.state = AttackState.DashRecovery;
          this.recoveryTimerS = 0;
          this.dashCooldownRemainingS = this.dashCooldownS;
        }
        break;
      }

      case AttackState.DashRecovery:
        this.recoveryTimerS += fixedDeltaSeconds;
        if (this.recoveryTimerS >= DASH_WHIFF_RECOVERY_S) this.endRecovery(attackHeld);
        break;

      case AttackState.CircularActive:
        this.activeTimerS += fixedDeltaSeconds;
        if (this.activeTimerS >= CIRCULAR_ACTIVE_DURATION_S) {
          this.state = AttackState.CircularRecovery;
          this.recoveryTimerS = 0;
        }
        break;

      case AttackState.CircularRecovery:
        this.recoveryTimerS += fixedDeltaSeconds;
        if (this.recoveryTimerS >= CIRCULAR_RECOVERY_S) this.endRecovery(attackHeld);
        break;
    }

    return {
      state: this.state,
      activeHitbox: this.computeActiveHitbox(),
      dashOverride,
      chargeFraction: this.dashChargeFraction(),
    };
  }

  private stepBuffering(attackHeld: boolean): void {
    if (!attackHeld) {
      if (this.waitingForDash) {
        this.state = AttackState.Neutral;
        this.waitingForDash = false;
      } else {
        this.state = AttackState.CircularActive;
        this.activeTimerS = 0;
        this.activationCount++;
      }
    } else if (this.bufferTimerS >= TAP_MAX_HOLD_S) {
      if (this.dashCooldownRemainingS > 0) {
        this.waitingForDash = true;
      } else {
        this.state = AttackState.ChargingDash;
        this.chargeTimerS = this.waitingForDash ? TAP_MAX_HOLD_S : this.bufferTimerS;
        this.waitingForDash = false;
      }
    }
  }

  private endRecovery(attackHeld: boolean): void {
    this.state = AttackState.Neutral;
    if (this.heldSinceRecoveryPressS === null || !attackHeld) return;
    this.state = AttackState.Buffering;
    this.bufferTimerS = this.heldSinceRecoveryPressS;
    this.waitingForDash = this.heldSinceRecoveryPressS >= TAP_MAX_HOLD_S;
    this.heldSinceRecoveryPressS = null;
    if (this.waitingForDash) this.stepBuffering(true);
  }

  registerHitConfirmed(): void {
    if (this.state === AttackState.DashActive) {
      this.state = AttackState.Neutral;
      this.dashCooldownRemainingS = this.dashCooldownS;
    } else if (this.state === AttackState.CircularActive) {
      this.state = AttackState.CircularRecovery;
      this.recoveryTimerS = 0;
    }
  }

  private nominalDashSpeedMps(): number {
    return lerp(this.profile.dashMinSpeedMps, this.profile.dashMaxSpeedMps, this.dashChargeFraction());
  }

  private dashChargeFraction(): number {
    return clamp01((this.chargeTimerS - DASH_MIN_CHARGE_S) / (DASH_MAX_CHARGE_S - DASH_MIN_CHARGE_S));
  }

  private computeActiveHitbox(): ActiveHitbox | null {
    if (this.state === AttackState.CircularActive) {
      return {
        kind: 'circular',
        radiusM: this.profile.circularHitboxRadiusM,
        knockbackForce: CIRCULAR_BASE_KNOCKBACK_FORCE,
        stabilityDamage: CIRCULAR_STABILITY_DAMAGE,
      };
    }
    if (this.state === AttackState.DashActive) {
      const t = this.dashChargeFraction();
      return {
        kind: 'dash',
        radiusM: this.profile.dashHitboxRadiusM,
        knockbackForce: lerp(DASH_MIN_KNOCKBACK_FORCE, DASH_MAX_KNOCKBACK_FORCE, t),
        stabilityDamage: lerp(DASH_MIN_STABILITY_DAMAGE, DASH_MAX_STABILITY_DAMAGE, t),
        referenceSpeedMps: this.nominalDashSpeedMps(),
      };
    }
    return null;
  }

  getDeterministicState(): CanonicalRecord {
    return {
      state: this.state,
      bufferTimerS: this.bufferTimerS,
      chargeTimerS: this.chargeTimerS,
      activeTimerS: this.activeTimerS,
      recoveryTimerS: this.recoveryTimerS,
      activationCount: this.activationCount,
      dashCooldownRemainingS: this.dashCooldownRemainingS,
      waitingForDash: this.waitingForDash,
      heldSinceRecoveryPressS: this.heldSinceRecoveryPressS,
      dashEntrySpeedMps: this.dashEntrySpeedMps,
    };
  }
}
