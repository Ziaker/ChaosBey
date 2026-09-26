// ============================================================
// MATCH CONFIG
// Single resolved source of truth for pre-match-configurable gameplay
// numbers (GDD section 101/166: avoid competing sources of truth) — the
// per-match counterpart to config/runtime/RuntimeConfig.ts, which only
// covers app-boot settings. Each system that owns a configurable value
// reads its own field here rather than a tuning constant directly, so a
// pre-match override always takes effect through exactly one path.
//
// Milestone 5 is the first consumer: the GDD requires Clash's knockback
// impact multiplier to be configurable pre-match (section 152), not a
// fixed constant. Other systems can add their own fields here later the
// same way, without inventing a second config mechanism.
// ============================================================

import { CLASH_IMPACT_MULTIPLIER_DEFAULT } from '../../combat/clash/ClashTuning';

export interface MatchConfig {
  /** Multiplies the real knockback/Stability consequence a Clash resolution applies (both the FirstWins/SecondWins loser's knockback and a Tie's symmetric repulsion) — GDD section 152's "configurable impact multiplier". */
  clashImpactMultiplier: number;
}

export function createDefaultMatchConfig(): MatchConfig {
  return {
    clashImpactMultiplier: CLASH_IMPACT_MULTIPLIER_DEFAULT,
  };
}

/** Merges a pre-match override on top of the defaults, producing the single resolved MatchConfig the rest of the app consumes. */
export function resolveMatchConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return { ...createDefaultMatchConfig(), ...overrides };
}
