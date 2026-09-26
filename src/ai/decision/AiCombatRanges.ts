// ============================================================
// AI COMBAT RANGES — SHARED TUNING (MILESTONE 7)
// Single source of truth for the distance bands IntentSelection.ts (which
// attack is worth wanting) and ActionSelection.ts (which attack to
// actually press for) both need to agree on — GDD section 101: one
// resolved value, never two competing copies that can drift apart.
// ============================================================

/** Distance (m) at/under which a Circular Attack is a realistic choice — mirrors the Circular hitbox's real short reach. */
export const AI_CIRCULAR_ATTACK_RANGE_M = 2.2;
/** Distance (m) beyond AI_CIRCULAR_ATTACK_RANGE_M, up to which a Dash Attack's charge-then-close approach is worth committing to. */
export const AI_DASH_ATTACK_MAX_RANGE_M = 9;
