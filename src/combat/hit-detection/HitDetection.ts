// ============================================================
// HIT DETECTION
// Overlap test between an active attack hitbox and the opponent's
// collider. Deliberately simple for Milestone 2 (a horizontal-distance
// sphere check against the Bey's own collider radius, plus a coarse
// vertical-separation check) — real hitbox shapes/visualization are a
// later combat-polish pass, not a foundation requirement. The vertical
// check keeps a Bey well above/below the other from being hit just
// because their X/Z coincide (GDD section 20/109: attacking mid-air must
// preserve the jump trajectory, it must not act like a flat 2D check).
//
// Both sides' hitboxes are checked independently, so a simultaneous
// double-hit is possible right now — that's expected until Clash
// (Milestone 5) exists to specially resolve simultaneous attacks.
// ============================================================

import { BEY_COLLIDER_RADIUS_M } from '../../bey/core/BeyTuning';
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
}

function isWithinHitboxReach(attacker: HitDetectionSide, defender: HitDetectionSide, hitbox: ActiveHitbox): boolean {
  const horizontalDistanceM = length(subtract(defender.positionXZ, attacker.positionXZ));
  const verticalDistanceM = Math.abs(defender.positionYM - attacker.positionYM);
  return horizontalDistanceM <= hitbox.radiusM + BEY_COLLIDER_RADIUS_M && verticalDistanceM <= HITBOX_VERTICAL_REACH_M;
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
