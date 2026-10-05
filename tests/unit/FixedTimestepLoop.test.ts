import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('FixedTimestepLoop — a throwing callback', () => {
  // Drives the real rAF-based tick() by hand: stubbed requestAnimationFrame
  // just queues callbacks so each frame can be fired with a chosen timestamp.
  function stubAnimationFrames(): FrameRequestCallback[] {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => queued.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    return queued;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Regression: the next frame is only scheduled after the callbacks
  // return, so a throw used to kill the loop silently (frozen game, no
  // telemetry, no overlay message).
  it('stops and reports the error with the failing tick index, scheduling no further frames', () => {
    const queued = stubAnimationFrames();
    const reported: { error: unknown; tickIndex: number }[] = [];
    let calls = 0;
    const loop = new FixedTimestepLoop({
      onFixedTick: () => {
        calls++;
        if (calls === 3) throw new Error('boom');
      },
      onRenderFrame: () => {},
      onFatalError: (error, tickIndex) => reported.push({ error, tickIndex }),
    });

    loop.start();
    queued.shift()!(0); // first frame: establishes the clock, no ticks due.
    queued.shift()!(100); // ~6 ticks due; the 3rd one throws.

    expect(reported).toHaveLength(1);
    expect((reported[0]!.error as Error).message).toBe('boom');
    expect(reported[0]!.tickIndex).toBe(2);
    expect(queued).toHaveLength(0);
  });

  it('still stops, and rethrows, when no onFatalError handler is given', () => {
    const queued = stubAnimationFrames();
    const loop = new FixedTimestepLoop({
      onFixedTick: () => {},
      onRenderFrame: () => {
        throw new Error('render boom');
      },
    });

    loop.start();
    expect(() => queued.shift()!(0)).toThrow('render boom');
    expect(queued).toHaveLength(0);
  });
});

describe('FixedTimestepLoop — Game speed (owner, 2026-10-04: MatchConfig.gameSpeed)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** One real second of 60 Hz frames; returns the fixed ticks run and the summed render-frame delta. */
  function oneRealSecond(timeScale: number): { ticks: number; renderedS: number } {
    const queued: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => queued.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let ticks = 0;
    let renderedS = 0;
    const loop = new FixedTimestepLoop({ onFixedTick: () => ticks++, onRenderFrame: (dt) => (renderedS += dt) }, timeScale);
    loop.start();
    for (let frame = 0; frame <= 60; frame++) queued.shift()!((frame * 1000) / 60);
    loop.stop();
    return { ticks, renderedS };
  }

  it('×1.2 runs 20% more fixed ticks per real second, never a bigger step, and scales the render delta the same', () => {
    const normal = oneRealSecond(1);
    const fast = oneRealSecond(1.2);
    expect(normal.ticks).toBeGreaterThanOrEqual(59);
    expect(normal.ticks).toBeLessThanOrEqual(60);
    expect(fast.ticks).toBeGreaterThanOrEqual(71);
    expect(fast.ticks).toBeLessThanOrEqual(72);
    expect(normal.renderedS).toBeCloseTo(1, 6);
    expect(fast.renderedS).toBeCloseTo(1.2, 6);
  });
});
