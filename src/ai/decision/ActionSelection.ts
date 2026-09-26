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
/** Retreat/DodgeThreat/JumpEvade: how fast the allowed outward (away-from-center) cosine of "straight away from the opponent" shrinks per unit of own edge risk — 2 allows none by edge risk 0.5. */
const RETREAT_OUTWARD_SUPPRESSION_PER_EDGE_RISK = 2;
/** Below this much sideways component (relative to outward), "away" is treated as straight outward and the retreat slides along the edge to a fixed side, so a sideways part hovering around zero can't flip the side every tick. */
const RETREAT_MIN_SIDEWAYS_LENGTH = 0.2;
/** Edge pressure: below this opponent edge risk, PressAdvantage attacks from wherever it already is. */
const EDGE_PRESSURE_POSITIONING_MIN_RISK = 0.2;
/** Edge pressure: "center side" means own->opponent points outward (away from the arena center) at least this much (cosine). Knockback pushes along attacker->defender, so this is what makes a hit drive the opponent toward the edge. */
const EDGE_PRESSURE_CENTER_SIDE_MIN_DOT = 0.5;
/** Edge pressure: how far (m) inward of the opponent the flanking approach aims while not yet center-side. */
const EDGE_PRESSURE_STANDOFF_M = 2;
/** DodgeThreat: how much a candidate dodge direction is rewarded for leading toward the arena center, per unit of own edge risk. */
const DODGE_INWARD_WEIGHT_PER_EDGE_RISK = 2;
/** DodgeThreat: while there's any edge risk, a candidate leading outward more than this (cosine) is ruled out — unless every candidate does. */
const DODGE_MAX_OUTWARD_DOT_NEAR_EDGE = 0.2;
/** DodgeThreat: how much moving away from the attacker is preferred over toward it, on top of sidestepping off the attack line. */
const DODGE_AWAY_WEIGHT = 0.5;
/** Circle keeps its current side unless the other side leads toward the center at least this much (cosine) — and only re-picks at all once some edge risk exists. Without this hysteresis the side flipped every few ticks near the center, and each flip meant turning around. */
const CIRCLE_SIDE_SWITCH_MIN_DOT = 0.3;

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
 * Away from the opponent, turned toward the edge's tangent just enough that
 * its outward (away-from-center) cosine is at most 1 − suppression, where
 * suppression grows with own edge risk — a retreat must never back the AI
 * straight out of the ring (GDD section 129). By edge risk 0.5 it only
 * slides along the edge.
 *
 * Regression (M7 Part 2b): this used to subtract part of the outward
 * component and re-normalize. When "away" pointed straight outward (the
 * opponent between this AI and the center), re-normalizing the trimmed
 * vector gave back a straight-outward direction at any edge risk below
 * 0.4 — JumpEvade throttled toward the ring-out and the post-dodge
 * movement drifted outward.
 */
function retreatDirection(world: WorldState): Vec2 {
  const away = scale(world.directionToOpponent, -1);
  const outward = scale(world.own.directionTowardCenter, -1);
  if (length(outward) === 0) return away;
  const suppression = Math.min(1, Math.max(0, world.own.edgeRiskFraction * RETREAT_OUTWARD_SUPPRESSION_PER_EDGE_RISK));
  const maxOutwardCos = 1 - suppression;
  const outwardCos = dot(away, outward);
  if (outwardCos <= maxOutwardCos) return away;
  const sideways = subtract(away, scale(outward, outwardCos));
  const side = length(sideways) >= RETREAT_MIN_SIDEWAYS_LENGTH ? normalize(sideways) : perpendicular(outward);
  return add(scale(outward, maxOutwardCos), scale(side, Math.sqrt(1 - maxOutwardCos * maxOutwardCos)));
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
function computeMovePlan(intent: AiIntent, world: WorldState, edgePlan: EdgePressurePlan | null, circleSign: 1 | -1): MovePlan | null {
  const hasOpponentDirection = world.distanceToOpponentM > 1e-3;
  switch (intent) {
    case AiIntent.Approach:
    case AiIntent.AttackDash:
    case AiIntent.AttackCircular:
    case AiIntent.UseJumpDrift:
      return hasOpponentDirection ? { direction: world.directionToOpponent, allowReverse: false } : null;
    case AiIntent.PressAdvantage:
      if (edgePlan) return { direction: edgePlan.direction, allowReverse: false };
      return hasOpponentDirection ? { direction: world.directionToOpponent, allowReverse: false } : null;
    case AiIntent.Retreat:
    case AiIntent.DodgeThreat:
      return hasOpponentDirection ? { direction: retreatDirection(world), allowReverse: true } : null;
    case AiIntent.RecoverFromEdge:
      return { direction: world.own.directionTowardCenter, allowReverse: true };
    case AiIntent.AirRecover:
      // Whatever air control there is goes back toward the center, only
      // when there is any edge risk at all.
      return world.own.edgeRiskFraction > 0 ? { direction: world.own.directionTowardCenter, allowReverse: true } : null;
    case AiIntent.Circle:
      // Side chosen (with hysteresis) by ActionSelector.updateCircleSign.
      return { direction: scale(perpendicular(world.directionToOpponent), circleSign), allowReverse: false };
    case AiIntent.CounterAttack:
    case AiIntent.JumpEvade:
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

/** Held inputs for a dodge burst: forward (+1 MoveForward / -1 MoveBackward) and lateral (+1 SteerRight / -1 SteerLeft). */
export interface DodgeInputs {
  forward: -1 | 0 | 1;
  lateral: -1 | 0 | 1;
}

const DODGE_INPUT_CANDIDATES: readonly DodgeInputs[] = [
  { forward: 1, lateral: 0 },
  { forward: 1, lateral: 1 },
  { forward: 0, lateral: 1 },
  { forward: -1, lateral: 1 },
  { forward: -1, lateral: 0 },
  { forward: -1, lateral: -1 },
  { forward: 0, lateral: -1 },
  { forward: 1, lateral: -1 },
];

/** World direction DodgeController.applyBurst produces for these held inputs — mirrors its math exactly (forward = fromYaw(heading), right = perpendicular(forward)). */
export function dodgeBurstDirection(headingRad: number, inputs: DodgeInputs): Vec2 {
  const forward = fromYaw(headingRad);
  return normalize(add(scale(forward, inputs.forward), scale(perpendicular(forward), inputs.lateral)));
}

/**
 * The dodge direction (as held inputs) for an imminent hit: sidestep off
 * the attack line, prefer away over toward the attacker, and — scaled by
 * own edge risk — lead toward the center, never clearly outward while any
 * alternative exists (GDD section 129).
 */
export function chooseDodgeInputs(world: WorldState): DodgeInputs {
  return bestEvadeInputs(world, DODGE_INPUT_CANDIDATES);
}

/**
 * JumpEvade's throttle while the jump carries it: forward, backward or
 * neither, scored exactly like a dodge direction but limited to what the
 * throttle alone can do (steering during the hop would turn it into a
 * drift). Staying put scores as a sidestep with no inward lead, so the
 * throttle is used only when the heading already points off the attack
 * line — never along it toward the attacker, never outward near the edge.
 */
export function chooseJumpEvadeThrottle(world: WorldState): -1 | 0 | 1 {
  return bestEvadeInputs(world, JUMP_EVADE_THROTTLE_CANDIDATES).forward;
}

const JUMP_EVADE_THROTTLE_CANDIDATES: readonly DodgeInputs[] = [
  { forward: 0, lateral: 0 },
  { forward: 1, lateral: 0 },
  { forward: -1, lateral: 0 },
];

function bestEvadeInputs(world: WorldState, candidates: readonly DodgeInputs[]): DodgeInputs {
  const toAttacker = normalize(subtract(world.opponent.positionXZ, world.own.positionXZ));
  const towardCenter = world.own.directionTowardCenter;
  const edgeRisk = world.own.edgeRiskFraction;
  let best: DodgeInputs = candidates[0]!;
  let bestScore = -Infinity;
  let bestAllowed = false;
  for (const candidate of candidates) {
    const direction = dodgeBurstDirection(world.own.headingRad, candidate);
    const alongAttack = dot(direction, toAttacker);
    const score = 1 - Math.abs(alongAttack) - alongAttack * DODGE_AWAY_WEIGHT + dot(direction, towardCenter) * edgeRisk * DODGE_INWARD_WEIGHT_PER_EDGE_RISK;
    const allowed = edgeRisk <= 0 || -dot(direction, towardCenter) <= DODGE_MAX_OUTWARD_DOT_NEAR_EDGE;
    if ((allowed && !bestAllowed) || (allowed === bestAllowed && score > bestScore)) {
      best = candidate;
      bestScore = score;
      bestAllowed = allowed;
    }
  }
  return best;
}

function setMovementInputs(desiredHeld: Set<Action>, inputs: DodgeInputs): void {
  for (const action of [Action.MoveForward, Action.MoveBackward, Action.SteerLeft, Action.SteerRight]) desiredHeld.delete(action);
  if (inputs.forward > 0) desiredHeld.add(Action.MoveForward);
  if (inputs.forward < 0) desiredHeld.add(Action.MoveBackward);
  if (inputs.lateral > 0) desiredHeld.add(Action.SteerRight);
  if (inputs.lateral < 0) desiredHeld.add(Action.SteerLeft);
}

/** CounterAttack's tap moment: the incoming dasher is within AI_COUNTER_MAX_LEAD_S of entering own Circular reach (or already inside it). */
function isCounterTapMoment(world: WorldState): boolean {
  if (world.opponent.attackState !== AttackState.DashActive) return false;
  if (world.closingSpeedMps < AI_COUNTER_MIN_CLOSING_SPEED_MPS) return false;
  const secondsUntilInReach = (world.distanceToOpponentM - world.ownCircularReachM) / world.closingSpeedMps;
  return secondsUntilInReach <= AI_COUNTER_MAX_LEAD_S;
}

export class ActionSelector {
  private circleSign: 1 | -1 = 1;
  private lastMoveDirection: Vec2 | null = null;
  private currentTick = 0;
  private previousHeld = new Set<Action>();
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
  /** The world direction the last selectActions() steered toward (its movement goal), or null when that intent had none (Wait, a counter stance, JumpEvade...). Debug only. */
  getLastMoveDirection(): Vec2 | null {
    return this.lastMoveDirection;
  }

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
    const movePlan = computeMovePlan(intent, world, edgePlan, this.circleSign);
    this.lastMoveDirection = movePlan && length(movePlan.direction) > 0 ? movePlan.direction : null;
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
      world.own.attackEnergyFraction > 0
    ) {
      desiredHeld.add(Action.Attack);
    }

    // CounterAttack: hold ground, tap Circular at the moment the incoming
    // dasher is about to enter reach (GDD section 107: timing must matter).
    if (intent === AiIntent.CounterAttack && world.own.attackState === AttackState.Neutral && isCounterTapMoment(world)) {
      desiredHeld.add(Action.Attack);
    }

    // The dodge burst goes wherever the movement keys held on the press tick
    // point (DodgeController.applyBurst), so that tick's keys are chosen for
    // the dodge itself, not for the retreat movement.
    if (
      intent === AiIntent.DodgeThreat &&
      world.own.dodgeState === DodgeState.Idle &&
      world.own.dodgeReady &&
      world.own.grounded &&
      dodgeAttemptSucceeds
    ) {
      setMovementInputs(desiredHeld, chooseDodgeInputs(world));
      desiredHeld.add(Action.Dodge);
    }

    // JumpEvade: a full-height jump (JumpDrift held with no steering, so the
    // variable-jump assist applies and it never turns into a drift), with the
    // throttle carrying it off the attack line only when that is edge-safe
    // (chooseJumpEvadeThrottle — the dodge's own scoring).
    if (intent === AiIntent.JumpEvade) {
      if ((world.own.driftState === DriftState.Idle && world.own.grounded) || world.own.driftState === DriftState.Hopping) {
        desiredHeld.add(Action.JumpDrift);
      }
      const throttle = chooseJumpEvadeThrottle(world);
      if (throttle > 0) desiredHeld.add(Action.MoveForward);
      else if (throttle < 0) desiredHeld.add(Action.MoveBackward);
    }

    // AirRecover: Dodge only while a press would really trigger air
    // recovery (airborne, window open — re-checked every tick), so the press
    // lands inside the window and is released the tick the window closes
    // (used, or landed). Never a general air dodge.
    if (intent === AiIntent.AirRecover && !world.own.grounded && world.own.airRecoveryAvailable) {
      desiredHeld.add(Action.Dodge);
    }
    // Launched mid-charge: AirRecover pre-empts the Dash commitment, but
    // letting go of Attack would dump the charge as a Dash fired from the
    // air — keep holding it; the next decision decides what to do with it.
    if (intent === AiIntent.AirRecover && world.own.attackState === AttackState.ChargingDash) {
      desiredHeld.add(Action.Attack);
    }

    // Sustain JumpDrift through the whole Idle->Hopping->Drifting sequence,
    // not just the tick that starts it — DriftController only transitions
    // Hopping->Drifting if JumpDrift (and steering) are STILL held the
    // moment it re-lands (see DriftController.tick), so releasing after one
    // tick can only ever produce a bare hop, never a real drift.
    if (
      intent === AiIntent.UseJumpDrift &&
      ((world.own.driftState === DriftState.Idle && world.own.grounded) ||
        world.own.driftState === DriftState.Hopping ||
        world.own.driftState === DriftState.Drifting)
    ) {
      desiredHeld.add(Action.JumpDrift);
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
