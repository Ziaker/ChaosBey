// ============================================================
// BEY STATS RESOLUTION — RATINGS -> INTERNAL MULTIPLIERS (MILESTONE 6)
// The explicit resolution layer between a BeyRatings (1-10, player-facing,
// GDD section 6/31) and the BeyStats internal multiplier every
// physics/combat formula actually reads. No system outside this file
// decides how a rating point translates into gameplay effect — a
// character-select rework of the 1-10 numbers can never accidentally
// change tuning by itself, since resolveBeyStats() is the one place that
// mapping exists.
// RATING_NEUTRAL_POINT and STAT_MULTIPLIER_PER_RATING_POINT are Milestone
// 6 engineering placeholders (GDD section 167), not final balance.
// ============================================================

import type { BeyRatings } from './BeyRatings';
import type { BeyStats } from './BeyStats';

/** The 1-10 rating value that resolves to a neutral (1.0) multiplier. */
export const RATING_NEUTRAL_POINT = 5;

/** Internal multiplier change per rating point away from RATING_NEUTRAL_POINT. Placeholder — not final balance. */
export const STAT_MULTIPLIER_PER_RATING_POINT = 0.08;

function resolveOne(rating: number): number {
  return 1 + (rating - RATING_NEUTRAL_POINT) * STAT_MULTIPLIER_PER_RATING_POINT;
}

/** Pure — the only place a BeyRatings (1-10) becomes the BeyStats multipliers physics/combat code consumes. */
export function resolveBeyStats(ratings: BeyRatings): BeyStats {
  return {
    attack: resolveOne(ratings.attack),
    defense: resolveOne(ratings.defense),
    stamina: resolveOne(ratings.stamina),
  };
}
