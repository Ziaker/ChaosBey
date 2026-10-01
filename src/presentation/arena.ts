// ============================================================
// ARENA: PHYSICS DEFINITION ≠ VISUAL DEFINITION
// An ArenaPreset (arena/presets/ArenaPresets.ts) already keeps what the arena
// IS (wall height, wall bounce, floor profile: they build colliders and travel
// in MatchConfig and replays) apart from how it LOOKS (the theme). These views
// make that split explicit and type-checked, so arena art that arrives later
// is written against ArenaVisualDefinition and cannot reach the collider, the
// bowl equation, the playable area or the ring-out region.
//
// Not changed here: createArenaColliders still builds the colliders and the
// current arena meshes in one call (one function, two outputs). Separating
// that function is deferred to the arena-art integration; see
// docs/planning/PROTOTYPE_INTEGRATION_MAP.md.
// ============================================================

import type { ArenaGeometry, ArenaPreset, ArenaPresetId, ArenaTheme } from '../arena/presets/ArenaPresets';

/** Everything about an arena that the simulation reads. */
export interface ArenaPhysicsDefinition {
  readonly geometry: ArenaGeometry;
}

/** Everything about an arena that only the renderer reads. Never reaches a collider. */
export interface ArenaVisualDefinition {
  readonly id: ArenaPresetId;
  readonly label: string;
  readonly description: string;
  readonly theme: ArenaTheme;
}

/** What createMatchScene is given: the two halves put back together. */
export interface ComposedArena {
  readonly geometry: ArenaGeometry;
  readonly theme: ArenaTheme;
}

export function arenaPhysicsDefinition(preset: ArenaPreset): ArenaPhysicsDefinition {
  return { geometry: preset.geometry };
}

export function arenaVisualDefinition(preset: ArenaPreset): ArenaVisualDefinition {
  return { id: preset.id, label: preset.label, description: preset.description, theme: preset.theme };
}

export function composeArena(physics: ArenaPhysicsDefinition, visual: ArenaVisualDefinition): ComposedArena {
  return { geometry: physics.geometry, theme: visual.theme };
}
