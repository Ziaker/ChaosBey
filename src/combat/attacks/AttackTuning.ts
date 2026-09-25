// ============================================================
// ATTACKS — GAMEPLAY TUNING
// Circular Attack (tap Z) and Dash Attack (hold+release Z), per GDD
// section 23. All numbers are Milestone 2 engineering placeholders (GDD
// section 167) — the mechanics/rules below are approved, the exact
// balance is not.
// ============================================================

// How long a press can stay ambiguous before it commits to being a hold
// (Dash charge) rather than a tap (Circular). A tap that releases before
// this fires Circular retroactively at release; see AttackController.
export const TAP_MAX_HOLD_S = 0.12;

// How far apart two Beys can be vertically and still have a hitbox
// connect (GDD section 20/109: attacking mid-air must preserve the jump
// trajectory, and a Bey well above/below the other shouldn't be hit just
// because their X/Z happen to coincide). Generous enough to cover a normal
// drift-hop's apex — Milestone 3's real jump system may need to revisit
// this once jump height becomes variable/significant.
export const HITBOX_VERTICAL_REACH_M = 1;

// --- Circular Attack ---
export const CIRCULAR_ACTIVE_DURATION_S = 0.25;
export const CIRCULAR_RECOVERY_S = 0.3;
export const CIRCULAR_HITBOX_RADIUS_M = 1.2;
export const CIRCULAR_BASE_KNOCKBACK_FORCE = 6;
export const CIRCULAR_STABILITY_DAMAGE = 8;
// Special interaction (GDD section 23/107): Circular Attack catching an
// opponent's active Dash Attack launches them upward instead of the usual
// horizontal knockback.
export const CIRCULAR_CATCHES_DASH_LAUNCH_UP_MPS = 7;

// --- Dash Attack ---
export const DASH_MIN_CHARGE_S = 0.15; // below this, charge contributes ~nothing beyond the minimum force.
export const DASH_MAX_CHARGE_S = 1.2; // charge stops adding force beyond this — a backstop; Attack Energy running out is the primary limiter (GDD section 24).
export const DASH_MIN_SPEED_MPS = 10;
export const DASH_MAX_SPEED_MPS = 18;
export const DASH_ACTIVE_DURATION_S = 0.5;
// Directional guidance toward the opponent while dashing (GDD section
// 105): a turn-rate cap, not a teleport — the dash must stay missable.
export const DASH_LOCK_ON_MAX_TURN_RATE_RAD_S = 3;
export const DASH_WHIFF_RECOVERY_S = 0.6;
export const DASH_HITBOX_RADIUS_M = 1;
export const DASH_MIN_STABILITY_DAMAGE = 10;
export const DASH_MAX_STABILITY_DAMAGE = 25;
export const DASH_MIN_KNOCKBACK_FORCE = 8;
export const DASH_MAX_KNOCKBACK_FORCE = 20;
