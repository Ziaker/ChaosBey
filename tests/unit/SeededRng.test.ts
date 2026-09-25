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
    expect(streamsA.ai.nextFloat()).toEqual(streamsB.ai.nextFloat());
    expect(streamsA.cosmetic.nextFloat()).toEqual(streamsB.cosmetic.nextFloat());
  });

  it('gameplay, ai and cosmetic streams do not produce identical sequences', () => {
    const streams = createRngStreams('match-seed-2');
    const gameplayFirst = streams.gameplay.nextFloat();
    const aiFirst = streams.ai.nextFloat();
    const cosmeticFirst = streams.cosmetic.nextFloat();

    expect(new Set([gameplayFirst, aiFirst, cosmeticFirst]).size).toBe(3);
  });
});
