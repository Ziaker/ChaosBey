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

export const DODGE_BURST_SPEED_MPS = 9; // engineering placeholder (GDD section 167).
// GDD section 22's approved current baseline (not a final balance number,
// but the currently-approved concept — do not silently retune this one).
export const DODGE_ACTIVE_DURATION_S = 0.5; // i-frame window.
export const DODGE_COOLDOWN_S = 3; // default; pre-game configurable per GDD section 12.
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
