// ============================================================
// DODGE — GAMEPLAY TUNING (MILESTONE 3)
// Action.Dodge (bound to C — GDD section 14). Grounded: a quick evasive
// burst with brief invincibility frames (i-frames) and a cooldown so it
// can't be spammed. Airborne (only after being launched/knocked airborne
// by an impact — GDD section 21/139): triggers air recovery instead (see
// SpinController.applyAirRecovery) rather than a burst/i-frames — a
// normal jump does NOT grant air recovery.
//
// Perfect Dodge (an i-frame window that actually avoided a hit, within a
// tighter early sub-window) is detected and telemetered, but its GAMEPLAY
// REWARD is explicitly NOT decided yet — the GDD requires that to be
// approved separately before it's implemented (do not invent one here).
// ============================================================

export const DODGE_BURST_SPEED_MPS = 12.6; // owner, 2026-10-02 (Lote 5): +40% distance (was 9); same duration and i-frames.
// GDD section 22's approved current baseline (not a final balance number,
// but the currently-approved concept — do not silently retune this one).
export const DODGE_ACTIVE_DURATION_S = 0.5; // i-frame window.
export const DODGE_COOLDOWN_S = 3; // default; pre-game configurable per GDD section 12 — Pregame slider "Dodge cooldown" (MatchConfig.dodgeCooldownS, owner 2026-10-02).
export const DODGE_COOLDOWN_RANGE = { min: 0.5, max: 6, step: 0.25 } as const;
// Early sub-window of the active dodge that counts as "perfect" if it
// avoids a hit — tighter than the full i-frame window, rewarding precise
// timing over a defensive habit of dodging early/often. Placeholder.
export const DODGE_PERFECT_WINDOW_S = 0.15;
// Let the burst persist visibly instead of being killed almost instantly
// by normal lateral grip (see MovementTuning's LATERAL_GRIP_PER_S).
export const DODGE_GRIP_OVERRIDE_PER_S = 0.8;

// GDD section 22: dodge consumes a resource/cost — owner decision
// (2026-09-25): Stamina, not Attack Energy (which stays purely offensive).
// Placeholder amount; STAMINA_MAX is 100 (see StaminaTuning.ts).
export const DODGE_STAMINA_COST = 20;

// How long a knockback/launch "arms" air recovery before it must actually
// leave the ground to use it — covers the few ticks of contact-detection
// lag between the impulse landing and the Bey actually becoming airborne,
// without letting a weak knockback that never left the ground silently
// arm recovery for a much later, unrelated jump.
export const LAUNCH_PENDING_WINDOW_S = 0.75;

// Owner, 2026-10-05: after a dodge the Bey stays intangible while the two Beys still overlap (they passed through each
// other), so they never touch on the way out — at most this long. PROVISIONAL.
export const INTANGIBLE_AFTER_DODGE_MAX_S = 0.5;

/**
 * Owner, 2026-10-05 ("a força do ataque do bey aumente esse tempo naturalmente, o slider trata apenas o mínimo"): each
 * unit of the launching hit's force adds this much (s) to the recovery time (MatchConfig.airRecoveryMinDelayS).
 * Measured knockback forces: median 25 (+0.25 s), p90 45 (+0.45 s). PROVISIONAL.
 */
export const AIR_RECOVERY_DELAY_PER_FORCE_S = 0.01;
/** Most the launching force can add to the recovery time (s). PROVISIONAL. */
export const AIR_RECOVERY_FORCE_DELAY_CAP_S = 0.6;
