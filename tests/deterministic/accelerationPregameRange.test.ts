// Master Design §12: pre-game acceleration must support playtesting time-to-speed up to roughly 3 seconds.
// Lote 9 initially exposed only 0.5x..2x; on the movement baseline (11 m/s / 14 m/s²) that bottoms out around 1.57 s.
// The slider's semantics are a multiplier on thrust, so the approved capability is best pinned by the nominal baseline
// ratio and then separately proven through real tickMatch movement. Do not require every archetype/condition to cross an
// arbitrary absolute speed: Stamina, motion direction, floor contact and per-Bey handling are all intentionally part of
// the real model.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { ACCELERATION_MPS2, INTENDED_MAX_SPEED_MPS } from '../../src/bey/movement/MovementTuning';
import { ACCELERATION_SCALE_RANGE } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const FORWARD: ControllerActions = { ...NONE, held: new Set([Action.MoveForward]) };

/**
 * Peak horizontal speed reached during a fixed production tickMatch drive window. The Bey first settles on the flat
 * floor so both runs begin from the same real grounded state. Once movement begins we deliberately do NOT discard a
 * sample merely because the one-tick ground probe reports false: doing that reduced the old measurement to essentially
 * its first moving tick (~0.15 m/s at 0.25x) and tested ground-probe timing instead of the acceleration multiplier.
 */
async function peakSpeedDuring(ticks: number, accelerationScale: number): Promise<number> {
  const h = await CombatHarness.create(
    { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 },
    { x: 20, y: BEY_SPAWN_HEIGHT_M, z: 20 },
    { arenaFloor: 'flat', momentumGain: 0, movementStaminaDrain: 0, accelerationScale },
  );

  let groundedStreak = 0;
  for (let i = 0; i < 180 && groundedStreak < 5; i++) {
    const result = h.tick(NONE, NONE);
    groundedStreak = result.first.grounded ? groundedStreak + 1 : 0;
  }
  if (groundedStreak < 5) {
    h.dispose();
    throw new Error('acceleration fixture never settled on the flat arena');
  }

  let peak = 0;
  for (let i = 0; i < ticks; i++) {
    h.tick(FORWARD, NONE);
    const v = h.first.body.linvel();
    peak = Math.max(peak, Math.hypot(v.x, v.z));
  }
  h.dispose();
  return peak;
}

describe('Pregame acceleration range — Master Design ~3 s playtest', () => {
  it('extends to 0.25x, which puts the 11 m/s / 14 m/s² baseline at roughly 3.1 s nominal time-to-speed', () => {
    expect(ACCELERATION_SCALE_RANGE.min).toBe(0.25);
    const nominalSeconds = INTENDED_MAX_SPEED_MPS / (ACCELERATION_MPS2 * ACCELERATION_SCALE_RANGE.min);
    expect(nominalSeconds).toBeGreaterThanOrEqual(2.8);
    expect(nominalSeconds).toBeLessThanOrEqual(3.3);
  });

  it('the real tickMatch movement responds materially to the 0.25x acceleration setting', async () => {
    const slow = await peakSpeedDuring(60, 0.25);
    const normal = await peakSpeedDuring(60, 1);
    expect(slow).toBeGreaterThan(0);
    expect(normal).toBeGreaterThan(slow * 2.5);
  });
});
