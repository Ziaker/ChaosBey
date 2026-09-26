// ============================================================
// HIT DETECTION
// Overlap test between an active attack hitbox and the opponent's
// collider. Deliberately simple for Milestone 2 (a horizontal-distance
// sphere check against each Bey's own collider radius, plus a coarse
// vertical-separation check) — real hitbox shapes/visualization are a
// later combat-polish pass, not a foundation requirement. The vertical
// check keeps a Bey well above/below the other from being hit just
// because their X/Z coincide (GDD section 20/109: attacking mid-air must
// preserve the jump trajectory, it must not act like a flat 2D check).
//
// Both sides' hitboxes are checked independently, so a simultaneous
// double-hit is possible right now — that's expected until Clash
// (Milestone 5) exists to specially resolve simultaneous attacks.
//
// Milestone 6: colliderRadiusM is now each participant's own resolved
// BeyPhysicalProfile.colliderRadiusM (GDD section 6/31 — archetypes
// genuinely differ in physical dimensions), not the fixed
// BEY_COLLIDER_RADIUS_M constant every prior milestone shared. The two
// participants' radii are averaged into a single body-radius allowance —
// this reproduces the exact pre-Milestone-6 reach when both sides are the
// default archetype (0.6 average of 0.6/0.6 = 0.6), while a bigger/smaller
// archetype on either side now genuinely shifts the reach instead of every
// Bey silently sharing one hardcoded body size.
// ============================================================

import { length, subtract, type Vec2 } from '../../physics/Vec2';
import { AttackState, type ActiveHitbox } from '../attacks/AttackController';
import { HITBOX_VERTICAL_REACH_M } from '../attacks/AttackTuning';

export interface HitEvent {
  /** true: the "first" combatant's attack landed on "second"; false: the reverse. */
  attackerIsFirst: boolean;
  hitbox: ActiveHitbox;
  /** GDD section 23/107: Circular Attack catching an opponent's active Dash Attack launches them upward instead of normal knockback. */
  caughtOpponentDashing: boolean;
}

export interface HitDetectionSide {
  positionXZ: Vec2;
  positionYM: number;
  hitbox: ActiveHitbox | null;
  state: AttackState;
  /** This Bey's own resolved BeyPhysicalProfile.colliderRadiusM. */
  colliderRadiusM: number;
}

function isWithinHitboxReach(attacker: HitDetectionSide, defender: HitDetectionSide, hitbox: ActiveHitbox): boolean {
  const horizontalDistanceM = length(subtract(defender.positionXZ, attacker.positionXZ));
  const verticalDistanceM = Math.abs(defender.positionYM - attacker.positionYM);
  const bodyRadiusAllowanceM = (attacker.colliderRadiusM + defender.colliderRadiusM) / 2;
  return horizontalDistanceM <= hitbox.radiusM + bodyRadiusAllowanceM && verticalDistanceM <= HITBOX_VERTICAL_REACH_M;
}

export function detectHits(first: HitDetectionSide, second: HitDetectionSide): HitEvent[] {
  const events: HitEvent[] = [];

  if (first.hitbox && isWithinHitboxReach(first, second, first.hitbox)) {
    events.push({
      attackerIsFirst: true,
      hitbox: first.hitbox,
      caughtOpponentDashing: first.hitbox.kind === 'circular' && second.state === AttackState.DashActive,
    });
  }

  if (second.hitbox && isWithinHitboxReach(second, first, second.hitbox)) {
    events.push({
      attackerIsFirst: false,
      hitbox: second.hitbox,
      caughtOpponentDashing: second.hitbox.kind === 'circular' && first.state === AttackState.DashActive,
    });
  }

  return events;
}
