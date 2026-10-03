// Master Design §12: pre-game acceleration must support playtesting time-to-speed up to roughly 3 seconds.
// Lote 9 initially exposed only 0.5x..2x; for the default 11 m/s / 14 m/s² Bey that bottomed out around 1.6 s.
// This regression uses the real tickMatch movement path and verifies the extended 0.25x setting reaches the requested slow regime.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { ACCELERATION_SCALE_RANGE } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const FORWARD: ControllerActions = { ...NONE, held: new Set([Action.MoveForward]) };

async function ticksTo(speedMps: number, accelerationScale: number): Promise<number> {
  const h = await CombatHarness.create(
    { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -14 },
    { x: 25, y: BEY_SPAWN_HEIGHT_M, z: 25 },
    { arenaFloor: 'flat', momentumGain: 0, accelerationScale },
  );
  for (let i = 0; i < 30; i++) h.tick(NONE, NONE);
  let reached = -1;
  for (let tick = 1; tick <= 300; tick++) {
    h.tick(FORWARD, NONE);
    const v = h.first.body.linvel();
    if (Math.hypot(v.x, v.z) >= speedMps) {
      reached = tick;
      break;
    }
  }
  h.dispose();
  return reached;
}

describe('Pregame acceleration range — Master Design ~3 s playtest', () => {
  it('extends to 0.25x and makes reaching 10 m/s take roughly three seconds in the real movement model', async () => {
    expect(ACCELERATION_SCALE_RANGE.min).toBe(0.25);
    const ticks = await ticksTo(10, ACCELERATION_SCALE_RANGE.min);
    expect(ticks).toBeGreaterThanOrEqual(160); // >= 2.67 s
    expect(ticks).toBeLessThanOrEqual(200); // <= 3.33 s
  });

  it('the default remains substantially quicker than the slowest playtest value', async () => {
    const slow = await ticksTo(10, 0.25);
    const normal = await ticksTo(10, 1);
    expect(normal).toBeGreaterThan(0);
    expect(slow).toBeGreaterThan(normal * 3.5);
  });
});
