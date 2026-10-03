import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VFX_OPTIONS,
  VFX_IMPACT_FLASH_RANGE,
  VFX_MOTION_TRAILS_RANGE,
} from '../../src/vfx/hybrid/intensityTiers';
import { ScreenOverlay } from '../../src/vfx/hybrid/ScreenOverlay';
import { makeHybrid } from '../../src/vfx/hybrid/languages/hybrid';
import type { FxContext } from '../../src/vfx/hybrid/languages/types';

/** Minimal language context: enough to exercise fastMove without a renderer/DOM. */
function fastMoveContext(motionTrailScale: number): { ctx: FxContext; layerAdds: () => number } {
  let adds = 0;
  const ctx = {
    scene: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    layer: { add: () => { adds++; } },
    sparks: { emit: () => undefined },
    floorHeightAt: () => 0,
    beyColor: () => new THREE.Color(0x55aaff),
    arenaSparks: [0xffe28a, 0xff7a1f] as const,
    shake: () => undefined,
    hitstop: () => undefined,
    slowMotion: () => undefined,
    impactFrame: () => undefined,
    focusLines: () => undefined,
    tint: () => undefined,
    flash: () => undefined,
    beyPos: () => new THREE.Vector3(),
    ghost: () => new THREE.Group(),
    motionTrailScale,
  } as unknown as FxContext;
  return { ctx, layerAdds: () => adds };
}

describe('Lote 10 visual options', () => {
  it('keeps the approved look at 100% and exposes the approved 0..150% playtest ranges', () => {
    expect(DEFAULT_VFX_OPTIONS.motionTrails).toBe(1);
    expect(DEFAULT_VFX_OPTIONS.impactFlash).toBe(1);
    expect(VFX_MOTION_TRAILS_RANGE).toEqual({ min: 0, max: 1.5, step: 0.05 });
    expect(VFX_IMPACT_FLASH_RANGE).toEqual({ min: 0, max: 1.5, step: 0.05 });
  });

  it('impact flash 0 really disables the negative frame while 100% preserves it', () => {
    const overlay = new ScreenOverlay(new THREE.PerspectiveCamera(), null);
    overlay.impactFrame(0.1, 0);
    expect(overlay.getStats().impactFrame).toBe(0);
    overlay.impactFrame(0.1, 1);
    expect(overlay.getStats().impactFrame).toBe(1);
    overlay.dispose();
  });

  it('motion trails 0 suppresses only the anime trail; the mechanical fast-move skid still runs', () => {
    const off = fastMoveContext(0);
    const on = fastMoveContext(1);
    const event = { pos: new THREE.Vector3(0, 0.3, 0), vel: new THREE.Vector3(12, 0, 0), m: 0.8, slot: 0 as const };

    makeHybrid('cel').create(off.ctx).fastMove(event, 1 / 60);
    makeHybrid('cel').create(on.ctx).fastMove(event, 1 / 60);

    // Mechanical fastMove always emits its first skid mark. Anime adds two trail sprites at the approved 100% setting.
    expect(off.layerAdds()).toBeGreaterThanOrEqual(1);
    expect(on.layerAdds() - off.layerAdds()).toBe(2);
  });
});
