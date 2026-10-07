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
 * How the arrows / stick drive the Bey. All four are selectable; the first
 * three never depend on the presentation camera (the camera is downstream
 * of gameplay and never moves the Bey — docs/design-decisions/
 * camera-gameplay-separation.md).
 * - opponent (default): ↑ goes toward the opponent, ↓ away, ←/→ circle
 *   around them. Derived from gameplay positions only.
 * - classic: Bey-relative, kart-like — ←/→ steer the Bey's own heading,
 *   ↑/↓ accelerate/decelerate along it (turn rate, momentum, grip all
 *   still apply; this is not a snap-to-input).
 * - arena: ↑ = fixed arena direction (−Z), → = +X, whichever way the
 *   camera is facing.
 * - screen: ↑ goes "up the screen" as the camera is when you start to move;
 *   frozen until every direction is released. This is the only opt-in
 *   scheme that reads the camera, and it is never the default.
 */
export type ControlScheme = 'opponent' | 'classic' | 'arena' | 'screen';
export const CONTROL_SCHEMES: readonly ControlScheme[] = ['opponent', 'classic', 'arena', 'screen'];

/**
 * Combat camera (M11, docs/design-decisions/camera-approval.md): one of the
 * three approved presets — A Arena Fighter, B Cinematic Hybrid, C Hyper
 * Dynamic. Presentation only; the Clash always uses B without orbit.
 */
export type CameraPresetSetting = 'A' | 'B' | 'C';
export const CAMERA_PRESET_SETTINGS: readonly CameraPresetSetting[] = ['A', 'B', 'C'];

/**
 * Stamina / Stability / Broken languages (condition-visual-approval.md): A Desgaste Mecânico, B Aura de Espírito,
 * C Instrumento no Chão. The player may show any combination of 1, 2 or 3 (never none); the shared physical layer is always on.
 * Used while the `conditionVisuals` presentation flag is on, which it is in the normal game (src/presentation/features.ts);
 * with it off (an explicit `?pfx` allowlist without it) the Settings screen does not show the section.
 */
export type ConditionLayerSetting = 'A' | 'B' | 'C';
export const CONDITION_LAYER_SETTINGS: readonly ConditionLayerSetting[] = ['A', 'B', 'C'];
/**
 * PROVISIONAL implementation default, not an owner choice between A/B/C (ASK FIRST): the first-time default for new players
 * is the owner's to pick. A alone is a neutral placeholder; Reset to defaults returns here.
 */
/** Owner, 2026-10-04: all three on in the base game. */
export const DEFAULT_CONDITION_LAYERS: readonly ConditionLayerSetting[] = ['A', 'B', 'C'];

/** Turns one condition layer on or off. The last layer on cannot be turned off: at least one always shows. */
export function toggleConditionLayer(layers: readonly ConditionLayerSetting[], id: ConditionLayerSetting, on: boolean): readonly ConditionLayerSetting[] {
  const next = CONDITION_LAYER_SETTINGS.filter((layer) => (layer === id ? on : layers.includes(layer)));
  return next.length > 0 ? next : layers;
}

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
  /** Which condition languages show (at least one). Presentation only; needs the `conditionVisuals` flag. */
  readonly conditionLayers: readonly ConditionLayerSetting[];
  // Owner, 2026-10-05 (game feel, "implemente tudo exceto som e vibração"). Presentation only: none changes the match.
  /** A Circular that catches a Dash shows its own burst and "COUNTER!" instead of a plain hit. */
  readonly counterFeedback: boolean;
  /** The Bey that takes a hit flashes for a moment. */
  readonly hitFlash: boolean;
  /** The Bey that takes a hit shakes in place while the hit freezes the match. */
  readonly hitShake: boolean;
  /** The screen edges glow red while the player's Bey is near the ring-out line or flying out. */
  readonly ringOutWarning: boolean;
  /** A Dodge or Attack press the game refuses (not ready) makes its HUD line flash and shake. */
  readonly refusedInputFeedback: boolean;
}

/** The game-feel toggles (all on by default). */
export const GAME_FEEL_SETTING_KEYS = ['counterFeedback', 'hitFlash', 'hitShake', 'ringOutWarning', 'refusedInputFeedback'] as const;
export type GameFeelSettingKey = (typeof GAME_FEEL_SETTING_KEYS)[number];

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  quality: DEFAULT_QUALITY_PRESET,
  // B until the owner picks the first-time default (camera-approval.md 10.1 recommends B).
  // Owner, 2026-10-04: Arena Fighter is the game's base camera.
  cameraPreset: 'A',
  // New installs start on a camera-independent scheme. All four remain selectable.
  // Owner, 2026-10-04: Screen (reads camera) is the game's one control scheme; the others and the option are gone.
  controlScheme: 'screen',
  cameraEffects: true,
  pauseOnFocusLoss: true,
  controlHints: true,
  debugOverlayOnStart: false,
  conditionLayers: DEFAULT_CONDITION_LAYERS,
  counterFeedback: true,
  hitFlash: true,
  hitShake: true,
  ringOutWarning: true,
  refusedInputFeedback: true,
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
  const bool = (key: 'cameraEffects' | 'pauseOnFocusLoss' | 'controlHints' | 'debugOverlayOnStart' | GameFeelSettingKey): boolean => (typeof input[key] === 'boolean' ? (input[key] as boolean) : (DEFAULT_PLAYER_SETTINGS[key] as boolean));
  const quality = Object.values(QualityPreset).find((q) => q === input.quality) ?? DEFAULT_PLAYER_SETTINGS.quality;
  // Before the four-scheme model, `directional` meant the screen-relative,
  // once-per-gesture camera reference. Preserve that saved behaviour by
  // migrating it explicitly to `screen`; new/missing settings still use
  // the camera-independent default above.
  // Owner, 2026-10-04: only Screen (reads camera) — any saved scheme becomes it.
  const controlScheme: ControlScheme = 'screen';
  const cameraPreset = CAMERA_PRESET_SETTINGS.find((c) => c === input.cameraPreset) ?? DEFAULT_PLAYER_SETTINGS.cameraPreset;
  const picked = Array.isArray(input.conditionLayers) ? CONDITION_LAYER_SETTINGS.filter((id) => (input.conditionLayers as unknown[]).includes(id)) : [];
  const conditionLayers = picked.length > 0 ? picked : DEFAULT_CONDITION_LAYERS;
  return {
    quality,
    cameraPreset,
    controlScheme,
    cameraEffects: bool('cameraEffects'),
    pauseOnFocusLoss: bool('pauseOnFocusLoss'),
    controlHints: bool('controlHints'),
    debugOverlayOnStart: bool('debugOverlayOnStart'),
    conditionLayers,
    counterFeedback: bool('counterFeedback'),
    hitFlash: bool('hitFlash'),
    hitShake: bool('hitShake'),
    ringOutWarning: bool('ringOutWarning'),
    refusedInputFeedback: bool('refusedInputFeedback'),
  };
}

/** Where the Settings are saved (the browser smoke specs read it from here, not from a copy: it changed once already, v1 → v2). */
export const PLAYER_SETTINGS_STORAGE_KEY = 'chaosbey.settings.player.v2';
const STORAGE_KEY = PLAYER_SETTINGS_STORAGE_KEY;
const LEGACY_STORAGE_KEY = 'chaosbey.settings.player.v1';

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
    if (raw) return sanitizePlayerSettings(JSON.parse(raw));
    // Owner, 2026-10-04: settings saved before the new base (v1) keep their quality/toggles, but start on the new
    // base camera (Arena Fighter) with every condition layer on.
    const old = storage.getItem(LEGACY_STORAGE_KEY);
    if (!old) return DEFAULT_PLAYER_SETTINGS;
    return sanitizePlayerSettings({ ...JSON.parse(old), cameraPreset: DEFAULT_PLAYER_SETTINGS.cameraPreset, conditionLayers: DEFAULT_PLAYER_SETTINGS.conditionLayers });
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
