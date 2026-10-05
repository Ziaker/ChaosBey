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
  /** Item 11 (owner, 2026-10-04): the speed this hit's damage is tuned for (a Dash's speed for its charge); absent = the attacker's top speed. */
  referenceSpeedMps?: number;
}

export interface AttackTickResult {
  state: AttackState;
  activeHitbox: ActiveHitbox | null;
  dashOverride: MovementPreStepInput['dashOverride'];
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
/** Owner, 2026-10-04: how far ahead (s) the Dash aims at a moving opponent. PROVISIONAL. */
const DASH_LEAD_MAX_S = 0.4;

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
  /** Counts every attack that became active (Circular or Dash): one id per swing, for "once per attack" bookkeeping. */
  private activationCount = 0;
  /** Seconds until the next Dash may start charging (owner, 2026-10-02); 0 = ready. */
  private dashCooldownRemainingS = 0;
  /** Attack held past the tap window while the Dash was cooling down: it charges once ready; a release is not a tap. */
  private waitingForDash = false;
  /**
   * Audit fix B1 (owner, 2026-10-03): seconds Attack has been held since a press made during a recovery (Dash or
   * Circular), or null. That press used to be dropped: Attack was still held when the recovery ended, but with no new
   * press nothing started. Now the held press carries on into the Dash rule — it waits, then charges as soon as a
   * Dash is allowed.
   */
  private heldSinceRecoveryPressS: number | null = null;
  /** Item 11: the Bey's speed when the current Dash fired (0 unless dashCarriesSpeed). */
  private dashEntrySpeedMps = 0;
  /** Owner, 2026-10-04: seconds during which a tap can't start the Circular (after taking a hit / while knocked back). */
  private circularLockS = 0;
  /** The current Dash's own line (null outside a Dash). */
  private dashHeadingRad: number | null = null;

  constructor(
    private readonly profile: BeyAttackProfile = DEFAULT_ATTACK_PROFILE,
    /** MatchConfig.dashCooldownS. */
    private readonly dashCooldownS: number = DASH_COOLDOWN_DEFAULT_S,
    /** MatchConfig.dashCarriesSpeed (item 11): a Dash never runs slower than the Bey was going when it fired. */
    private readonly dashCarriesSpeed: boolean = false,
    /** MatchConfig.topSpeedScale (owner, 2026-10-04): the Dash speeds up with the Beys, so it is never slower than running. */
    private readonly dashSpeedScale: number = 1,
  ) {}

  getState(): AttackState {
    return this.state;
  }

  /** Id of the current (or last) active attack: changes each time a Circular or Dash becomes active. */
  getActivationId(): number {
    return this.activationCount;
  }

  /** A Clash ended the attack (owner, 2026-10-04): back to Neutral, nothing buffered, held or charging carries on. */
  interruptByClash(): void {
    this.state = AttackState.Neutral;
    this.bufferTimerS = 0;
    this.chargeTimerS = 0;
    this.activeTimerS = 0;
    this.recoveryTimerS = 0;
    this.waitingForDash = false;
    this.heldSinceRecoveryPressS = null;
    this.dashHeadingRad = null;
  }

  /** Debug Lab "reset cooldowns" only: the Dash is ready at once. */
  debugResetDashCooldown(): void {
    this.dashCooldownRemainingS = 0;
  }

  /**
   * Owner, 2026-10-04 ("os beys tão podendo realizar [o giratório] APÓS levarem dano, isso tá inaceitavelmente errado,
   * é pra ser um golpe defensivo que NÃO DEVE ser possível de ser realizado ao levar dano"): no Circular for `seconds`.
   */
  /** Seconds the Circular is still blocked (after a hit, a knockback or a Clash). */
  getCircularLockS(): number {
    return this.circularLockS;
  }

  blockCircularFor(seconds: number): void {
    this.circularLockS = Math.max(this.circularLockS, seconds);
  }

  /** Seconds until the next Dash is ready (0 = ready). */
  getDashCooldownRemainingS(): number {
    return this.dashCooldownRemainingS;
  }

  /**
   * 0..1 for the HUD's Dash line: 0 while a Dash is active, refilling during the cooldown, 1 = ready (also while
   * charging, which the DASH charge line shows).
   */
  getDashReadiness(): number {
    if (this.state === AttackState.DashActive) return 0;
    // Audit fix B2 (owner, 2026-10-03): 1 only when a new Dash can really start. A recovery (or an active Circular)
    // blocks it too — with the 0.5 s minimum cooldown the line used to read full during the 0.6 s whiff recovery.
    const blockedS = this.attackBlockedRemainingS();
    const remainingS = Math.max(this.dashCooldownRemainingS, blockedS.remainingS);
    const totalS = Math.max(this.dashCooldownS, blockedS.totalS);
    if (totalS <= 0) return 1;
    return clamp01(1 - remainingS / totalS);
  }

  /** How long the current attack state still blocks a new Dash from starting, and that block's full length. */
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

  /** Current Dash charge fraction without advancing anything — for read-only consumers (e.g. a frozen post-round snapshot). */
  getChargeFraction(): number {
    return this.dashChargeFraction();
  }

  /** Read-only phase timers and the hitbox that would be live this tick, for Debug Lab inspection/visualization (GDD sections 69/71). No gameplay code may branch on this. */
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
    /** The Bey's horizontal speed this tick (m/s), for dashCarriesSpeed. */
    ownSpeedMps = 0,
    /** The opponent's horizontal velocity, to aim the Dash where the opponent is going (owner, 2026-10-04). */
    opponentVelocityXZ: Vec2 = { x: 0, z: 0 },
  ): AttackTickResult {
    const attackHeld = actions.held.has(Action.Attack);
    this.circularLockS = Math.max(0, this.circularLockS - fixedDeltaSeconds);
    let dashOverride: MovementPreStepInput['dashOverride'] = null;
    // B1: a press during a recovery is kept while it stays held.
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
          // A Dash that landed goes straight to Neutral (registerHitConfirmed): a press made during it is still kept.
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
          // Owner, 2026-10-04 ("às vezes ele vai pra direção oposta depois que bate numa parede"): the Dash locks onto
          // the opponent the instant it fires, whatever way a wall bounce left the Bey facing.
          this.dashHeadingRad = headingRadToward(ownPositionXZ, this.leadTarget(ownPositionXZ, opponentPositionXZ, opponentVelocityXZ));
        }
        break;

      case AttackState.DashActive: {
        this.activeTimerS += fixedDeltaSeconds;
        // Item 11: the speed built up before the Dash (momentum) is kept, never thrown away.
        const speed = Math.max(this.nominalDashSpeedMps(), this.dashEntrySpeedMps);
        // Tracks from the Dash's own line (not the Bey's heading, which an impact can whirl), toward where the
        // opponent is going.
        const desiredHeading = headingRadToward(ownPositionXZ, this.leadTarget(ownPositionXZ, opponentPositionXZ, opponentVelocityXZ));
        this.dashHeadingRad = turnTowardRad(this.dashHeadingRad ?? ownHeadingRad, desiredHeading, DASH_LOCK_ON_MAX_TURN_RATE_RAD_S * fixedDeltaSeconds);
        dashOverride = { headingRad: this.dashHeadingRad, longitudinalSpeedMps: speed };
        if (this.activeTimerS >= DASH_ACTIVE_DURATION_S) {
          this.state = AttackState.DashRecovery;
          this.dashHeadingRad = null;
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

  /** The Buffering rule: a release inside the tap window is a Circular; a hold past it charges a Dash once one is ready. */
  private stepBuffering(attackHeld: boolean): void {
    if (!attackHeld) {
      if (this.waitingForDash) {
        // A hold that waited for the Dash cooldown, released before it ran out: no Dash, and not a tap either.
        this.state = AttackState.Neutral;
        this.waitingForDash = false;
      } else if (this.circularLockS > 0) {
        // Owner, 2026-10-04: the Circular is a defensive move that can't be thrown while taking a hit.
        this.state = AttackState.Neutral;
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
        // A hold that waited starts its charge where a fresh hold would (the tap window), not with the wait.
        this.chargeTimerS = this.waitingForDash ? TAP_MAX_HOLD_S : this.bufferTimerS;
        this.waitingForDash = false;
      }
    }
  }

  /**
   * A recovery ends. B1: an Attack press made during it and still held carries on as if it had been pressed now with
   * that much hold behind it — past the tap window it is a held Dash press, which (same tick) charges if the cooldown
   * is over or waits for it.
   */
  private endRecovery(attackHeld: boolean): void {
    this.state = AttackState.Neutral;
    if (this.heldSinceRecoveryPressS === null || !attackHeld) return;
    this.state = AttackState.Buffering;
    this.bufferTimerS = this.heldSinceRecoveryPressS;
    this.waitingForDash = this.heldSinceRecoveryPressS >= TAP_MAX_HOLD_S;
    this.heldSinceRecoveryPressS = null;
    if (this.waitingForDash) this.stepBuffering(true);
  }

  /** Called by the hit-detection module the tick this attack lands on the opponent — ends the active window promptly instead of lingering/whiff-recovering. */
  registerHitConfirmed(): void {
    if (this.state === AttackState.DashActive) {
      this.dashHeadingRad = null;
      this.state = AttackState.Neutral;
      this.dashCooldownRemainingS = this.dashCooldownS;
    } else if (this.state === AttackState.CircularActive) {
      this.state = AttackState.CircularRecovery;
      this.recoveryTimerS = 0;
    }
  }

  /** Where the opponent will be when the Dash gets there (its velocity × the time to cover the gap, at most 0.4 s). */
  private leadTarget(own: Vec2, opponent: Vec2, opponentVelocity: Vec2): Vec2 {
    const gap = Math.hypot(opponent.x - own.x, opponent.z - own.z);
    const t = Math.min(DASH_LEAD_MAX_S, gap / Math.max(1, this.nominalDashSpeedMps()));
    return { x: opponent.x + opponentVelocity.x * t, z: opponent.z + opponentVelocity.z * t };
  }

  private nominalDashSpeedMps(): number {
    return lerp(this.profile.dashMinSpeedMps, this.profile.dashMaxSpeedMps, this.dashChargeFraction()) * this.dashSpeedScale;
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

  /** Read-only: this system's part of CanonicalMatchStateV1 (M9 state hash). */
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
      dashHeadingRad: this.dashHeadingRad,
      circularLockS: this.circularLockS,
    };
  }
}
