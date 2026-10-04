// ============================================================
// SPEED → DAMAGE (owner, 2026-10-04, item 11)
// "Quanto mais rápido, mais dano, mais build up de velocidade = mais
// movimento no stage = mais forte."
//
// An attack hit's Stability damage (Dash or Circular; body collisions
// already scale with the speed difference) is multiplied by
//   1 + gain × (speed at the hit / reference speed − 1),   at least ×0.5
// where the reference is the speed the hit's base damage was tuned for:
// a Dash's own speed for its charge, a Circular's user's top speed before
// momentum. At the reference the damage is exactly what it was; slower
// hurts less, faster (momentum) hurts more. With the Dash keeping the speed
// built up before it (dashCarriesSpeed), momentum → speed → damage.
// The gain is a Pregame slider (MatchConfig.speedDamageGain); 0 = off.
// Defaults are PROVISIONAL.
// ============================================================

export const SPEED_DAMAGE_GAIN_DEFAULT = 0.5;
export const SPEED_DAMAGE_GAIN_RANGE = { min: 0, max: 1.5, step: 0.05 } as const;
/** The multiplier never goes below this (a hit from a standstill still hurts). PROVISIONAL. */
export const SPEED_DAMAGE_MIN_MULTIPLIER = 0.5;

export function speedDamageMultiplier(speedMps: number, referenceSpeedMps: number, gain: number): number {
  if (!(gain > 0) || !(referenceSpeedMps > 0)) return 1;
  return Math.max(SPEED_DAMAGE_MIN_MULTIPLIER, 1 + gain * (Math.max(0, speedMps) / referenceSpeedMps - 1));
}
