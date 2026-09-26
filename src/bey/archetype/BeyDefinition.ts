// ============================================================
// BEY DEFINITION — COMBINED ARCHETYPE DATA (MILESTONE 6)
// Everything createBey() needs to build one concrete Bey: its identity,
// physical mass, gameplay Stats, movement Handling, and (separately,
// decoupled) visual Appearance. Loaders/factories elsewhere just select
// one of these — no system outside this package decides archetype numbers
// itself (GDD section 1.4).
// ============================================================

import type { BeyAppearance } from './BeyAppearance';
import { DEFAULT_HANDLING_PROFILE, type BeyHandlingProfile } from './BeyHandlingProfile';
import { NEUTRAL_BEY_STATS, type BeyStats } from './BeyStats';
import { BEY_MASS_KG } from '../core/BeyTuning';
import { createBeyMesh } from '../procedural-model/createBeyMesh';

export interface BeyDefinition {
  readonly id: string;
  readonly name: string;
  readonly massKg: number;
  readonly stats: BeyStats;
  readonly handling: BeyHandlingProfile;
  readonly appearance: BeyAppearance;
}

/**
 * The single generic Bey every Milestone 1-5 self-test and scene exercised
 * — neutral stats, default handling, default mass, and the plain
 * placeholder mesh with no color override. createBey() defaults to this,
 * so anything that doesn't yet pass an explicit BeyDefinition keeps its
 * exact prior behavior.
 */
export const DEFAULT_BEY_DEFINITION: BeyDefinition = {
  id: 'default',
  name: 'Default',
  massKg: BEY_MASS_KG,
  stats: NEUTRAL_BEY_STATS,
  handling: DEFAULT_HANDLING_PROFILE,
  appearance: { createVisual: () => createBeyMesh() },
};
