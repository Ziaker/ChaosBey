import { describe, expect, it } from 'vitest';
import { ARENA_WALL_BOUNCE_RANGE, ARENA_WALL_HEIGHT_RANGE } from '../../src/arena/presets/ArenaPresets';
import { createDefaultMatchSetup, CLASH_IMPACT_RANGE, loadLastSetup } from '../../src/app/frontend/matchSetup';

function load(saved: unknown) {
  return loadLastSetup({ getItem: () => JSON.stringify(saved) });
}

describe('remembered Pregame selectors and arena geometry', () => {
  it('falls back to current defaults for unknown enum/select values instead of trusting old/corrupt storage', () => {
    const base = createDefaultMatchSetup();
    const loaded = load({
      ...base,
      ai: { tier: 'impossible-tier', style: 'impossible-style' },
      roundsToWin: 999,
      arena: { presetId: 'deleted-arena', geometry: { wallHeightM: 1, wallRestitution: 0.4, floor: 'deleted-floor' } },
      motion: 'deleted-motion',
    });

    expect(loaded).not.toBeNull();
    expect(loaded!.ai).toEqual(base.ai);
    expect(loaded!.roundsToWin).toBe(base.roundsToWin);
    expect(loaded!.arena).toEqual(base.arena);
    expect(loaded!.motion).toBe(base.motion);
  });

  it('clamps persisted Clash and custom arena wall numbers to the ranges the current Pregame exposes', () => {
    const base = createDefaultMatchSetup();
    const loaded = load({
      ...base,
      clashImpactMultiplier: 999,
      arena: {
        ...base.arena,
        geometry: {
          ...base.arena.geometry,
          wallHeightM: -999,
          wallRestitution: 999,
        },
      },
    });

    expect(loaded).not.toBeNull();
    expect(loaded!.clashImpactMultiplier).toBe(CLASH_IMPACT_RANGE.max);
    expect(loaded!.arena.geometry.wallHeightM).toBe(ARENA_WALL_HEIGHT_RANGE.min);
    expect(loaded!.arena.geometry.wallRestitution).toBe(ARENA_WALL_BOUNCE_RANGE.max);
  });

  it('rejects malformed persisted shapes instead of letting wrong types enter a match', () => {
    const base = createDefaultMatchSetup();
    const loaded = load({
      ...base,
      ai: { tier: null, style: 42 },
      roundsToWin: 'three',
      clashImpactMultiplier: 'maximum',
      arena: {
        presetId: base.arena.presetId,
        geometry: {
          wallHeightM: 'tall',
          wallRestitution: null,
          floor: 42,
        },
      },
      motion: 42,
    });

    expect(loaded).not.toBeNull();
    expect(loaded!.ai).toEqual(base.ai);
    expect(loaded!.roundsToWin).toBe(base.roundsToWin);
    expect(loaded!.clashImpactMultiplier).toBe(base.clashImpactMultiplier);
    expect(loaded!.arena).toEqual(base.arena);
    expect(loaded!.motion).toBe(base.motion);
  });
});
