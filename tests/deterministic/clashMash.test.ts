// ============================================================
// CLASH MASH COUNTING SELF-TESTS
// ============================================================

import { describe, expect, it } from 'vitest';
import { FixedIntervalAiMashSource, nextMashEventCount } from '../../src/combat/clash/ClashMash';

describe('nextMashEventCount', () => {
  it('three actions pressed simultaneously in one tick count as exactly one event', () => {
    const count = nextMashEventCount(0, new Set(['Attack', 'JumpDrift', 'Dodge']), false);
    expect(count).toBe(1);
  });

  it('the same three actions pressed across three separate ticks count as three events', () => {
    let count = 0;
    count = nextMashEventCount(count, new Set(['Attack']), false);
    count = nextMashEventCount(count, new Set(['JumpDrift']), false);
    count = nextMashEventCount(count, new Set(['Dodge']), false);
    expect(count).toBe(3);
  });

  it('a tick with no pressed actions and no AI contribution does not advance the count', () => {
    expect(nextMashEventCount(5, new Set(), false)).toBe(5);
  });

  it('AI mash contributes independently of real presses', () => {
    expect(nextMashEventCount(0, new Set(), true)).toBe(1);
    // A real press and an AI contribution the same tick are two distinct
    // sources — both count.
    expect(nextMashEventCount(0, new Set(['Attack']), true)).toBe(2);
  });
});

describe('FixedIntervalAiMashSource', () => {
  it('contributes a mash event every intervalTicks ticks, deterministically', () => {
    const source = new FixedIntervalAiMashSource(3);
    const contributions = [0, 1, 2, 3, 4, 5, 6].map((tick) => source.sampleTick(tick, tick / 60));
    expect(contributions).toEqual([true, false, false, true, false, false, true]);
  });

  it('never contributes when intervalTicks is 0', () => {
    const source = new FixedIntervalAiMashSource(0);
    expect(source.sampleTick(0, 0)).toBe(false);
    expect(source.sampleTick(10, 1)).toBe(false);
  });

  it('is deterministic — repeated calls with the same tick index return the same result', () => {
    const source = new FixedIntervalAiMashSource(4);
    expect(source.sampleTick(8, 1)).toBe(source.sampleTick(8, 1));
  });
});
