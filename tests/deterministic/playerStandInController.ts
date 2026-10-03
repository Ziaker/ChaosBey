// ============================================================
// PLAYER STAND-IN CONTROLLER (TEST-ONLY, M7 ALPHA-READINESS HARDENING)
// A deliberately simple, fixed-behavior CombatController: no personality,
// no scoring, no adaptation, no deliberate errors — just "walk toward the
// opponent, swing when in range, dodge an incoming Dash, recover in the
// air". Stands in for a competent-but-plain human player so AI-vs-AI
// comparisons (aiMatchRunner.ts, aiArchetypeMatrix.test.ts) can be
// complemented with "does each archetype still look/behave distinctly
// against a NON-adaptive, identical opponent" — this repo has no human
// playtester available in a headless environment.
//
// Not part of src/ai or production: this never ships, it only drives the
// same CombatController interface a keyboard/AI controller uses (GDD
// section 113) for this test suite.
// ============================================================

import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState, type ClashController } from '../../src/combat/clash/ClashController';
import { DODGE_STAMINA_COST } from '../../src/dodge/DodgeTuning';
import { DodgeState } from '../../src/dodge/DodgeController';
import { Action, type CombatController, type ControllerActions, type ControllerContext } from '../../src/input/actions/Action';
import { fromYaw, scale, signedAngleBetween, subtract, length, type Vec2 } from '../../src/physics/Vec2';
import { isGrounded } from '../../src/physics/collision/GroundCheck';
import type { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';
import type { Bey } from '../../src/bey/core/Bey';
import { AI_CIRCULAR_ATTACK_RANGE_M, AI_DASH_ATTACK_MAX_RANGE_M } from '../../src/ai/decision/AiCombatRanges';
import { ActionSelector } from '../../src/ai/decision/ActionSelection';
import type { SeededRng } from '../../src/rng/SeededRng';

/** Same deadzone/turn-before-throttle thresholds ActionSelection.ts uses — a plain player steers the same way. */
const STEERING_DEADZONE_RAD = 0.05;
const THROTTLE_MAX_HEADING_ERROR_RAD = 1.75;
/** A Dash is only released once heading is within this of the opponent (mirrors ActionSelection's DASH_RELEASE_MAX_HEADING_ERROR_RAD). */
const DASH_RELEASE_MAX_HEADING_ERROR_RAD = 0.5;
/** Fixed commit point for a player-driven Dash charge — not archetype-biased like AiPersonality.aggression. */
const PLAYER_DASH_TARGET_CHARGE_FRACTION = 0.6;
/** Chance (rolled once per opponent Dash, not per tick) that this stand-in actually reacts to it with a Dodge — an imperfect-but-decent human reaction, not a scripted certainty. */
const PLAYER_DODGE_REACT_CHANCE = 0.6;
/** Distance (m) inside which an incoming Dash is worth reacting to at all. */
const PLAYER_DODGE_REACT_RANGE_M = AI_DASH_ATTACK_MAX_RANGE_M;
/** Clash mash rate (presses/second) — a plain, average mash speed (AiPersonality mash rates vary per archetype; this is a fixed human-plausible middle). */
const PLAYER_CLASH_MASH_RATE_PER_SECOND = 4;

interface RawState {
  positionXZ: Vec2;
  headingRad: number;
  grounded: boolean;
  attackState: AttackState;
  dashChargeFraction: number;
  dodgeState: DodgeState;
  staminaFraction: number;
  dashReadiness: number;
  momentum: number;
  airRecoveryAvailable: boolean;
  canAffordDodge: boolean;
}

function extractRawState(physics: PhysicsWorld, bey: Bey): RawState {
  const translation = bey.body.translation();
  return {
    positionXZ: { x: translation.x, z: translation.z },
    headingRad: bey.movement.getHeadingRad(),
    grounded: isGrounded(physics, bey.collider),
    attackState: bey.attack.getState(),
    dashChargeFraction: bey.attack.getChargeFraction(),
    dodgeState: bey.dodge.getState(),
    staminaFraction: bey.stamina.resource.fraction,
    dashReadiness: bey.attack.getDashReadiness(),
    momentum: bey.momentum.value,
    airRecoveryAvailable: bey.dodge.isAirRecoveryAvailable(),
    canAffordDodge: bey.stamina.resource.value >= DODGE_STAMINA_COST,
  };
}

const OPPONENT_DASH_STATES: ReadonlySet<AttackState> = new Set([AttackState.ChargingDash, AttackState.DashActive]);
const OWN_CHARGE_STATES: ReadonlySet<AttackState> = new Set([AttackState.Neutral, AttackState.Buffering, AttackState.ChargingDash]);

export class PlayerStandInController implements CombatController {
  private readonly actionSelector = new ActionSelector();
  /** Rolled once per opponent Dash event, same "don't re-roll every tick" reasoning AIController uses for counterRollForOpponentDash/dodgeAttemptSucceeds. */
  private dodgeRollForOpponentDash: boolean | null = null;

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly ownBey: Bey,
    private readonly opponentBey: Bey,
    private readonly clashController: ClashController,
    private readonly rng: SeededRng,
  ) {}

  sampleActions(context: ControllerContext): ControllerActions {
    if (context.simulationFrozen) return this.actionSelector.repeatFrozenActions(context.fixedDeltaSeconds);
    if (this.clashController.getState() === ClashState.Active) return this.sampleClashMashActions(context.fixedDeltaSeconds);

    const own = extractRawState(this.physics, this.ownBey);
    const opponent = extractRawState(this.physics, this.opponentBey);

    if (OPPONENT_DASH_STATES.has(opponent.attackState)) {
      if (this.dodgeRollForOpponentDash === null) this.dodgeRollForOpponentDash = this.rng.nextBool(PLAYER_DODGE_REACT_CHANCE);
    } else {
      this.dodgeRollForOpponentDash = null;
    }

    const toOpponent = subtract(opponent.positionXZ, own.positionXZ);
    const distance = length(toOpponent);
    const direction = distance > 1e-6 ? scale(toOpponent, 1 / distance) : fromYaw(own.headingRad);
    const forward = fromYaw(own.headingRad);
    const headingErrorRad = signedAngleBetween(forward, direction);

    const held = new Set<Action>();

    // Air recovery: one fresh Dodge press while the window is open — same rule ActionSelection.ts's AirRecover branch follows.
    const launched = !own.grounded && own.airRecoveryAvailable;
    if (launched) {
      held.add(Action.Dodge);
    } else {
      // Dodge an incoming Dash, once per event, if it actually fires. Never
      // while mid-charge on an own Dash: AttackController fires the Dash
      // the instant Attack is no longer held (whatever the charge reached),
      // so ducking into a dodge here would release a near-empty-charge Dash
      // as a side effect — a commitment a real player's held button
      // wouldn't drop either.
      const dodging =
        own.attackState !== AttackState.ChargingDash &&
        this.dodgeRollForOpponentDash === true &&
        distance <= PLAYER_DODGE_REACT_RANGE_M &&
        own.dodgeState === DodgeState.Idle &&
        own.grounded &&
        own.canAffordDodge;
      if (dodging) {
        held.add(Action.Dodge);
        // Burst straight away from the opponent — a plain "get out of the line" reaction, not an aimed evasion.
        const awayForward = signedAngleBetween(forward, scale(direction, -1));
        if (Math.abs(awayForward) <= STEERING_DEADZONE_RAD) held.add(Action.MoveBackward);
      } else {
        // Walk toward the opponent (turn first if badly off-line).
        if (headingErrorRad > STEERING_DEADZONE_RAD) held.add(Action.SteerRight);
        else if (headingErrorRad < -STEERING_DEADZONE_RAD) held.add(Action.SteerLeft);
        if (Math.abs(headingErrorRad) <= THROTTLE_MAX_HEADING_ERROR_RAD) held.add(Action.MoveForward);

        const aligned = Math.abs(headingErrorRad) <= DASH_RELEASE_MAX_HEADING_ERROR_RAD;
        if (distance <= AI_CIRCULAR_ATTACK_RANGE_M && own.attackState === AttackState.Neutral) {
          held.add(Action.Attack);
        } else if (
          distance <= AI_DASH_ATTACK_MAX_RANGE_M &&
          OWN_CHARGE_STATES.has(own.attackState) &&
          (own.dashReadiness >= 1 || own.attackState === AttackState.ChargingDash) &&
          // Off-line, keep charging only until full (as the AI does): with no Attack Energy to run out (owner, 2026-10-02)
          // a full charge would otherwise be held forever.
          (own.dashChargeFraction < PLAYER_DASH_TARGET_CHARGE_FRACTION || (!aligned && own.dashChargeFraction < 1))
        ) {
          held.add(Action.Attack);
        }
      }
    }

    return this.actionSelector.commit(held, context.fixedDeltaSeconds);
  }

  private sampleClashMashActions(fixedDeltaSeconds: number): ControllerActions {
    const probability = Math.max(0, Math.min(1, PLAYER_CLASH_MASH_RATE_PER_SECOND * fixedDeltaSeconds));
    const held = new Set<Action>();
    if (this.rng.nextBool(probability)) {
      const options = [Action.Attack, Action.JumpDrift, Action.Dodge];
      held.add(options[this.rng.nextInt(0, options.length - 1)] ?? Action.Attack);
    }
    return this.actionSelector.commit(held, fixedDeltaSeconds);
  }
}
