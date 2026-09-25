// ============================================================
// RUNTIME CONFIG
// Single resolved source of truth for settings that affect how the app
// boots (GDD section 101/166: avoid competing sources of truth). This is
// NOT the per-match rules config (MatchRulesConfig/MovementConfig/etc.) —
// those are owned by their respective systems once those systems exist,
// and none of their numeric defaults are invented here (GDD section 167:
// exact balance values must be confirmed, not guessed).
// ============================================================

import { DEFAULT_QUALITY_PRESET, QualityPreset } from './QualityPreset';

export interface RuntimeConfig {
  qualityPreset: QualityPreset;
  /** Shows the debug overlay on boot. Independent of DebugLab screen access. */
  debugOverlayVisibleOnBoot: boolean;
}

export function createDefaultRuntimeConfig(): RuntimeConfig {
  return {
    qualityPreset: DEFAULT_QUALITY_PRESET,
    debugOverlayVisibleOnBoot: true,
  };
}
