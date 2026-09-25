import { describe, expect, it } from 'vitest';
import { isRingOut } from '../../src/arena/ringout/RingOut';
import { RINGOUT_RADIUS_M } from '../../src/arena/ringout/RingOutTuning';
import { RoundOutcome, RoundState } from '../../src/combat/round-rules/RoundState';

describe('isRingOut', () => {
  it('is false at the arena center', () => {
    expect(isRingOut({ x: 0, z: 0 })).toBe(false);
  });

  it('is false just inside the ring-out radius', () => {
    expect(isRingOut({ x: RINGOUT_RADIUS_M - 0.1, z: 0 })).toBe(false);
  });

  it('is true once clearly beyond the ring-out radius', () => {
    expect(isRingOut({ x: RINGOUT_RADIUS_M + 0.1, z: 0 })).toBe(true);
  });

  it('checks radial distance regardless of direction', () => {
    const diagonal = (RINGOUT_RADIUS_M + 0.5) / Math.SQRT2;
    expect(isRingOut({ x: diagonal, z: diagonal })).toBe(true);
  });
});

const NONE = { firstKoed: false, secondKoed: false, firstRingOut: false, secondRingOut: false };

describe('RoundState', () => {
  it('starts Ongoing and not over', () => {
    const round = new RoundState();
    expect(round.isOver).toBe(false);
    expect(round.result).toBe(RoundOutcome.Ongoing);
  });

  it('a solo KO on second ends the round with FirstWinsByKo', () => {
    const round = new RoundState();
    round.resolveTick({ ...NONE, secondKoed: true });
    expect(round.isOver).toBe(true);
    expect(round.result).toBe(RoundOutcome.FirstWinsByKo);
  });

  it('a solo KO on first ends the round with SecondWinsByKo', () => {
    const round = new RoundState();
    round.resolveTick({ ...NONE, firstKoed: true });
    expect(round.result).toBe(RoundOutcome.SecondWinsByKo);
  });

  it('a solo ring-out by second ends the round with FirstWinsByRingOut', () => {
    const round = new RoundState();
    round.resolveTick({ ...NONE, secondRingOut: true });
    expect(round.result).toBe(RoundOutcome.FirstWinsByRingOut);
  });

  it('a solo ring-out by first ends the round with SecondWinsByRingOut', () => {
    const round = new RoundState();
    round.resolveTick({ ...NONE, firstRingOut: true });
    expect(round.result).toBe(RoundOutcome.SecondWinsByRingOut);
  });

  it('a genuinely simultaneous double-KO resolves to Draw, not tiebroken by field order', () => {
    const round = new RoundState();
    round.resolveTick({ ...NONE, firstKoed: true, secondKoed: true });
    expect(round.result).toBe(RoundOutcome.Draw);
  });

  it('a genuinely simultaneous double-ring-out resolves to Draw, not tiebroken by field order', () => {
    const round = new RoundState();
    round.resolveTick({ ...NONE, firstRingOut: true, secondRingOut: true });
    expect(round.result).toBe(RoundOutcome.Draw);
  });

  it('a simultaneous mixed double-loss (one KO, one ring-out) is also a Draw', () => {
    const round = new RoundState();
    round.resolveTick({ ...NONE, firstKoed: true, secondRingOut: true });
    expect(round.result).toBe(RoundOutcome.Draw);
  });

  it('ignores further resolveTick calls once the round is already over', () => {
    const round = new RoundState();
    round.resolveTick({ ...NONE, secondKoed: true });
    round.resolveTick({ ...NONE, firstKoed: true });
    expect(round.result).toBe(RoundOutcome.FirstWinsByKo);
  });
});
