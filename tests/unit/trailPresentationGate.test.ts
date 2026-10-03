import { describe, expect, it } from 'vitest';
import { MatchRunner, type MatchPresentation } from '../../src/app/frontend/MatchRunner';
import { DEFAULT_VFX_OPTIONS } from '../../src/vfx/hybrid/intensityTiers';

interface VfxCall {
  readonly kind: 'scale' | 'visible';
  readonly value: number | boolean;
}

function fakeRunner(): { runner: MatchRunner; calls: VfxCall[] } {
  const calls: VfxCall[] = [];
  const vfx = {
    setTrailIntensity: (scale: number) => calls.push({ kind: 'scale', value: scale }),
    setLayerVisible: (layer: string, visible: boolean) => {
      if (layer === 'trails') calls.push({ kind: 'visible', value: visible });
    },
  };
  const session = {
    getVfxManager: () => vfx,
    setCameraPreset: () => undefined,
    setConditionLayers: () => undefined,
  };
  const runner = Object.create(MatchRunner.prototype) as MatchRunner;
  Object.defineProperty(runner, 'session', { value: session, configurable: true });
  return { runner, calls };
}

function presentation(trails: boolean, motionTrails: number): MatchPresentation {
  return {
    cameraEffects: true,
    trails,
    vfx: { ...DEFAULT_VFX_OPTIONS, motionTrails },
  };
}

describe('Motion trails Pregame × Quality composition', () => {
  it('keeps Low/Quality=false as the hard performance gate even at 150%', () => {
    const { runner, calls } = fakeRunner();
    runner.setPresentation(presentation(false, 1.5));
    expect(calls).toEqual([
      { kind: 'scale', value: 1.5 },
      { kind: 'visible', value: false },
    ]);
  });

  it('lets Pregame 0 disable the trail even when Quality permits it', () => {
    const { runner, calls } = fakeRunner();
    runner.setPresentation(presentation(true, 0));
    expect(calls).toEqual([
      { kind: 'scale', value: 0 },
      { kind: 'visible', value: false },
    ]);
  });

  it('shows the layer only when both Quality and Pregame permit it', () => {
    const { runner, calls } = fakeRunner();
    runner.setPresentation(presentation(true, 1));
    expect(calls).toEqual([
      { kind: 'scale', value: 1 },
      { kind: 'visible', value: true },
    ]);
  });
});
