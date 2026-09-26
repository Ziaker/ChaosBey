// ============================================================
// BEY STATS — INTERNAL RESOLVED MULTIPLIERS (MILESTONE 6)
// INTERNAL ONLY — the actual numbers Knockback.ts (Attack/Defense) and
// StaminaSystem.ts (Stamina) read. Never construct or consume this
// directly from a BeyDefinition/BeyRatings; the resolution step in
// BeyStatsResolution.ts is the one place a player-facing 1-10 rating
// (GDD section 6/31) becomes one of these. createBey() resolves this once
// per Bey and stores it on the Bey object itself for every physics/combat
// system to read (see Bey.ts).
// 1.0 is neutral/baseline — a Bey resolving to these for every stat
// behaves identically to the single generic Bey every Milestone 1-5
// self-test exercised, so existing combat balance is unchanged unless a
// definition's ratings actually vary from neutral.
// ============================================================

export interface BeyStats {
  /** Multiplies knockback force and Stability damage this Bey deals as attacker. */
  attack: number;
  /** Divides knockback force and Stability damage this Bey takes as defender — higher Defense means less taken. */
  defense: number;
  /** Multiplies effective max Stamina and divides drain rates — higher Stamina means a larger, slower-draining resource. */
  stamina: number;
}

/** Resolves from BeyRatings.NEUTRAL_BEY_RATINGS via resolveBeyStats() — exported directly too since it's a fixed, well-known value (avoids every default-definition call site re-deriving it). */
export const NEUTRAL_BEY_STATS: BeyStats = {
  attack: 1,
  defense: 1,
  stamina: 1,
};
