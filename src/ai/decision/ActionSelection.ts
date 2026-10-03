// ============================================================
// AI ACTION SELECTION (MILESTONE 7)
// GDD section 62: layer 6 — turns the current AiIntent into real
// ControllerActions through the exact same held/pressedThisFrame/hold-
// duration contract KeyboardController and ScriptedController produce
// (GDD section 113). The AI never touches a RigidBody, never sets a
// dashOverride itself, never bypasses a cooldown — it only presses the
// same buttons a player could (owner rule: the AI must obey the same
// rules as a player).
//
// Stateful (unlike IntentSelection/RiskEvaluation) because
// held/pressedThisFrame/hold-duration bookkeeping is inherently a
// tick-to-tick diff — same pattern ScriptedController.ts already
// established. Attack/JumpDrift taps are deliberately NOT tracked with
// their own internal timer: they read the real AttackController/
// DriftController state (via WorldState) and stop holding the moment that
// system's own state machine has moved past Neutral/Idle, so a "tap" is
// naturally exactly one tick regardless of fixedDeltaSeconds — no
// duplicated timing logic to drift out of sync with the real system.
// ============================================================

import { AttackState } from '../../combat/attacks/AttackController';
import { DodgeState } from '../../dodge/DodgeController';
import { DriftState } from '../../drift/DriftController';
import { Action, type ControllerActions } from '../../input/actions/Action';
import { add, dot, fromYaw, length, normalize, perpendicular, scale, signedAngleBetween, subtract, type Vec2 } from '../../physics/Vec2';
import { RINGOUT_RADIUS_M } from '../../arena/ringout/RingOutTuning';
import type { AiPersonality } from '../personalities/AiPersonality';
import { AI_CIRCULAR_ATTACK_RANGE_M, AI_COUNTER_MAX_LEAD_S, AI_COUNTER_MIN_CLOSING_SPEED_MPS, AI_DASH_ATTACK_MAX_RANGE_M } from './AiCombatRanges';
import { AiIntent } from './Intent';
import type { WorldState } from './WorldState';

// ============================================================
// ACTION SELECTION — EXECUTION TUNING
// Engineering placeholders (GDD section 167). These shape HOW an intent is
// carried out with the player's own buttons; none of them grants anything
// a player couldn't do.
// ============================================================

/** Below this angular error (radians), steering is considered "aligned enough" — avoids single-tick left/right chatter once close to the target heading. */
const STEERING_DEADZONE_RAD = 0.05;
/** Forward-only moves: while the target is more than this far (rad, ~100°) off the current heading, hold the throttle and turn first. Driving forward while turning around only carves a wide loop away from the target (heading turns at the same rate whether or not the Bey is moving). */
const THROTTLE_MAX_HEADING_ERROR_RAD = 1.75;
/** Moves allowed to back away (Retreat, RecoverFromEdge, DodgeThreat): past this heading error (rad, ~110°) the Bey reverses toward the target with MoveBackward instead of first turning around. Kept above THROTTLE_MAX_HEADING_ERROR_RAD so forward and reverse never alternate tick to tick. */
const REVERSE_MIN_HEADING_ERROR_RAD = 1.9;
/** A Dash is only released once heading is within this (rad) of the opponent — the Dash lock-on can only turn so fast, so releasing far off-line mostly whiffs. Charging continues (and keeps paying Attack Energy) while the AI turns. */
const DASH_RELEASE_MAX_HEADING_ERROR_RAD = 0.5;
/** Retreat/DodgeThreat: how much of the outward (away-from-center) part of "straight away from the opponent" is removed per unit of own edge risk — 2 removes all of it by edge risk 0.5. */
const RETREAT_OUTWARD_SUPPRESSION_PER_EDGE_RISK = 2;
/** If trimming the outward part leaves less than this of a direction, the opponent sits between this AI and the center: slide sideways along the edge instead. */
const RETREAT_MIN_TRIMMED_LENGTH = 0.2;
/** Edge pressure: below this opponent edge risk, PressAdvantage attacks from wherever it already is. */
const EDGE_PRESSURE_POSITIONING_MIN_RISK = 0.2;
/** Edge pressure: "center side" means own->opponent points outward (away from the arena center) at least this much (cosine). Knockback pushes along attacker->defender, so this is what makes a hit drive the opponent toward the edge. */
const EDGE_PRESSURE_CENTER_SIDE_MIN_DOT = 0.5;
/** Edge pressure: how far (m) inward of the opponent the flanking approach aims while not yet center-side. */
const EDGE_PRESSURE_STANDOFF_M = 2;
/** Circle keeps its current side unless the other side leads toward the center at least this much (cosine) — and only re-picks at all once some edge risk exists. Without this hysteresis the side flipped every few ticks near the center, and each flip meant turning around. */
const CIRCLE_SIDE_SWITCH_MIN_DOT = 0.3;

/** Evasion: weight of the inward (toward-center) pull added to the sideways escape at full edge risk. Enough that at the edge the escape clearly leads back in, while the sideways part still leaves the attack line. */
const EVASION_INWARD_PULL_AT_FULL_EDGE_RISK = 1.5;
/** Circle: weight of the inward pull added to the sideways direction at the ring-out line for centerControl 1, scaled down linearly toward the center. */
const CIRCLE_CENTER_PULL = 1.5;

/** Edge recovery: the opponent "blocks the way in" when it is within this distance (m) ... */
const RECOVERY_BLOCKED_MAX_DISTANCE_M = 3;
/** ... and this close (cosine) to the straight line toward the center. */
const RECOVERY_BLOCKED_MIN_DOT = 0.8;
/** How much of the center direction a blocked recovery keeps while going around the opponent (the rest is sideways). */
const RECOVERY_DETOUR_CENTER_WEIGHT = 0.5;

/**
 * Edge recovery heads for the center — unless the opponent stands in that
 * path, where "straight to the center" means pushing into them and staying
 * pinned against the wall. Then it goes around: sideways (on the side
 * away from the opponent's offset) with part of the inward direction.
 */
export function edgeRecoveryDirection(world: WorldState): Vec2 {
  const center = world.own.directionTowardCenter;
  if (length(center) === 0) return center;
  const toOpponent = subtract(world.opponent.positionXZ, world.own.positionXZ);
  const distance = length(toOpponent);
  if (distance > RECOVERY_BLOCKED_MAX_DISTANCE_M || distance < 1e-6) return center;
  const towardOpponent = scale(toOpponent, 1 / distance);
  if (dot(towardOpponent, center) < RECOVERY_BLOCKED_MIN_DOT) return center;
  const side = perpendicular(center);
  const sign = dot(side, towardOpponent) > 0 ? -1 : 1;
  return normalize(add(scale(side, sign), scale(center, RECOVERY_DETOUR_CENTER_WEIGHT)));
}

/** Component (of a unit direction) along a Bey-relative axis above which a Dodge direction key is held — cos(67.5°), so the 8 key combinations each cover a 45° sector: the same 8 directions a player can press (DodgeController.applyBurst). */
const DODGE_KEY_COMPONENT_THRESHOLD = 0.38;

/**
 * Where to go to get out of the way of an attack: sideways off the line
 * between the two Beys (a Dash homes in at a limited turn rate, so leaving
 * its line is what makes it miss), on the side leading toward the center,
 * pulled inward in proportion to own (momentum-projected) edge risk — and
 * never with any component toward the attacker, even when the attacker
 * sits between this AI and the center (then it is purely tangential, on
 * the side away from the attacker's own sideways drift).
 */
export function evasionDirection(world: WorldState): Vec2 {
  const center = world.own.directionTowardCenter;
  if (world.distanceToOpponentM <= 1e-3) return center;
  const towardAttacker = world.directionToOpponent;
  const side = perpendicular(towardAttacker);
  const centerSide = dot(side, center);
  let sign: 1 | -1;
  if (Math.abs(centerSide) > 0.05) {
    sign = centerSide >= 0 ? 1 : -1;
  } else {
    // No side leads inward (attacker straight toward/away from center):
    // step opposite to where the attacker is drifting sideways.
    sign = dot(side, world.opponent.velocityXZ) > 0 ? -1 : 1;
  }
  const edgeWeight = Math.max(world.own.edgeRiskFraction, world.own.projectedEdgeRiskFraction);
  let escape = add(scale(side, sign), scale(center, edgeWeight * EVASION_INWARD_PULL_AT_FULL_EDGE_RISK));
  const intoAttacker = dot(escape, towardAttacker);
  if (intoAttacker > 0) escape = subtract(escape, scale(towardAttacker, intoAttacker));
  const direction = normalize(escape);
  return length(direction) > 0 ? direction : scale(side, sign);
}

/** The Bey-relative direction keys (forward/back/left/right, diagonals allowed) that point a Dodge burst closest to `direction` — exactly the inputs a player would press. */
export function dodgeDirectionKeys(headingRad: number, direction: Vec2): Action[] {
  const forward = fromYaw(headingRad);
  const right = perpendicular(forward);
  const forwardComponent = dot(forward, direction);
  const rightComponent = dot(right, direction);
  const keys: Action[] = [];
  if (forwardComponent > DODGE_KEY_COMPONENT_THRESHOLD) keys.push(Action.MoveForward);
  if (forwardComponent < -DODGE_KEY_COMPONENT_THRESHOLD) keys.push(Action.MoveBackward);
  if (rightComponent > DODGE_KEY_COMPONENT_THRESHOLD) keys.push(Action.SteerRight);
  if (rightComponent < -DODGE_KEY_COMPONENT_THRESHOLD) keys.push(Action.SteerLeft);
  return keys;
}

/** How much of a fully-charged Dash a personality commits to before releasing, biased by aggression (aggression 1 -> ~0.4 charge, aggression 0 -> ~0.9 charge). Recomputed fresh each tick from personality alone (not stored) so it never needs its own state to stay in sync with. */
function dashTargetChargeFraction(personality: AiPersonality): number {
  return Math.max(0.15, Math.min(0.95, 0.9 - personality.aggression * 0.5));
}

/** Signed steering correction (SteerLeft/SteerRight) needed to turn `currentForward` toward `desiredDirection` — see MovementController.applyPreStep: SteerRight increases headingRad, and fromYaw's convention makes signedAngleBetween(currentForward, desiredDirection) negative when SteerRight is the correct direction to reduce it. */
function computeSteering(currentForward: Vec2, desiredDirection: Vec2): { steerLeft: boolean; steerRight: boolean } {
  const angleToClose = -signedAngleBetween(currentForward, desiredDirection);
  if (angleToClose > STEERING_DEADZONE_RAD) return { steerLeft: false, steerRight: true };
  if (angleToClose < -STEERING_DEADZONE_RAD) return { steerLeft: true, steerRight: false };
  return { steerLeft: false, steerRight: false };
}

interface MovePlan {
  direction: Vec2;
  /** Whether this move may be done in reverse (MoveBackward) when the target is behind — only for moving away/back to safety, never for closing in. */
  allowReverse: boolean;
}

/**
 * Away from the opponent, with the part that leads out of the ring trimmed
 * in proportion to own edge risk — a retreat must never back the AI
 * straight out of the ring (GDD section 129). When the opponent is between
 * this AI and the center, that leaves nothing: escape sideways instead.
 */
function retreatDirection(world: WorldState): Vec2 {
  const away = scale(world.directionToOpponent, -1);
  const outward = scale(world.own.directionTowardCenter, -1);
  const outwardAmount = dot(away, outward);
  const suppression = Math.min(1, Math.max(0, world.own.edgeRiskFraction * RETREAT_OUTWARD_SUPPRESSION_PER_EDGE_RISK));
  if (outwardAmount <= 0 || suppression === 0) return away;
  const trimmed = subtract(away, scale(outward, outwardAmount * suppression));
  if (length(trimmed) >= RETREAT_MIN_TRIMMED_LENGTH) return normalize(trimmed);
  return perpendicular(away);
}

interface EdgePressurePlan {
  direction: Vec2;
  /** True once own->opponent points outward enough that a hit drives the opponent toward the edge. */
  centerSide: boolean;
}

/**
 * Edge pressure (GDD section 63/129: exploit an opponent near the edge):
 * approach from the center side. Null when the opponent isn't near enough
 * to the edge for positioning to matter (attack from anywhere).
 */
function edgePressurePlan(world: WorldState): EdgePressurePlan | null {
  if (world.opponent.edgeRiskFraction < EDGE_PRESSURE_POSITIONING_MIN_RISK) return null;
  const outward = scale(world.opponent.directionTowardCenter, -1);
  if (length(outward) === 0) return null;
  const toOpponent = subtract(world.opponent.positionXZ, world.own.positionXZ);
  const distance = length(toOpponent);
  if (distance > 1e-6 && dot(scale(toOpponent, 1 / distance), outward) >= EDGE_PRESSURE_CENTER_SIDE_MIN_DOT) {
    return { direction: world.directionToOpponent, centerSide: true };
  }
  const flankPoint = add(world.opponent.positionXZ, scale(world.opponent.directionTowardCenter, EDGE_PRESSURE_STANDOFF_M));
  const toFlank = normalize(subtract(flankPoint, world.own.positionXZ));
  return { direction: length(toFlank) > 0 ? toFlank : world.directionToOpponent, centerSide: false };
}

/** null means "no movement intent this tick" (e.g. Wait, or holding ground for a counter). */
/**
 * Circle: sideways relative to the opponent (on circleSign's side), plus an
 * inward pull for a personality that values the middle
 * (AiPersonality.centerControl, GDD section 64 Defense "uses wall/arena
 * positioning") — the further out, the stronger, so it spirals back in.
 */
export function circleDirection(world: WorldState, personality: AiPersonality, circleSign: 1 | -1): Vec2 {
  const sideways = scale(perpendicular(world.directionToOpponent), circleSign);
  const radiusFraction = Math.max(0, Math.min(1, 1 - world.own.distanceToEdgeM / RINGOUT_RADIUS_M));
  const inwardWeight = personality.centerControl * radiusFraction * CIRCLE_CENTER_PULL;
  if (inwardWeight <= 0 || length(sideways) === 0) return sideways;
  return normalize(add(sideways, scale(world.own.directionTowardCenter, inwardWeight)));
}

function computeMovePlan(
  intent: AiIntent,
  world: WorldState,
  edgePlan: EdgePressurePlan | null,
  circleSign: 1 | -1,
  personality: AiPersonality,
): MovePlan | null {
  const hasOpponentDirection = world.distanceToOpponentM > 1e-3;
  switch (intent) {
    case AiIntent.Approach:
    case AiIntent.AttackDash:
    case AiIntent.AttackCircular:
      return hasOpponentDirection ? { direction: world.directionToOpponent, allowReverse: false } : null;
    case AiIntent.UseJumpDrift:
      // Only ever chosen to answer a threat (IntentSelection): hop off the
      // attack line like a dodge would, never into the attacker.
      return { direction: evasionDirection(world), allowReverse: false };
    case AiIntent.PressAdvantage:
      if (edgePlan) return { direction: edgePlan.direction, allowReverse: false };
      return hasOpponentDirection ? { direction: world.directionToOpponent, allowReverse: false } : null;
    case AiIntent.Retreat:
      return hasOpponentDirection ? { direction: retreatDirection(world), allowReverse: true } : null;
    case AiIntent.DodgeThreat:
      return { direction: evasionDirection(world), allowReverse: true };
    case AiIntent.RecoverFromEdge:
      return { direction: edgeRecoveryDirection(world), allowReverse: true };
    case AiIntent.Circle:
      // Side chosen (with hysteresis) by ActionSelector.updateCircleSign.
      return { direction: circleDirection(world, personality, circleSign), allowReverse: false };
    case AiIntent.CounterAttack:
    case AiIntent.Wait:
      return null;
    default:
      return null;
  }
}

/**
 * Steering + throttle for a move, using exactly a player's buttons.
 * Forward-only moves turn before throttling when the target is behind;
 * reversible moves back straight toward the target instead.
 */
function addMovementActions(plan: MovePlan, headingRad: number, desiredHeld: Set<Action>): void {
  if (length(plan.direction) === 0) return;
  const currentForward = fromYaw(headingRad);
  const headingErrorRad = Math.abs(signedAngleBetween(currentForward, plan.direction));

  if (plan.allowReverse && headingErrorRad > REVERSE_MIN_HEADING_ERROR_RAD) {
    // Reversing moves along -forward, so the Bey's back must face the target.
    const { steerLeft, steerRight } = computeSteering(currentForward, scale(plan.direction, -1));
    if (steerLeft) desiredHeld.add(Action.SteerLeft);
    if (steerRight) desiredHeld.add(Action.SteerRight);
    desiredHeld.add(Action.MoveBackward);
    return;
  }

  const { steerLeft, steerRight } = computeSteering(currentForward, plan.direction);
  if (steerLeft) desiredHeld.add(Action.SteerLeft);
  if (steerRight) desiredHeld.add(Action.SteerRight);
  if (headingErrorRad <= THROTTLE_MAX_HEADING_ERROR_RAD) desiredHeld.add(Action.MoveForward);
}

/** CounterAttack's tap moment: the incoming dasher is within AI_COUNTER_MAX_LEAD_S of entering own Circular reach (or already inside it). */
function isCounterTapMoment(world: WorldState): boolean {
  if (world.opponent.attackState !== AttackState.DashActive) return false;
  if (world.closingSpeedMps < AI_COUNTER_MIN_CLOSING_SPEED_MPS) return false;
  const secondsUntilInReach = (world.distanceToOpponentM - world.ownCircularReachM) / world.closingSpeedMps;
  return secondsUntilInReach <= AI_COUNTER_MAX_LEAD_S;
}

/** How long (ticks) the AI keeps a drift going before letting go of X: half a second, a readable slide off the attack line. */
const AI_DRIFT_MAX_TICKS = 30;

export class ActionSelector {
  private circleSign: 1 | -1 = 1;
  private currentTick = 0;
  private previousHeld = new Set<Action>();
  /** A Dash charge that was being held when this Bey was launched: held until it is back on the ground (see selectActions). */
  private holdingChargeThroughLaunch = false;
  /** Ticks this Bey has been Drifting in a row (the AI lets go of X after AI_DRIFT_MAX_TICKS). */
  private driftingTicks = 0;
  private readonly holdStartedAtTick = new Map<Action, number>();

  /**
   * Produces this tick's ControllerActions from the current intent.
   * `dodgeAttemptSucceeds` is a single pre-rolled outcome (AIController
   * rolls AiPersonality.dodgeSkill exactly once per fresh DodgeThreat
   * decision, not here — see AIController.makeFreshDecision — a per-tick
   * roll would let a moderate dodgeSkill converge to near-certain success
   * over the several ticks a single threat window can span). Ignored for
   * every intent other than DodgeThreat.
   */
  selectActions(
    intent: AiIntent,
    world: WorldState,
    personality: AiPersonality,
    dodgeAttemptSucceeds: boolean,
    fixedDeltaSeconds: number,
  ): ControllerActions {
    const desiredHeld = new Set<Action>();

    const edgePlan = intent === AiIntent.PressAdvantage ? edgePressurePlan(world) : null;
    if (intent === AiIntent.Circle) this.updateCircleSign(world);
    const movePlan = computeMovePlan(intent, world, edgePlan, this.circleSign, personality);
    if (movePlan) addMovementActions(movePlan, world.own.headingRad, desiredHeld);

    // PressAdvantage is an attack intent too (GDD section 64: Attack AI
    // "pressures broken Stability") — it picks Circular or Dash by current
    // range exactly like the two dedicated attack intents, rather than only
    // ever moving toward the target and never actually swinging. Against an
    // opponent near the edge it only swings once center-side (edgePlan),
    // so the hit drives them outward rather than back toward the middle.
    const pressGateOpen = intent !== AiIntent.PressAdvantage || !edgePlan || edgePlan.centerSide;
    const wantsToAttack = pressGateOpen && (intent === AiIntent.AttackCircular || intent === AiIntent.AttackDash || intent === AiIntent.PressAdvantage);
    const wantsCircular = intent === AiIntent.AttackCircular || (intent === AiIntent.PressAdvantage && world.distanceToOpponentM <= AI_CIRCULAR_ATTACK_RANGE_M);
    const wantsDash =
      intent === AiIntent.AttackDash ||
      (intent === AiIntent.PressAdvantage && world.distanceToOpponentM > AI_CIRCULAR_ATTACK_RANGE_M && world.distanceToOpponentM <= AI_DASH_ATTACK_MAX_RANGE_M);

    // Keep charging until both the personality's target charge is reached
    // AND the heading is on line — releasing off-line mostly whiffs, since
    // the Dash lock-on only turns so fast. A full charge releases anyway.
    const dashAligned =
      Math.abs(signedAngleBetween(fromYaw(world.own.headingRad), world.directionToOpponent)) <= DASH_RELEASE_MAX_HEADING_ERROR_RAD;
    const dashWantsMoreCharge = world.own.dashChargeFraction < dashTargetChargeFraction(personality);
    const dashWaitingForLine = !dashAligned && world.own.dashChargeFraction < 1;

    if (wantsToAttack && wantsCircular && world.own.attackState === AttackState.Neutral) {
      desiredHeld.add(Action.Attack);
    } else if (
      wantsToAttack &&
      wantsDash &&
      (world.own.attackState === AttackState.Neutral ||
        world.own.attackState === AttackState.Buffering ||
        world.own.attackState === AttackState.ChargingDash) &&
      (dashWantsMoreCharge || dashWaitingForLine) &&
      (world.own.dashReadiness >= 1 || world.own.attackState === AttackState.ChargingDash)
    ) {
      desiredHeld.add(Action.Attack);
    }

    // CounterAttack: hold ground, tap Circular at the moment the incoming
    // dasher is about to enter reach (GDD section 107: timing must matter).
    if (intent === AiIntent.CounterAttack && world.own.attackState === AttackState.Neutral && isCounterTapMoment(world)) {
      desiredHeld.add(Action.Attack);
    }

    // A Dodge only starts from a fresh press while grounded with enough
    // Stamina (DodgeController) — anything else is silently ignored, and
    // HOLDING the button afterwards never produces another press, so one
    // early press used to swallow the whole dodge. Press only when it can
    // take, and release for a tick between attempts so a retry is a real
    // new press. The burst goes wherever the direction keys held on the
    // press tick point (DodgeController.applyBurst): aim it along
    // evasionDirection with the same 8 key combinations a player has,
    // instead of letting whatever this tick's steering was decide.
    if (
      intent === AiIntent.DodgeThreat &&
      dodgeAttemptSucceeds &&
      world.own.dodgeState === DodgeState.Idle &&
      world.own.grounded &&
      world.own.canAffordDodge &&
      !this.previousHeld.has(Action.Dodge)
    ) {
      for (const key of [Action.MoveForward, Action.MoveBackward, Action.SteerLeft, Action.SteerRight]) desiredHeld.delete(key);
      for (const key of dodgeDirectionKeys(world.own.headingRad, evasionDirection(world))) desiredHeld.add(key);
      desiredHeld.add(Action.Dodge);
    }

    // Air recovery (GDD section 21): one fresh Dodge press while the window
    // is open. Not gated by dodgeSkill or Dodge cooldown — DodgeController
    // honors this press on its own air-recovery rule — and never held on:
    // once the window is used or closed there is nothing to press for.
    if (intent === AiIntent.AirRecover && !world.own.grounded && world.own.airRecoveryAvailable && !this.previousHeld.has(Action.Dodge)) {
      desiredHeld.add(Action.Dodge);
    }
    // Launched mid-charge: letting go of Attack is the release
    // (AttackController fires the Dash when the button is no longer held),
    // so any intent that stops holding it in the air fires the Dash from
    // the air. Owner decision (after PR #16): a charge being held when the
    // Bey is launched is kept held through that whole flight — from the
    // first tick the launch is seen, through the reaction delay (the
    // previous intent is still in charge then, and would release the
    // charge the moment it reached its target or 100%), through AirRecover
    // and any later decision in the same flight — until the Bey is back on
    // the ground. This is the button already held staying held, not a
    // reaction: AirRecover still waits its normal reaction delay, and
    // nothing is ever newly pressed (only a ChargingDash already in
    // progress continues). "Launched" is the air-recovery window
    // (DodgeController.registerLaunch arms it for knockbacks/launches
    // only), so a voluntary jump is unaffected: air attacks while jumping
    // stay allowed. Back on the ground the current decision decides
    // (release = a normal grounded Dash).
    const charging = world.own.attackState === AttackState.ChargingDash;
    const airRecoverOwnsCharge = intent === AiIntent.AirRecover && charging;
    const launchedAirborne = !world.own.grounded && world.own.airRecoveryAvailable;
    if (charging && (launchedAirborne || airRecoverOwnsCharge)) this.holdingChargeThroughLaunch = true;
    if (!charging || world.own.grounded) this.holdingChargeThroughLaunch = false;
    if (airRecoverOwnsCharge || this.holdingChargeThroughLaunch) desiredHeld.add(Action.Attack);

    // Sustain JumpDrift through the whole Idle->Hopping->Drifting sequence,
    // not just the tick that starts it — DriftController only transitions
    // Hopping->Drifting if JumpDrift (and steering) are STILL held the
    // moment it re-lands (see DriftController.tick), so releasing after one
    // tick can only ever produce a bare hop, never a real drift.
    // Since the owner-playtest drift fix a drift lasts as long as X is held
    // (it used to end as soon as the turn did), so the AI lets go after
    // AI_DRIFT_MAX_TICKS: holding it for the whole decision left both AIs
    // drifting round the rim for a full round (matrix-11: 100 s, no
    // contact).
    this.driftingTicks = world.own.driftState === DriftState.Drifting ? this.driftingTicks + 1 : 0;
    if (
      intent === AiIntent.UseJumpDrift &&
      ((world.own.driftState === DriftState.Idle && world.own.grounded) ||
        world.own.driftState === DriftState.Hopping ||
        (world.own.driftState === DriftState.Drifting && this.driftingTicks <= AI_DRIFT_MAX_TICKS))
    ) {
      desiredHeld.add(Action.JumpDrift);
      // The drift rule (owner, 2026-10-02): X + a lateral direction while moving drifts. The evasive hop slides
      // sideways off the attack line, so it always holds a side (toward the evasion, or the circling side).
      if (!desiredHeld.has(Action.SteerLeft) && !desiredHeld.has(Action.SteerRight)) desiredHeld.add(this.circleSign >= 0 ? Action.SteerRight : Action.SteerLeft);
    }

    return this.commit(desiredHeld, fixedDeltaSeconds);
  }

  /**
   * Circling must not casually drift toward the ring boundary: once any
   * edge risk exists, prefer the perpendicular side leading toward the
   * center — but only switch sides on a clear preference (hysteresis).
   */
  private updateCircleSign(world: WorldState): void {
    if (world.own.edgeRiskFraction <= 0) return;
    const centerward = dot(perpendicular(world.directionToOpponent), world.own.directionTowardCenter);
    if (Math.abs(centerward) >= CIRCLE_SIDE_SWITCH_MIN_DOT) this.circleSign = centerward >= 0 ? 1 : -1;
  }

  /**
   * Clears held/pressedThisFrame/hold-duration bookkeeping so the next
   * commit() starts fresh, as if nothing was ever held — for
   * AIController's Clash-mash path at the start of each new Clash
   * (ClashState transitioning to Active). Without this, an action still
   * "held" from the tick a previous Clash ended stays in this
   * bookkeeping indefinitely (nothing calls commit() for this selector
   * between Clashes), so if the next Clash's first mash happens to pick
   * the same action, commit() reads it as already held and produces no
   * fresh pressedThisFrame — silently losing that Clash's first mash
   * event (M7 audit follow-up).
   */
  reset(): void {
    this.driftingTicks = 0;
    this.previousHeld = new Set();
    this.holdStartedAtTick.clear();
    this.currentTick = 0;
  }

  /** Same held->pressedThisFrame/hold-duration bookkeeping ScriptedController.ts uses — see its header comment for why this shape. Public so AIController's Clash-mash path (a very different decision than normal intent-driven play — see AIController.ts) can drive the same diffing without duplicating it. */
  commit(activeHeld: ReadonlySet<Action>, fixedDeltaSeconds: number): ControllerActions {
    const pressedThisFrame = new Set<Action>();
    for (const action of activeHeld) {
      if (!this.previousHeld.has(action)) {
        pressedThisFrame.add(action);
        this.holdStartedAtTick.set(action, this.currentTick);
      }
    }
    for (const action of this.previousHeld) {
      if (!activeHeld.has(action)) {
        this.holdStartedAtTick.delete(action);
      }
    }

    const holdDurationSeconds = (action: Action): number => {
      const startedAtTick = this.holdStartedAtTick.get(action);
      return startedAtTick === undefined ? 0 : (this.currentTick - startedAtTick) * fixedDeltaSeconds;
    };

    const result: ControllerActions = {
      held: activeHeld,
      pressedThisFrame,
      attackHoldDurationSeconds: holdDurationSeconds(Action.Attack),
      jumpDriftHoldDurationSeconds: holdDurationSeconds(Action.JumpDrift),
    };

    this.previousHeld = new Set(activeHeld);
    this.currentTick++;
    return result;
  }

  /**
   * Returns the previous tick's actions unchanged (held repeated, no new
   * presses, hold-duration clocks frozen) — for use while
   * ControllerContext.simulationFrozen is true (GDD/hitstop: a controller
   * must not lose or fabricate input during a hitstop freeze). Deliberately
   * does NOT advance the internal tick counter — held didn't change, so
   * there is nothing to diff, and holding the counter steady is what keeps
   * hold-duration reading the same value for as long as the freeze lasts
   * instead of silently climbing every frozen tick.
   */
  repeatFrozenActions(fixedDeltaSeconds: number): ControllerActions {
    const holdDurationSeconds = (action: Action): number => {
      const startedAtTick = this.holdStartedAtTick.get(action);
      return startedAtTick === undefined ? 0 : (this.currentTick - startedAtTick) * fixedDeltaSeconds;
    };
    return {
      held: this.previousHeld,
      pressedThisFrame: new Set(),
      attackHoldDurationSeconds: holdDurationSeconds(Action.Attack),
      jumpDriftHoldDurationSeconds: holdDurationSeconds(Action.JumpDrift),
    };
  }
}
