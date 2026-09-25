// ============================================================
// ATTACK ENERGY — GAMEPLAY TUNING
// Faster-paced offensive resource than Stamina, governs Dash Attack charge
// (GDD section 24/125). Owner-approved regeneration model (2026-09-25):
// passively regenerates once the Bey stops actively consuming it, after a
// short delay, back up to max. Regeneration pauses entirely while Attack
// is being held/consumed. All numbers below are engineering placeholders,
// not locked balance (GDD section 167) — only the *conceptual* regen
// model itself was approved, not these exact rates.
// ============================================================

export const ATTACK_ENERGY_MAX = 100;

// Drained per second while charging a Dash Attack (Action.Attack held).
export const ATTACK_ENERGY_CONSUMPTION_PER_S = 40;

// After consumption stops, wait this long before regen resumes.
export const ATTACK_ENERGY_RECOVERY_DELAY_S = 1.2;
export const ATTACK_ENERGY_RECOVERY_PER_S = 20;
