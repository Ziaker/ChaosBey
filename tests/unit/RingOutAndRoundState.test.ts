import { describe, expect, it } from 'vitest';
import { ARENA_FLOOR_RADIUS, ARENA_WALL_THICKNESS } from '../../src/arena/colliders/ArenaTuning';
import { isRingOut } from '../../src/arena/ringout/RingOut';
import { RINGOUT_MARGIN_BEYOND_WALL_M } from '../../src/arena/ringout/RingOutTuning';
import { RoundOutcome, RoundState } from '../../src/combat/round-rules/RoundState';

describe('isRingOut', () => {
  it('is false at the arena center', () => {
    expect(isRingOut({ x: 0, z: 0 })).toBe(false);
  });

  it('is false at the inner floor radius (still on the platform)', () => {
    expect(isRingOut({ x: ARENA_FLOOR_RADIUS - 0.1, z: 0 })).toBe(false);
  });

  it('is false just past the wall face, within the ring-out margin (GDD 130: no spurious trigger from a normal wall bounce)', () => {
    const justPastWall = ARENA_FLOOR_RADIUS + ARENA_WALL_THICKNESS + RINGOUT_MARGIN_BEYOND_WALL_M - 0.05;
    expect(isRingOut({ x: justPastWall, z: 0 })).toBe(false);
  });

  it('is true once clearly beyond the wall face plus margin', () => {
    const clearlyOut = ARENA_FLOOR_RADIUS + ARENA_WALL_THICKNESS + RINGOUT_MARGIN_BEYOND_WALL_M + 0.05;
    expect(isRingOut({ x: clearlyOut, z: 0 })).toBe(true);
  });

  it('checks radial distance regardless of direction', () => {
    const clearlyOut = ARENA_FLOOR_RADIUS + ARENA_WALL_THICKNESS + RINGOUT_MARGIN_BEYOND_WALL_M + 0.05;
    const diagonal = clearlyOut / Math.SQRT2;
    expect(isRingOut({ x: diagonal, z: diagonal })).toBe(true);
  });
});

describe('RoundState', () => {
  it('starts Ongoing and not over', () => {
    const round = new RoundState();
    expect(round.isOver).toBe(false);
    expect(round.result).toBe(RoundOutcome.Ongoing);
  });

  it('registerKo(true) ends the round with FirstWinsByKo', () => {
    const round = new RoundState();
    round.registerKo(true);
    expect(round.isOver).toBe(true);
    expect(round.result).toBe(RoundOutcome.FirstWinsByKo);
  });

  it('registerKo(false) ends the round with SecondWinsByKo', () => {
    const round = new RoundState();
    round.registerKo(false);
    expect(round.result).toBe(RoundOutcome.SecondWinsByKo);
  });

  it('registerRingOut(loserIsFirst=true) means the second combatant wins', () => {
    const round = new RoundState();
    round.registerRingOut(true);
    expect(round.result).toBe(RoundOutcome.SecondWinsByRingOut);
  });

  it('registerRingOut(loserIsFirst=false) means the first combatant wins', () => {
    const round = new RoundState();
    round.registerRingOut(false);
    expect(round.result).toBe(RoundOutcome.FirstWinsByRingOut);
  });

  it('ignores further outcome changes once the round is already over', () => {
    const round = new RoundState();
    round.registerKo(true);
    round.registerRingOut(false);
    expect(round.result).toBe(RoundOutcome.FirstWinsByKo);
  });
});
