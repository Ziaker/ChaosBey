// ============================================================
// HIT DETECTION
// Overlap test between an active attack hitbox and the opponent's
// collider. Deliberately simple for Milestone 2 (a horizontal-distance
// sphere check against the Bey's own collider radius) — real hitbox
// shapes/visualization are a later combat-polish pass, not a foundation
// requirement.
//
// Both sides' hitboxes are checked independently, so a simultaneous
// double-hit is possible right now — that's expected until Clash
// (Milestone 5) exists to specially resolve simultaneous attacks.
// ============================================================

import { BEY_COLLIDER_RADIUS_M } from '../../bey/core/BeyTuning';
import { length, subtract, type Vec2 } from '../../physics/Vec2';
import { AttackState, type ActiveHitbox } from '../attacks/AttackController';

export interface HitEvent {
  /** true: the "first" combatant's attack landed on "second"; false: the reverse. */
  attackerIsFirst: boolean;
  hitbox: ActiveHitbox;
  /** GDD section 23/107: Circular Attack catching an opponent's active Dash Attack launches them upward instead of normal knockback. */
  caughtOpponentDashing: boolean;
}

export function detectHits(
  firstPositionXZ: Vec2,
  firstHitbox: ActiveHitbox | null,
  firstState: AttackState,
  secondPositionXZ: Vec2,
  secondHitbox: ActiveHitbox | null,
  secondState: AttackState,
): HitEvent[] {
  const events: HitEvent[] = [];

  if (firstHitbox && length(subtract(secondPositionXZ, firstPositionXZ)) <= firstHitbox.radiusM + BEY_COLLIDER_RADIUS_M) {
    events.push({
      attackerIsFirst: true,
      hitbox: firstHitbox,
      caughtOpponentDashing: firstHitbox.kind === 'circular' && secondState === AttackState.DashActive,
    });
  }

  if (secondHitbox && length(subtract(firstPositionXZ, secondPositionXZ)) <= secondHitbox.radiusM + BEY_COLLIDER_RADIUS_M) {
    events.push({
      attackerIsFirst: false,
      hitbox: secondHitbox,
      caughtOpponentDashing: secondHitbox.kind === 'circular' && firstState === AttackState.DashActive,
    });
  }

  return events;
}
