// ============================================================
// ARENA ART — THE THREE APPROVED ARENAS, BY PRESET
// The approved Foundry Pit, Rift Crater and Tournament Stadium looks, keyed by
// the ArenaPreset id they dress. Visual only: the art is built from a floor
// height function and never reaches a collider, the bowl equation, the playable
// area or the ring-out region (src/presentation/arena.ts).
// ============================================================

import type { ArenaPresetId } from '../presets/ArenaPresets';
import { FOUNDRY_PIT as FOUNDRY_PIT_ART } from './foundryPit';
import { RIFT_CRATER as RIFT_CRATER_ART } from './riftCrater';
import { TOURNAMENT_STADIUM as TOURNAMENT_STADIUM_ART } from './tournamentStadium';
import type { ArenaConcept } from './types';

export const ARENA_ART: Readonly<Record<ArenaPresetId, ArenaConcept>> = {
  foundry: FOUNDRY_PIT_ART,
  rift: RIFT_CRATER_ART,
  tournament: TOURNAMENT_STADIUM_ART,
};

export function arenaArtFor(presetId: ArenaPresetId): ArenaConcept {
  return ARENA_ART[presetId];
}
