// ============================================================
// QUALITY — APPLYING A PRESET TO THE RENDERER (M10, GDD 55/89)
// Render cost only: the device pixel ratio cap here, speed trails in the
// match (MatchRunner.setPresentation). The simulation never sees it.
// ============================================================

import type { AppRenderer } from '../bootstrap/createRenderer';
import { QUALITY_PROFILES, type PlayerSettings } from '../../config/settings/PlayerSettings';
import type { MatchPresentation } from './MatchRunner';
import { setBeyModelDetail } from '../../bey/visual/model/geometry';

export function applyQuality(appRenderer: AppRenderer, settings: PlayerSettings): void {
  appRenderer.setPixelRatioCap(QUALITY_PROFILES[settings.quality].maxPixelRatio);
  setBeyModelDetail(QUALITY_PROFILES[settings.quality].modelDetail);
}

export function presentationFor(settings: PlayerSettings): MatchPresentation {
  return {
    cameraEffects: settings.cameraEffects,
    trails: QUALITY_PROFILES[settings.quality].trails,
    cameraPreset: settings.cameraPreset,
    conditionLayers: settings.conditionLayers,
    feel: { hitFlash: settings.hitFlash, hitShake: settings.hitShake, counterFeedback: settings.counterFeedback },
    flowFx: settings.flowFx,
    performance: { adaptiveResolution: settings.adaptiveResolution, frameLimit: settings.frameLimit, renderScaleRange: QUALITY_PROFILES[settings.quality].renderScaleRange },
  };
}
