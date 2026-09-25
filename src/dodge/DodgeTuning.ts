// ============================================================
// DODGE — GAMEPLAY TUNING (MILESTONE 3)
// Action.Dodge (bound to C — GDD section 14). Grounded: a quick evasive
// burst with brief invincibility frames (i-frames) and a cooldown so it
// can't be spammed. Airborne: triggers air recovery instead (see
// SpinController.applyAirRecovery) rather than a burst/i-frames — dodging
// mid-air is a recovery tool, not another evasion window.
//
// Perfect Dodge (an i-frame window that actually avoided a hit, within a
// tighter early sub-window) is detected and telemetered, but its GAMEPLAY
// REWARD is explicitly NOT decided yet — the GDD requires that to be
// approved separately before it's implemented (do not invent one here).
// All numbers below are Milestone 3 engineering placeholders (GDD section
// 167), not locked balance.
// ============================================================

export const DODGE_BURST_SPEED_MPS = 9;
export const DODGE_ACTIVE_DURATION_S = 0.25;
// Early sub-window of the active dodge that counts as "perfect" if it
// avoids a hit — tighter than the full i-frame window, rewarding precise
// timing over a defensive habit of dodging early/often.
export const DODGE_PERFECT_WINDOW_S = 0.08;
export const DODGE_COOLDOWN_S = 0.6;
// Let the burst persist visibly instead of being killed almost instantly
// by normal lateral grip (see MovementTuning's LATERAL_GRIP_PER_S).
export const DODGE_GRIP_OVERRIDE_PER_S = 0.8;
