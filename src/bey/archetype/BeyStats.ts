// ============================================================
// BEY STATS — ARCHETYPE GAMEPLAY DATA (MILESTONE 6)
// The Attack/Defense/Stamina multipliers GDD section 6/31 calls for, read
// by Knockback.ts (Attack/Defense) and StaminaSystem.ts (Stamina). 1.0 is
// neutral/baseline — a BeyDefinition using these for every stat behaves
// identically to the single generic Bey every Milestone 1-5 self-test
// exercised, so existing combat balance is unchanged unless a definition
// actually varies from neutral.
// Concrete archetype values are engineering placeholders (GDD section
// 167), not final balance — see BeyArchetypes.ts.
// ============================================================

export interface BeyStats {
  /** Multiplies knockback force this Bey deals as attacker. */
  attack: number;
  /** Divides knockback force and Stability damage this Bey takes as defender — higher Defense means less taken. */
  defense: number;
  /** Multiplies effective max Stamina and divides drain rates — higher Stamina means a larger, slower-draining resource. */
  stamina: number;
}

export const NEUTRAL_BEY_STATS: BeyStats = {
  attack: 1,
  defense: 1,
  stamina: 1,
};
