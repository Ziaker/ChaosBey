// Master Design §12: pre-game acceleration must support playtesting time-to-speed up to roughly 3 seconds.
// Lote 9 initially exposed only 0.5x..2x; on the movement baseline (11 m/s / 14 m/s²) that bottoms out around 1.57 s.
// The slider's semantics are a multiplier on thrust, so the approved capability is best pinned by the nominal baseline
// ratio and then separately proven through real tickMatch movement. Do not require every archetype/condition to cross an
// arbitrary absolute speed: Stamina, motion direction and per-Bey handling are all intentionally part of the real model.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { ACCELERATION_MPS2, INTENDED_MAX_SPEED_MPS } from '../../src/bey/movement/MovementTuning';
import { ACCELERATION_SCALE_RANGE } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const FORWARD: ControllerActions = { ...NONE, held: new Set([Action.MoveForward]) };

async function speedAfter(ticks: number, accelerationScale: number): Promise<number> {
  const h = await CombatHarness.create(
    { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -14 },
    { x: 25, y: BEY_SPAWN_HEIGHT_M, z: 25 },
    { arenaFloor: 'flat', momentumGain: 0, movementStaminaDrain: 0, accelerationScale },
  );
  for (let i = 0; i < 30; i++) h.tick(NONE, NONE);
  for (let i = 0; i < ticks; i++) h.tick(FORWARD, NONE);
  const v = h.first.body.linvel();
  const speed = Math.hypot(v.x, v.z);
  h.dispose();
  return speed;
}

describe('Pregame acceleration range — Master Design ~3 s playtest', () => {
  it('extends to 0.25x, which puts the 11 m/s / 14 m/s² baseline at roughly 3.1 s nominal time-to-speed', () => {
    expect(ACCELERATION_SCALE_RANGE.min).toBe(0.25);
    const nominalSeconds = INTENDED_MAX_SPEED_MPS / (ACCELERATION_MPS2 * ACCELERATION_SCALE_RANGE.min);
    expect(nominalSeconds).toBeGreaterThanOrEqual(2.8);
    expect(nominalSeconds).toBeLessThanOrEqual(3.3);
  });

  it('the real tickMatch movement is materially slower at 0.25x than at the default 1x', async () => {
    const slow = await speedAfter(60, 0.25);
    const normal = await speedAfter(60, 1);
    expect(slow).toBeGreaterThan(1);
    expect(normal).toBeGreaterThan(slow * 2.5);
  });
});
