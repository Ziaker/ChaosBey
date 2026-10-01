// ============================================================
// PLAYER SETTINGS (M10, GDD 55/56/89/131)
// The options on the Settings screen, persisted per browser. Every one is
// presentation, comfort or input mapping: none changes what a fixed tick
// computes from its inputs (GDD 89: quality may only scale rendering/VFX
// cost, never simulation). The control scheme only changes which
// ControllerActions the player's devices produce, and those are what a
// replay records.
// Reading is forgiving: a missing, old or corrupted value falls back to
// its default field by field.
// ============================================================

import { DEFAULT_QUALITY_PRESET, QualityPreset } from '../runtime/QualityPreset';

/**
 * How the arrows / stick drive the Bey (M11, default revised 2026-10-01 —
 * "Fix 7" of the M11 playtest round, see screenDirection.ts's header for
 * the full history, including why "Fix 6"'s classic-by-default didn't
 * actually solve this).
 * - directional (default): camera-relative, read ONCE per gesture
 *   ("Fix 9") — ↑ goes away from the camera, →/← to its right/left, ↓
 *   toward it, as the camera is on the tick the player starts to move;
 *   that yaw stays frozen until every direction is released, so the
 *   automatic camera orbiting never steers the Bey ("só o jogador move o
 *   jogador"). The next press re-reads the camera, so the screen still
 *   reads right.
 * - classic: Bey-relative, kart-like — ←/→ steer the Bey's own heading,
 *   ↑/↓ accelerate/decelerate along it (turn rate, momentum, grip all
 *   still apply; this is not a snap-to-input). No camera dependency at
 *   all. Kept as a selectable option for a player who prefers it — proven
 *   in a real browser (2026-10-01) to still look "backwards" on screen
 *   about as often as it looks right, since this camera isn't a chase cam.
 */
export type ControlScheme = 'directional' | 'classic';
export const CONTROL_SCHEMES: readonly ControlScheme[] = ['directional', 'classic'];

/**
 * Combat camera (M11, docs/design-decisions/camera-approval.md): one of the
 * three approved presets — A Arena Fighter, B Cinematic Hybrid, C Hyper
 * Dynamic. Presentation only; the Clash always uses B without orbit.
 */
export type CameraPresetSetting = 'A' | 'B' | 'C';
export const CAMERA_PRESET_SETTINGS: readonly CameraPresetSetting[] = ['A', 'B', 'C'];

export interface PlayerSettings {
  readonly quality: QualityPreset;
  readonly cameraPreset: CameraPresetSetting;
  readonly controlScheme: ControlScheme;
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
  // B until the owner picks the first-time default (camera-approval.md 10.1 recommends B).
  cameraPreset: 'B',
  controlScheme: 'directional',
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
  const bool = (key: 'cameraEffects' | 'pauseOnFocusLoss' | 'controlHints' | 'debugOverlayOnStart'): boolean => (typeof input[key] === 'boolean' ? (input[key] as boolean) : (DEFAULT_PLAYER_SETTINGS[key] as boolean));
  const quality = Object.values(QualityPreset).find((q) => q === input.quality) ?? DEFAULT_PLAYER_SETTINGS.quality;
  const controlScheme = CONTROL_SCHEMES.find((c) => c === input.controlScheme) ?? DEFAULT_PLAYER_SETTINGS.controlScheme;
  const cameraPreset = CAMERA_PRESET_SETTINGS.find((c) => c === input.cameraPreset) ?? DEFAULT_PLAYER_SETTINGS.cameraPreset;
  return {
    quality,
    cameraPreset,
    controlScheme,
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
