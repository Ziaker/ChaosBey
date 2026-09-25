import { describe, expect, it } from 'vitest';
import { FIXED_DELTA_SECONDS, FixedTimestepLoop } from '../../src/physics/fixed-step/FixedTimestepLoop';

describe('FixedTimestepLoop.stepManyTicks', () => {
  it('runs exactly the requested number of fixed ticks with a constant delta', () => {
    const deltas: number[] = [];
    const loop = new FixedTimestepLoop({
      onFixedTick: (_tickIndex, fixedDeltaSeconds) => {
        deltas.push(fixedDeltaSeconds);
      },
      onRenderFrame: () => {},
    });

    loop.stepManyTicks(37);

    expect(deltas).toHaveLength(37);
    expect(new Set(deltas)).toEqual(new Set([FIXED_DELTA_SECONDS]));
    expect(loop.getTickIndex()).toBe(37);
  });

  it('passes a monotonically increasing tick index', () => {
    const seenIndices: number[] = [];
    const loop = new FixedTimestepLoop({
      onFixedTick: (tickIndex) => {
        seenIndices.push(tickIndex);
      },
      onRenderFrame: () => {},
    });

    loop.stepManyTicks(5);

    expect(seenIndices).toEqual([0, 1, 2, 3, 4]);
  });
});
