// ============================================================
// QUALITY — APPLYING A PRESET TO THE RENDERER (M10, GDD 55/89)
// Render cost only: the device pixel ratio cap here, speed trails in the
// match (MatchRunner.setPresentation). The simulation never sees it.
// ============================================================

import type { AppRenderer } from '../bootstrap/createRenderer';
import { QUALITY_PROFILES, type PlayerSettings } from '../../config/settings/PlayerSettings';
import type { MatchPresentation } from './MatchRunner';

export function applyQuality(appRenderer: AppRenderer, settings: PlayerSettings): void {
  const { renderer } = appRenderer;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY_PROFILES[settings.quality].maxPixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
}

export function presentationFor(settings: PlayerSettings): MatchPresentation {
  return { cameraEffects: settings.cameraEffects, trails: QUALITY_PROFILES[settings.quality].trails };
}
