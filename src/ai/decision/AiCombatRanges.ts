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

// --- Circular counter vs an incoming Dash (M7 Part 2, GDD section 23/107) ---

/** Own Circular reach (m: hitbox radius + averaged body radii, the same sum HitDetection uses) assumed when WorldState carries no self-knowledge of this Bey's real attack profile — matches the default archetype (1.2 + 0.6). */
export const AI_DEFAULT_CIRCULAR_REACH_M = 1.8;
/** Tap the counter Circular once the incoming dasher is at most this long (s) from entering own Circular reach. The press needs ~2 ticks (press, then Buffering) before the hitbox is live, and a live Circular lasts 0.25 s, so anything inside this lead still has the hitbox up when the dasher arrives; much earlier and it expires first (timing must matter — GDD section 107). */
export const AI_COUNTER_MAX_LEAD_S = 0.2;
/** An opponent Dash only counts as "incoming" when it closes on this AI at least this fast (m/s) — a Dash aimed elsewhere isn't something to counter. */
export const AI_COUNTER_MIN_CLOSING_SPEED_MPS = 4;
