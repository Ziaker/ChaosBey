// ============================================================
// BEY RATINGS — PLAYER-FACING ARCHETYPE STATS (MILESTONE 6)
// The GDD's approved 1-10 Attack/Defense/Stamina scale (GDD section 6/31)
// — the numbers a character-select screen would eventually show the
// player. This is the ONLY archetype stat shape a BeyDefinition stores.
// It is never read directly by a physics/combat system — see
// BeyStatsResolution.ts for the explicit resolution step that turns a
// rating into the internal multiplier those systems actually consume
// (BeyStats). Keeping the two separate means a future UI/balance pass on
// this 1-10 scale can never silently become "the" internal tuning number.
// ============================================================

export interface BeyRatings {
  /** 1-10. Contributes to knockback force and Stability damage dealt (GDD section 6/31). */
  attack: number;
  /** 1-10. Reduces knockback force and Stability damage taken. */
  defense: number;
  /** 1-10. Increases effective max Stamina and slows its drain. */
  stamina: number;
}

/** The midpoint of the 1-10 scale — resolves to a neutral (1.0) internal multiplier on every stat; see BeyStatsResolution.ts. */
export const NEUTRAL_BEY_RATINGS: BeyRatings = {
  attack: 5,
  defense: 5,
  stamina: 5,
};
