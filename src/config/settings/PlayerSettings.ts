// ============================================================
// PLAYER SETTINGS (M10, GDD 55/56/89/131)
// The options on the Settings screen, persisted per browser. Every one is
// presentation or comfort: none changes what a fixed tick computes (GDD
// 89: quality may only scale rendering/VFX cost, never simulation).
// Reading is forgiving: a missing, old or corrupted value falls back to
// its default field by field.
// ============================================================

import { DEFAULT_QUALITY_PRESET, QualityPreset } from '../runtime/QualityPreset';

export interface PlayerSettings {
  readonly quality: QualityPreset;
  /** Camera shake and the speed/impact FOV kick (off = steadier camera). */
  readonly cameraEffects: boolean;
  /** Pause the match when the window or tab loses focus (GDD 131). */
  readonly pauseOnFocusLoss: boolean;
  /** Control hints on the combat HUD. */
  readonly controlHints: boolean;
  /** The F3 developer overlay open when the player flow starts. */
  readonly debugOverlayOnStart: boolean;
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  quality: DEFAULT_QUALITY_PRESET,
  cameraEffects: true,
  pauseOnFocusLoss: true,
  controlHints: true,
  debugOverlayOnStart: false,
};

/** What each quality preset changes. Render cost only. */
export interface QualityProfile {
  /** Cap on the renderer's device pixel ratio. */
  readonly maxPixelRatio: number;
  /** Speed trails behind the Beys. */
  readonly trails: boolean;
}

export const QUALITY_PROFILES: Readonly<Record<QualityPreset, QualityProfile>> = {
  [QualityPreset.Low]: { maxPixelRatio: 1, trails: false },
  [QualityPreset.Medium]: { maxPixelRatio: 1.5, trails: true },
  [QualityPreset.High]: { maxPixelRatio: 2, trails: true },
};

/** Field-by-field validation: anything unusable becomes the default. */
export function sanitizePlayerSettings(value: unknown): PlayerSettings {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const bool = (key: keyof PlayerSettings): boolean => (typeof input[key] === 'boolean' ? (input[key] as boolean) : (DEFAULT_PLAYER_SETTINGS[key] as boolean));
  const quality = Object.values(QualityPreset).find((q) => q === input.quality) ?? DEFAULT_PLAYER_SETTINGS.quality;
  return {
    quality,
    cameraEffects: bool('cameraEffects'),
    pauseOnFocusLoss: bool('pauseOnFocusLoss'),
    controlHints: bool('controlHints'),
    debugOverlayOnStart: bool('debugOverlayOnStart'),
  };
}

const STORAGE_KEY = 'chaosbey.settings.player.v1';

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadPlayerSettings(): PlayerSettings {
  const storage = getStorage();
  if (!storage) return DEFAULT_PLAYER_SETTINGS;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? sanitizePlayerSettings(JSON.parse(raw)) : DEFAULT_PLAYER_SETTINGS;
  } catch {
    return DEFAULT_PLAYER_SETTINGS;
  }
}

export function savePlayerSettings(settings: PlayerSettings): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full/unavailable: the setting just doesn't persist this session.
  }
}
