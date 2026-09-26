// ============================================================
// BEY DEFINITION — COMBINED ARCHETYPE DATA (MILESTONE 6)
// Everything createBey() needs to build one concrete Bey: its identity,
// physical mass, player-facing Ratings (GDD section 6/31's 1-10 scale —
// see BeyRatings.ts; resolved into internal BeyStats multipliers once at
// creation time, see BeyStatsResolution.ts and Bey.ts), movement
// Handling, and (separately, decoupled) visual Appearance. Loaders/
// factories elsewhere just select one of these — no system outside this
// package decides archetype numbers itself (GDD section 1.4).
// ============================================================

import type { BeyAppearance } from './BeyAppearance';
import { DEFAULT_HANDLING_PROFILE, type BeyHandlingProfile } from './BeyHandlingProfile';
import { NEUTRAL_BEY_RATINGS, type BeyRatings } from './BeyRatings';
import { BEY_MASS_KG } from '../core/BeyTuning';
import { createBeyMesh } from '../procedural-model/createBeyMesh';

export interface BeyDefinition {
  readonly id: string;
  readonly name: string;
  readonly massKg: number;
  readonly ratings: BeyRatings;
  readonly handling: BeyHandlingProfile;
  readonly appearance: BeyAppearance;
}

/**
 * The single generic Bey every Milestone 1-5 self-test and scene exercised
 * — neutral (5/10) ratings, default handling, default mass, and the plain
 * placeholder mesh with no color override. createBey() defaults to this,
 * so anything that doesn't yet pass an explicit BeyDefinition keeps its
 * exact prior behavior.
 */
export const DEFAULT_BEY_DEFINITION: BeyDefinition = {
  id: 'default',
  name: 'Default',
  massKg: BEY_MASS_KG,
  ratings: NEUTRAL_BEY_RATINGS,
  handling: DEFAULT_HANDLING_PROFILE,
  appearance: { createVisual: () => createBeyMesh() },
};
