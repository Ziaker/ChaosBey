// ============================================================
// ARENA PRESETS (M10, GDD 35/36: presets plus selected sliders)
// The three approved arena directions (VISUAL_APPROVALS_MASTER.md 4.2),
// each a render-only theme plus the two arena values the Pregame sliders
// expose: wall height and wall bounce. Those two are gameplay (they build
// the wall colliders), so they travel in MatchConfig and replays; the theme
// never touches the simulation.
//
// Foundry Pit is the default and uses exactly the arena every earlier
// milestone played (ArenaTuning / PhysicsMaterials), so default matches,
// tests and replays are unchanged. The owner left the default arena open;
// M10's authorization picks the one that changes nothing.
//
// The themes are a first integration of the approved directions' palettes
// on the current flat arena, not the approved bowl geometry (whose gravity/
// ring-out consequences are a separate gameplay decision, 4.3).
// ============================================================

import type { ArenaFloorId } from '../floor/ArenaFloorProfile';
import { ARENA_WALL_HEIGHT } from '../colliders/ArenaTuning';
import { WALL_MATERIAL } from '../../physics/materials/PhysicsMaterials';

export type ArenaPresetId = 'foundry' | 'rift' | 'tournament';

/** What the arena looks like. Render only. */
export interface ArenaTheme {
  readonly backgroundHex: number;
  readonly floorHex: number;
  readonly floorRoughness: number;
  readonly floorMetalness: number;
  /** Rings painted on the floor (lane markings / fissures / LED rings). */
  readonly floorLineHex: number;
  readonly floorLineOpacity: number;
  readonly wallHex: number;
  readonly wallOpacity: number;
  /** Emissive trim along the top of the wall. */
  readonly rimHex: number;
  readonly skyHex: number;
  readonly groundHex: number;
  readonly hemisphereIntensity: number;
  readonly sunHex: number;
  readonly sunIntensity: number;
  /** Contact sparks, hot → cool (the Arena Concept Lab's `sparkColors` for this arena). */
  readonly sparkHotHex: number;
  readonly sparkCoolHex: number;
}

/** The two arena values a match is built with (MatchConfig fields). */
export interface ArenaGeometry {
  readonly wallHeightM: number;
  readonly wallRestitution: number;
  /** M11 lane 4: floor profile (flat, or an approved bowl for playtest). Omitted = flat. The wall height is measured from the rim. */
  readonly floor?: ArenaFloorId;
  /** Lote 9 (item 3): bowl depth (m, rim above centre). Omitted = BOWL_DEPTH_M (2.5 m). */
  readonly floorDepthM?: number;
  /** Owner, 2026-10-04: stage size, × the 36 m floor radius. Omitted = 1. */
  readonly sizeScale?: number;
}

export interface ArenaPreset {
  readonly id: ArenaPresetId;
  readonly label: string;
  readonly description: string;
  readonly geometry: ArenaGeometry;
  readonly theme: ArenaTheme;
}

/** The arena every milestone before M10 played. */
/** Owner base rules, 2026-10-04: 2.0 m walls with a 0.80 bounce (was the wall material's 0.55). */
export const STANDARD_ARENA_GEOMETRY: ArenaGeometry = { wallHeightM: ARENA_WALL_HEIGHT, wallRestitution: 0.8 };

/** Slider ranges on the Pregame screen. */
export const ARENA_WALL_HEIGHT_RANGE = { min: 0.6, max: 10, step: 0.2 } as const;
export const ARENA_WALL_BOUNCE_RANGE = { min: 0.2, max: 0.9, step: 0.05 } as const;

export const FOUNDRY_PIT: ArenaPreset = {
  id: 'foundry',
  label: 'Foundry Pit',
  description: 'Riveted steel under warm work lights. Standard walls and a solid, readable bounce.',
  geometry: STANDARD_ARENA_GEOMETRY,
  theme: {
    backgroundHex: 0x0d0906,
    floorHex: 0x3a3632,
    floorRoughness: 0.55,
    floorMetalness: 0.65,
    floorLineHex: 0xffa040,
    floorLineOpacity: 0.35,
    wallHex: 0x5a4a3c,
    wallOpacity: 1,
    rimHex: 0xff8a2a,
    sparkHotHex: 0xffe28a,
    sparkCoolHex: 0xff6a14,
    skyHex: 0xffc28a,
    groundHex: 0x1a120c,
    hemisphereIntensity: 1.1,
    sunHex: 0xffd6a8,
    sunIntensity: 1.7,
  },
};

export const RIFT_CRATER: ArenaPreset = {
  id: 'rift',
  label: 'Rift Crater',
  description: 'Basalt cracked with violet light under a night sky. A low rim that soaks up impacts: ring-outs come easier.',
  geometry: { wallHeightM: 1, wallRestitution: 0.4 },
  theme: {
    backgroundHex: 0x05040d,
    floorHex: 0x1c1a24,
    floorRoughness: 0.95,
    floorMetalness: 0.05,
    floorLineHex: 0xa45cff,
    floorLineOpacity: 0.5,
    wallHex: 0x26222e,
    wallOpacity: 1,
    rimHex: 0x7ce8ff,
    sparkHotHex: 0xd9ccff,
    sparkCoolHex: 0x7f5cff,
    skyHex: 0x8a7cff,
    groundHex: 0x07050c,
    hemisphereIntensity: 0.9,
    sunHex: 0xc8c0ff,
    sunIntensity: 1.2,
  },
};

export const TOURNAMENT_STADIUM: ArenaPreset = {
  id: 'tournament',
  label: 'Tournament Stadium',
  description: 'Bright e-sports floor behind a tall polycarbonate barrier that sends you flying back in.',
  geometry: { wallHeightM: 2.6, wallRestitution: 0.7 },
  theme: {
    backgroundHex: 0x0a0c12,
    floorHex: 0xc9ced8,
    floorRoughness: 0.35,
    floorMetalness: 0.1,
    floorLineHex: 0x2a6cff,
    floorLineOpacity: 0.45,
    wallHex: 0xbfe6ff,
    wallOpacity: 0.35,
    rimHex: 0xffffff,
    sparkHotHex: 0xffffff,
    sparkCoolHex: 0xffc94a,
    skyHex: 0xe8eeff,
    groundHex: 0x303440,
    hemisphereIntensity: 1.25,
    sunHex: 0xffffff,
    sunIntensity: 1.9,
  },
};

export const ARENA_PRESETS: readonly ArenaPreset[] = [FOUNDRY_PIT, RIFT_CRATER, TOURNAMENT_STADIUM];

export const DEFAULT_ARENA_PRESET: ArenaPresetId = 'foundry';

export function arenaPreset(id: ArenaPresetId): ArenaPreset {
  const preset = ARENA_PRESETS.find((p) => p.id === id);
  if (!preset) throw new Error(`ArenaPresets: unknown arena "${id}".`);
  return preset;
}

/** True when `geometry` is exactly the preset's own values (the sliders weren't moved). */
export function isPresetGeometry(id: ArenaPresetId, geometry: ArenaGeometry): boolean {
  const own = arenaPreset(id).geometry;
  return own.wallHeightM === geometry.wallHeightM && own.wallRestitution === geometry.wallRestitution;
}
