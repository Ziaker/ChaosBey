import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { describe, expect, it } from 'vitest';
import { isOutOfArena, isRingOut } from '../../src/arena/ringout/RingOut';
import { floorHeightAt, floorRimHeight } from '../../src/arena/floor/ArenaFloorProfile';
import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';
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

describe('ring-out delay (owner, 2026-10-02: not the instant a Bey is outside)', () => {
  const DT = 1 / 60;
  const ticksFor = (s: number): number => Math.round(s / DT);

  it('outside for 1.4 s and back inside: no ring-out, and the clock resets', () => {
    const round = new RoundState({ ringOutDelayS: 1.5 });
    for (let i = 0; i < ticksFor(1.4); i++) expect(round.trackRingOut(false, true, DT).second).toBe(false);
    expect(round.ringOutClock.second).toBeCloseTo(1.4, 6);
    expect(round.trackRingOut(false, false, DT).second).toBe(false);
    expect(round.ringOutClock.second).toBe(0);
    // A fresh 1.4 s outside again is still not enough: the earlier time does not carry over.
    for (let i = 0; i < ticksFor(1.4); i++) expect(round.trackRingOut(false, true, DT).second).toBe(false);
  });

  it('outside for 1.5 s: ring-out on exactly that tick', () => {
    const round = new RoundState({ ringOutDelayS: 1.5 });
    const results: boolean[] = [];
    for (let i = 0; i < ticksFor(1.5); i++) results.push(round.trackRingOut(true, false, DT).first);
    expect(results.slice(0, -1).every((r) => !r)).toBe(true);
    expect(results.at(-1)).toBe(true);
  });

  it('delay 0 is the old rule: outside = ringed out on the first tick', () => {
    const round = new RoundState({ ringOutDelayS: 0 });
    expect(round.trackRingOut(true, false, DT)).toEqual({ first: true, second: false });
  });

  it('the match default is the provisional 1.5 s (MatchConfig); a bare RoundState keeps the old instant rule', () => {
    expect(createDefaultMatchConfig().ringOutDelayS).toBe(1.5);
    expect(new RoundState().trackRingOut(true, false, DT).first).toBe(true);
  });

  it('with the match default, its clocks are part of the deterministic state', () => {
    const round = new RoundState({ ringOutDelayS: createDefaultMatchConfig().ringOutDelayS });
    for (let i = 0; i < ticksFor(1.5) - 1; i++) round.trackRingOut(true, false, DT);
    expect(round.trackRingOut(true, false, DT).first).toBe(true);
    expect(round.getDeterministicState()).toMatchObject({ outsideS: { first: expect.any(Number), second: 0 } });
  });
});

describe('isOutOfArena (owner, 2026-10-02: ring-out delay)', () => {
  it('is outside beyond the ring-out radius at any height', () => {
    expect(isOutOfArena({ x: RINGOUT_RADIUS_M + 0.1, y: 5, z: 0 }, 'bowl-a')).toBe(true);
    expect(isOutOfArena({ x: 0, y: 0.6, z: 0 }, 'bowl-a')).toBe(false);
  });

  it('counts a Bey fallen off the arena under the rim as outside, even inside the ring-out radius', () => {
    for (const floor of ['flat', 'bowl-a', 'bowl-b', 'bowl-c'] as const) {
      const r = (ARENA_FLOOR_RADIUS + RINGOUT_RADIUS_M) / 2; // past the floor edge, inside the ring-out radius
      expect(isOutOfArena({ x: 0, y: floorRimHeight(floor) - 5, z: r }, floor), floor).toBe(true);
      // On (or above) the rim there it is still in play: over the wall, not yet out.
      expect(isOutOfArena({ x: 0, y: floorRimHeight(floor) + 0.5, z: r }, floor), floor).toBe(false);
      // Inside the floor radius: on the floor is in play; well under it (slipped beneath the bowl) is out.
      const inside = { x: 0, z: 11.7 };
      const surface = floorHeightAt(floor, inside.x, inside.z);
      expect(isOutOfArena({ ...inside, y: surface + 0.3 }, floor), floor).toBe(false);
      expect(isOutOfArena({ ...inside, y: surface - 0.5 }, floor), floor).toBe(false);
      expect(isOutOfArena({ ...inside, y: -544 }, floor), floor).toBe(true);
    }
  });
});
