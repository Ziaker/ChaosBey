// Owner, 2026-10-02 (Lote 2, item 19): a Dash touches Stamina only through
// the normal movement drain (base + speed) of the ticks it lasts. Measured
// through the real tickMatch() with nobody in reach (no hit, no Clash).

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { INTENDED_MAX_SPEED_MPS } from '../../src/bey/movement/MovementTuning';
import {
  STAMINA_BASE_DRAIN_PER_S,
  STAMINA_DRAIN_SPEED_THRESHOLD_FRACTION,
  STAMINA_EXTRA_DRAIN_PER_S_AT_FULL_SPEED,
} from '../../src/bey/stamina/StaminaTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const attack = (held: boolean, pressed: boolean): ControllerActions => ({ ...NONE, held: held ? new Set([Action.Attack]) : new Set(), pressedThisFrame: pressed ? new Set([Action.Attack]) : new Set() });

/** The movement drain StaminaSystem.tick() applies for one tick at this speed (Stamina stat `stat`). */
function movementDrain(speedMps: number, stat: number): number {
  const extra = Math.max(0, speedMps / INTENDED_MAX_SPEED_MPS - STAMINA_DRAIN_SPEED_THRESHOLD_FRACTION) / (1 - STAMINA_DRAIN_SPEED_THRESHOLD_FRACTION);
  return ((STAMINA_BASE_DRAIN_PER_S + STAMINA_EXTRA_DRAIN_PER_S_AT_FULL_SPEED * Math.min(1, extra)) / stat) * FIXED_DELTA_SECONDS;
}

describe('a Dash spends no Stamina beyond the movement drain (item 19)', () => {
  it('full-charge Dash: Stamina before/after differs only by the base + speed drain of those ticks', async () => {
    // Far apart: the Dash whiffs.
    const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -12 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 14 });
    for (let i = 0; i < 30; i++) harness.tick(NONE, NONE);
    const stamina = harness.first.stamina;
    const stat = stamina.resource.max / 100;
    const before = stamina.resource.value;
    let expected = 0;
    const states: AttackState[] = [];
    const step = (a: ControllerActions): void => {
      const result = harness.tick(a, NONE);
      expected += movementDrain(result.first.movement.speedMps, stat);
      states.push(result.first.attackState);
    };
    step(attack(true, true));
    for (let i = 0; i < 80; i++) step(attack(true, false));
    for (let i = 0; i < 90; i++) step(NONE);
    expect(states).toContain(AttackState.DashActive);
    expect(before - stamina.resource.value).toBeCloseTo(expected, 9);
  });
});
