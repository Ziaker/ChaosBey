// The game's own defaults, for the browser specs (polish idea 8, owner 2026-10-07).
// Twelve specs failed on CI once because they spelled out the game's defaults (the default floor, camera, funnel depth,
// condition layers, the Settings storage key) and the owner had changed them weeks earlier. A spec that checks "the default
// is X" now asks the code for X here, so changing a default does not break a spec that only wants to know it is applied.
// A spec that is ABOUT a specific value (a rule, a rule's number) still writes it out: that is the point of the spec.
//
// Keep this file to pure values read from src/: it runs in Node under Playwright, never in the page.

import { DEFAULT_ARENA_FLOOR } from '../../src/arena/floor/ArenaFloorProfile';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { DEFAULT_PLAYER_SETTINGS, PLAYER_SETTINGS_STORAGE_KEY } from '../../src/config/settings/PlayerSettings';

const match = createDefaultMatchConfig();

export const GAME_DEFAULTS = {
  /** The floor the Pregame starts on ('bowl-b', the funnel). */
  arenaFloor: DEFAULT_ARENA_FLOOR,
  /** The Pregame's funnel depth, m. */
  bowlDepthM: match.arenaBowlDepthM,
  /** The camera preset Settings starts on ('A'). */
  cameraPreset: DEFAULT_PLAYER_SETTINGS.cameraPreset,
  /** The condition layers that start on (all three). */
  conditionLayers: DEFAULT_PLAYER_SETTINGS.conditionLayers,
  /** The quality preset Settings starts on. */
  quality: DEFAULT_PLAYER_SETTINGS.quality,
  /** localStorage key of the saved Settings (JSON of PlayerSettings). */
  settingsStorageKey: PLAYER_SETTINGS_STORAGE_KEY,
} as const;

/** The depth as the Pregame writes it: "8.50 m". */
export const bowlDepthText = (depthM: number = GAME_DEFAULTS.bowlDepthM): string => `${depthM.toFixed(2)} m`;

/** The floor ids in the order of the Pregame's floor buttons; `other` is a floor that is not the default, for a spec that switches. */
export const otherFloor = (not: string): 'bowl-a' | 'bowl-b' => (not === 'bowl-a' ? 'bowl-b' : 'bowl-a');
