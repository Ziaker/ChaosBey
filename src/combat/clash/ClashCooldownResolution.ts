// ============================================================
// CLASH COOLDOWN — ALTERNATIVE RESOLUTION
// GDD: while a Clash is on Cooldown, a new compatible double-hit does not
// start another Clash. Both hits still resolve with their own normal
// knockback/Stability damage (see ClashOrchestration.ts, outside this
// self-contained package), but the slower combatant — by current speed —
// takes proportionally more, as a deterrent against spamming collisions
// during the cooldown window instead of waiting it out. Pure formula only;
// no dependency on the real Knockback/Bey/Rapier types (kept consistent
// with the rest of src/combat/clash/).
// ============================================================

import { CLASH_COOLDOWN_ALT_SLOWER_PENALTY_MAX, CLASH_VELOCITY_REFERENCE_MPS } from './ClashTuning';

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

/**
 * Multiplier to apply to the knockback/Stability damage a combatant
 * receives as the defending side of a cooldown-alternative double-hit.
 * 1.0 when this combatant is at least as fast as the other (no penalty);
 * scales up to `1 + CLASH_COOLDOWN_ALT_SLOWER_PENALTY_MAX` as the speed gap
 * (other's speed minus mine) reaches CLASH_VELOCITY_REFERENCE_MPS or more.
 */
export function computeCooldownAlternativeMultiplier(mySpeedMps: number, otherSpeedMps: number): number {
  const disadvantageFraction = clamp01((otherSpeedMps - mySpeedMps) / CLASH_VELOCITY_REFERENCE_MPS);
  return 1 + disadvantageFraction * CLASH_COOLDOWN_ALT_SLOWER_PENALTY_MAX;
}
