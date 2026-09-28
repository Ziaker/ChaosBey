import { describe, expect, it } from 'vitest';
import { SeededRng, createRngStreams } from '../../src/rng/SeededRng';
import { normalizeSeedText } from '../../src/rng/stringSeed';

describe('SeededRng', () => {
  it('produces an identical sequence for the same seed text', () => {
    const a = SeededRng.fromSeedText('chaosbey-test-seed');
    const b = SeededRng.fromSeedText('chaosbey-test-seed');

    const sequenceA = Array.from({ length: 20 }, () => a.nextFloat());
    const sequenceB = Array.from({ length: 20 }, () => b.nextFloat());

    expect(sequenceA).toEqual(sequenceB);
  });

  it('produces different sequences for different seeds', () => {
    const a = SeededRng.fromSeedText('seed-one');
    const b = SeededRng.fromSeedText('seed-two');

    expect(a.nextFloat()).not.toEqual(b.nextFloat());
  });

  it('always returns floats within [0, 1)', () => {
    const rng = SeededRng.fromSeedText('range-check');
    for (let i = 0; i < 1000; i++) {
      const value = rng.nextFloat();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('nextInt is inclusive of both bounds', () => {
    const rng = SeededRng.fromSeedText('int-bounds');
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      seen.add(rng.nextInt(1, 3));
    }
    expect(seen.has(1)).toBe(true);
    expect(seen.has(2)).toBe(true);
    expect(seen.has(3)).toBe(true);
    for (const value of seen) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(3);
    }
  });

  it('treats a plain numeric seed as a literal value', () => {
    expect(normalizeSeedText('1234').seedUint32).toBe(1234);
  });

  it('normalizes non-numeric seed text deterministically', () => {
    const first = normalizeSeedText('some-uuid-like-1234');
    const second = normalizeSeedText('some-uuid-like-1234');
    expect(first.seedUint32).toBe(second.seedUint32);
  });
});

describe('createRngStreams', () => {
  it('derives independent, deterministic streams from one match seed', () => {
    const streamsA = createRngStreams('match-seed-1');
    const streamsB = createRngStreams('match-seed-1');

    expect(streamsA.gameplay.nextFloat()).toEqual(streamsB.gameplay.nextFloat());
    expect(streamsA.aiFirst.nextFloat()).toEqual(streamsB.aiFirst.nextFloat());
    expect(streamsA.aiSecond.nextFloat()).toEqual(streamsB.aiSecond.nextFloat());
    expect(streamsA.cosmetic.nextFloat()).toEqual(streamsB.cosmetic.nextFloat());
  });

  it('gameplay, ai:first, ai:second and cosmetic streams do not produce identical sequences', () => {
    const streams = createRngStreams('match-seed-2');
    const values = [streams.gameplay.nextFloat(), streams.aiFirst.nextFloat(), streams.aiSecond.nextFloat(), streams.cosmetic.nextFloat()];

    expect(new Set(values).size).toBe(4);
  });

  it('RNG scheme 2: extra draws by one AI side never shift the other side\'s sequence', () => {
    const quiet = createRngStreams('match-seed-3');
    const busy = createRngStreams('match-seed-3');
    for (let i = 0; i < 17; i++) busy.aiFirst.nextFloat();

    const quietSecond = Array.from({ length: 5 }, () => quiet.aiSecond.nextFloat());
    const busySecond = Array.from({ length: 5 }, () => busy.aiSecond.nextFloat());
    expect(busySecond).toEqual(quietSecond);
  });

  it('getState() exposes the generator state without advancing it', () => {
    const rng = SeededRng.fromSeedText('state-read');
    const before = rng.getState();
    expect(rng.getState()).toBe(before);
    rng.nextFloat();
    expect(rng.getState()).not.toBe(before);
    expect(Number.isInteger(rng.getState()) && rng.getState() >= 0 && rng.getState() <= 0xffffffff).toBe(true);
  });

  it('rootSeedText is the reusable match seed, not any individual stream\'s own (salted) canonical seed', () => {
    // Regression test: the debug overlay/UI must display and persist
    // rootSeedText, never `streams.gameplay.getCanonicalSeedText()` (that
    // getter reports the *derived*, salted seed for that one stream, which
    // is not the value that reproduces the match when re-entered).
    const streams = createRngStreams('1234');

    expect(streams.rootSeedText).toBe('1234');
    expect(streams.gameplay.getCanonicalSeedText()).not.toBe(streams.rootSeedText);
    expect(streams.aiFirst.getCanonicalSeedText()).not.toBe(streams.rootSeedText);
    expect(streams.aiSecond.getCanonicalSeedText()).not.toBe(streams.rootSeedText);
    expect(streams.cosmetic.getCanonicalSeedText()).not.toBe(streams.rootSeedText);
  });

  it('re-deriving streams from the persisted rootSeedText reproduces the exact same streams', () => {
    const original = createRngStreams('some-uuid-like-1234');
    const reproduced = createRngStreams(original.rootSeedText);

    expect(reproduced.gameplay.nextFloat()).toEqual(original.gameplay.nextFloat());
    expect(reproduced.aiFirst.nextFloat()).toEqual(original.aiFirst.nextFloat());
    expect(reproduced.aiSecond.nextFloat()).toEqual(original.aiSecond.nextFloat());
    expect(reproduced.cosmetic.nextFloat()).toEqual(original.cosmetic.nextFloat());
  });
});
