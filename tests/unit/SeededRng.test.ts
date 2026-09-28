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

  it('gameplay, aiFirst, aiSecond and cosmetic streams do not produce identical sequences', () => {
    const streams = createRngStreams('match-seed-2');
    const gameplayFirst = streams.gameplay.nextFloat();
    const aiFirst = streams.aiFirst.nextFloat();
    const aiSecond = streams.aiSecond.nextFloat();
    const cosmeticFirst = streams.cosmetic.nextFloat();

    expect(new Set([gameplayFirst, aiFirst, aiSecond, cosmeticFirst]).size).toBe(4);
  });

  it('RNG schema v2: aiFirst and aiSecond are independent streams — draining one leaves the other untouched', () => {
    // This is the actual bug schema v2 fixes: MatchSession used to wire the
    // same single `ai` stream to both sides' AIController, so one side's
    // decision cadence silently advanced the draws the other side would
    // read next. aiFirst/aiSecond must never be the same instance, and
    // consuming one must not perturb the other's sequence at all.
    const streams = createRngStreams('match-seed-schema-v2');
    const untouchedFirstSequence = Array.from({ length: 10 }, () => streams.aiFirst.nextFloat());

    const control = createRngStreams('match-seed-schema-v2');
    // Drain aiSecond heavily on the control instance; aiFirst must be unaffected.
    for (let i = 0; i < 500; i++) control.aiSecond.nextFloat();
    const stillMatchingFirstSequence = Array.from({ length: 10 }, () => control.aiFirst.nextFloat());

    expect(stillMatchingFirstSequence).toEqual(untouchedFirstSequence);
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
