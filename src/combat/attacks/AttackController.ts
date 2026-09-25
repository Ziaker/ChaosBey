// ============================================================
// ATTACK CONTROLLER
// Tap Z (quick press, released before TAP_MAX_HOLD_S) = Circular Attack.
// Hold Z then release = Dash Attack, charged while held (GDD section 23).
// Never writes to the rigid body directly — hands MovementController a
// dashOverride the same way DriftController hands it a grip override, and
// exposes an activeHitbox for the hit-detection module to query.
// ============================================================

import { Action, type ControllerActions } from '../../input/actions/Action';
import { type Vec2 } from '../../physics/Vec2';
import type { MovementPreStepInput } from '../../bey/movement/MovementController';
import {
  CIRCULAR_ACTIVE_DURATION_S,
  CIRCULAR_BASE_KNOCKBACK_FORCE,
  CIRCULAR_HITBOX_RADIUS_M,
  CIRCULAR_RECOVERY_S,
  CIRCULAR_STABILITY_DAMAGE,
  DASH_ACTIVE_DURATION_S,
  DASH_HITBOX_RADIUS_M,
  DASH_LOCK_ON_MAX_TURN_RATE_RAD_S,
  DASH_MAX_CHARGE_S,
  DASH_MAX_KNOCKBACK_FORCE,
  DASH_MAX_SPEED_MPS,
  DASH_MAX_STABILITY_DAMAGE,
  DASH_MIN_CHARGE_S,
  DASH_MIN_KNOCKBACK_FORCE,
  DASH_MIN_SPEED_MPS,
  DASH_MIN_STABILITY_DAMAGE,
  DASH_WHIFF_RECOVERY_S,
  TAP_MAX_HOLD_S,
} from './AttackTuning';

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
}

export interface AttackTickResult {
  state: AttackState;
  activeHitbox: ActiveHitbox | null;
  dashOverride: MovementPreStepInput['dashOverride'];
  isConsumingAttackEnergy: boolean;
  /** 0..1, for debug/HUD — how charged the current (or most recent) Dash Attack is. */
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

/** Eases `current` toward `target` (radians) by at most `maxDeltaRad`, taking the shortest way around. */
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

  getState(): AttackState {
    return this.state;
  }

  /** Current Dash charge fraction without advancing anything — for read-only consumers (e.g. a frozen post-round snapshot). */
  getChargeFraction(): number {
    return this.dashChargeFraction();
  }

  tick(
    actions: ControllerActions,
    ownHeadingRad: number,
    ownPositionXZ: Vec2,
    opponentPositionXZ: Vec2,
    attackEnergyFraction: number,
    fixedDeltaSeconds: number,
  ): AttackTickResult {
    const attackHeld = actions.held.has(Action.Attack);
    let dashOverride: MovementPreStepInput['dashOverride'] = null;
    let isConsumingAttackEnergy = false;

    switch (this.state) {
      case AttackState.Neutral:
        if (actions.pressedThisFrame.has(Action.Attack)) {
          this.state = AttackState.Buffering;
          this.bufferTimerS = 0;
        }
        break;

      case AttackState.Buffering:
        this.bufferTimerS += fixedDeltaSeconds;
        if (!attackHeld) {
          this.state = AttackState.CircularActive;
          this.activeTimerS = 0;
        } else if (this.bufferTimerS >= TAP_MAX_HOLD_S) {
          this.state = AttackState.ChargingDash;
          this.chargeTimerS = this.bufferTimerS;
        }
        break;

      case AttackState.ChargingDash:
        isConsumingAttackEnergy = true;
        if (attackEnergyFraction > 0) {
          this.chargeTimerS = Math.min(DASH_MAX_CHARGE_S, this.chargeTimerS + fixedDeltaSeconds);
        }
        if (!attackHeld || attackEnergyFraction <= 0) {
          this.state = AttackState.DashActive;
          this.activeTimerS = 0;
        }
        break;

      case AttackState.DashActive: {
        this.activeTimerS += fixedDeltaSeconds;
        const speed = lerp(DASH_MIN_SPEED_MPS, DASH_MAX_SPEED_MPS, this.dashChargeFraction());
        const desiredHeading = headingRadToward(ownPositionXZ, opponentPositionXZ);
        const guidedHeading = turnTowardRad(ownHeadingRad, desiredHeading, DASH_LOCK_ON_MAX_TURN_RATE_RAD_S * fixedDeltaSeconds);
        dashOverride = { headingRad: guidedHeading, longitudinalSpeedMps: speed };
        if (this.activeTimerS >= DASH_ACTIVE_DURATION_S) {
          this.state = AttackState.DashRecovery;
          this.recoveryTimerS = 0;
        }
        break;
      }

      case AttackState.DashRecovery:
        this.recoveryTimerS += fixedDeltaSeconds;
        if (this.recoveryTimerS >= DASH_WHIFF_RECOVERY_S) this.state = AttackState.Neutral;
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
        if (this.recoveryTimerS >= CIRCULAR_RECOVERY_S) this.state = AttackState.Neutral;
        break;
    }

    return {
      state: this.state,
      activeHitbox: this.computeActiveHitbox(),
      dashOverride,
      isConsumingAttackEnergy,
      chargeFraction: this.dashChargeFraction(),
    };
  }

  /** Called by the hit-detection module the tick this attack lands on the opponent — ends the active window promptly instead of lingering/whiff-recovering. */
  registerHitConfirmed(): void {
    if (this.state === AttackState.DashActive) {
      this.state = AttackState.Neutral;
    } else if (this.state === AttackState.CircularActive) {
      this.state = AttackState.CircularRecovery;
      this.recoveryTimerS = 0;
    }
  }

  private dashChargeFraction(): number {
    return clamp01((this.chargeTimerS - DASH_MIN_CHARGE_S) / (DASH_MAX_CHARGE_S - DASH_MIN_CHARGE_S));
  }

  private computeActiveHitbox(): ActiveHitbox | null {
    if (this.state === AttackState.CircularActive) {
      return {
        kind: 'circular',
        radiusM: CIRCULAR_HITBOX_RADIUS_M,
        knockbackForce: CIRCULAR_BASE_KNOCKBACK_FORCE,
        stabilityDamage: CIRCULAR_STABILITY_DAMAGE,
      };
    }
    if (this.state === AttackState.DashActive) {
      const t = this.dashChargeFraction();
      return {
        kind: 'dash',
        radiusM: DASH_HITBOX_RADIUS_M,
        knockbackForce: lerp(DASH_MIN_KNOCKBACK_FORCE, DASH_MAX_KNOCKBACK_FORCE, t),
        stabilityDamage: lerp(DASH_MIN_STABILITY_DAMAGE, DASH_MAX_STABILITY_DAMAGE, t),
      };
    }
    return null;
  }
}
