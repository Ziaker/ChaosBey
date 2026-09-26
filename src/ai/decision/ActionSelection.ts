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
import { fromYaw, perpendicular, scale, signedAngleBetween, type Vec2 } from '../../physics/Vec2';
import type { AiPersonality } from '../personalities/AiPersonality';
import { AI_CIRCULAR_ATTACK_RANGE_M, AI_DASH_ATTACK_MAX_RANGE_M } from './AiCombatRanges';
import { AiIntent } from './Intent';
import type { WorldState } from './WorldState';

/** Below this angular error (radians), steering is considered "aligned enough" — avoids single-tick left/right chatter once close to the target heading. */
const STEERING_DEADZONE_RAD = 0.05;

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

/** null means "no movement intent this tick" (e.g. Wait, or an attack/dodge that doesn't call for repositioning). */
function computeDesiredMoveDirection(intent: AiIntent, world: WorldState): Vec2 | null {
  switch (intent) {
    case AiIntent.Approach:
    case AiIntent.PressAdvantage:
    case AiIntent.AttackDash:
    case AiIntent.AttackCircular:
    case AiIntent.UseJumpDrift:
      return world.distanceToOpponentM > 1e-3 ? world.directionToOpponent : null;
    case AiIntent.Retreat:
    case AiIntent.DodgeThreat:
      return world.distanceToOpponentM > 1e-3 ? scale(world.directionToOpponent, -1) : null;
    case AiIntent.RecoverFromEdge:
      return world.own.directionTowardCenter;
    case AiIntent.Circle: {
      const rightPerp = perpendicular(world.directionToOpponent);
      // Prefer whichever perpendicular side actually moves toward the
      // center (dot with directionTowardCenter positive) — circling must
      // not casually drift the AI toward the ring boundary.
      const towardCenterSign = rightPerp.x * world.own.directionTowardCenter.x + rightPerp.z * world.own.directionTowardCenter.z >= 0 ? 1 : -1;
      return scale(rightPerp, towardCenterSign);
    }
    case AiIntent.Wait:
      return null;
    default:
      return null;
  }
}

export class ActionSelector {
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
  selectActions(
    intent: AiIntent,
    world: WorldState,
    personality: AiPersonality,
    dodgeAttemptSucceeds: boolean,
    fixedDeltaSeconds: number,
  ): ControllerActions {
    const desiredHeld = new Set<Action>();

    const moveDirection = computeDesiredMoveDirection(intent, world);
    if (moveDirection) {
      const currentForward = fromYaw(world.own.headingRad);
      const { steerLeft, steerRight } = computeSteering(currentForward, moveDirection);
      if (steerLeft) desiredHeld.add(Action.SteerLeft);
      if (steerRight) desiredHeld.add(Action.SteerRight);
      desiredHeld.add(Action.MoveForward);
    }

    // PressAdvantage is an attack intent too (GDD section 64: Attack AI
    // "pressures broken Stability") — it picks Circular or Dash by current
    // range exactly like the two dedicated attack intents, rather than only
    // ever moving toward the target and never actually swinging.
    const wantsToAttack = intent === AiIntent.AttackCircular || intent === AiIntent.AttackDash || intent === AiIntent.PressAdvantage;
    const wantsCircular = intent === AiIntent.AttackCircular || (intent === AiIntent.PressAdvantage && world.distanceToOpponentM <= AI_CIRCULAR_ATTACK_RANGE_M);
    const wantsDash =
      intent === AiIntent.AttackDash ||
      (intent === AiIntent.PressAdvantage && world.distanceToOpponentM > AI_CIRCULAR_ATTACK_RANGE_M && world.distanceToOpponentM <= AI_DASH_ATTACK_MAX_RANGE_M);

    if (wantsToAttack && wantsCircular && world.own.attackState === AttackState.Neutral) {
      desiredHeld.add(Action.Attack);
    } else if (
      wantsToAttack &&
      wantsDash &&
      (world.own.attackState === AttackState.Neutral ||
        world.own.attackState === AttackState.Buffering ||
        world.own.attackState === AttackState.ChargingDash) &&
      world.own.dashChargeFraction < dashTargetChargeFraction(personality) &&
      world.own.attackEnergyFraction > 0
    ) {
      desiredHeld.add(Action.Attack);
    }

    if (intent === AiIntent.DodgeThreat && world.own.dodgeState === DodgeState.Idle && dodgeAttemptSucceeds) {
      desiredHeld.add(Action.Dodge);
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
