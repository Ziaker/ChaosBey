// Polish (owner, 2026-10-07, idea 7): "more room for the new speed". The Beys are ~2.8x faster than when the 36 m stage was
// sized, so the time a Bey takes to reach the wall is kept as a regression test. Measured (full throttle from the centre
// at rest): flat floor, stage x0.75 / x1 / x1.25 / x1.5 / x2 -> 2.3 / 2.7 / 3.1 / 3.4 / 3.9 s; on the default funnel
// (Bowl B, 8.5 m) a straight run never gets there (the slope holds it to ~5.5 m/s). The default stage size is kept.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { arenaFloorRadius } from '../../src/arena/colliders/ArenaTuning';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const FORWARD: ControllerActions = { ...NONE, held: new Set([Action.MoveForward]) };

/** Seconds a Bey held at full throttle from the centre needs to reach 1.5 m from the wall (null: not within `limitS`). */
async function secondsToWall(arenaFloor: 'flat' | 'bowl-b', arenaSizeScale: number, limitS: number): Promise<{ s: number | null; topSpeed: number }> {
  const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 }, { x: 0, y: 3, z: 0 }, { ...createDefaultMatchConfig(), arenaFloor, arenaSizeScale });
  h.second.body.setTranslation({ x: -arenaFloorRadius() * 0.7, y: 3, z: 0 }, true); // the opponent parked well off the line
  for (let i = 0; i < 40; i++) h.tick(NONE, NONE);
  h.first.body.setTranslation({ x: 0, y: h.first.body.translation().y, z: 0 }, true);
  let reached: number | null = null;
  let topSpeed = 0;
  for (let t = 0; t < limitS * 60; t++) {
    h.tick(FORWARD, NONE);
    const p = h.first.body.translation();
    const v = h.first.body.linvel();
    topSpeed = Math.max(topSpeed, Math.hypot(v.x, v.z));
    if (reached === null && Math.hypot(p.x, p.z) > arenaFloorRadius() - 1.5) reached = t / 60;
  }
  return { s: reached, topSpeed };
}

describe('room to move at the new speed', () => {
  it('on the flat floor the default stage takes at least 2.2 s to cross from the centre, and a bigger stage takes longer', async () => {
    const small = await secondsToWall('flat', 0.75, 8);
    const normal = await secondsToWall('flat', 1, 8);
    const big = await secondsToWall('flat', 1.5, 8);
    expect(normal.s, 'the default stage is crossed').not.toBeNull();
    expect(normal.s!).toBeGreaterThanOrEqual(2.2);
    expect(small.s!).toBeLessThan(normal.s!);
    expect(big.s!).toBeGreaterThan(normal.s! + 0.3);
  }, 60_000);

  it('on the default funnel a straight run from the centre does not reach the wall in 6 s (the slope holds the speed down)', async () => {
    const funnel = await secondsToWall('bowl-b', 1, 6);
    expect(funnel.s).toBeNull();
    expect(funnel.topSpeed).toBeLessThan(15);
  }, 60_000);
});
