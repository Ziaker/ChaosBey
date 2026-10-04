// Owner, 2026-10-04: "a força do knockback aplicado ao inimigo ao ganhar um clash devia ser MUITO maior, além disso
// ambos jogadores podem realizar dodges, ataques, pulos E ataque giratório 1 milésimo após o fim de um clash, isso tá
// INACEITAVELMENTE ERRADO, não é pra ser possível realizar nenhum movimento (no caso do perdedor) até se recuperar no ar".
// Through the real tickMatch(), with the match's own rules.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { ClashState } from '../../src/combat/clash/ClashController';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { DodgeState } from '../../src/dodge/DodgeController';
import { DriftState } from '../../src/drift/DriftController';
import { ScriptedController, type ScriptedFrame } from '../../src/automation/scripted-scenarios/ScriptedController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const press = (...a: Action[]): ControllerActions => ({ ...NONE, held: new Set(a), pressedThisFrame: new Set(a), moveIntent: { x: 1, z: 0 } });

function mash(interval: number): ScriptedController {
  const frames: ScriptedFrame[] = [{ fromTick: 0, held: [Action.Attack] }, { fromTick: 2, held: [] }];
  for (let t = 4; t < 600; t += interval) {
    frames.push({ fromTick: t, held: [Action.Dodge] });
    frames.push({ fromTick: t + 1, held: [] });
  }
  return new ScriptedController(frames);
}

/** A Clash the first Bey wins (Stamina decides it: the second is at 10%, as in clashIntegration), played to its resolution. */
async function resolvedClash(): Promise<CombatHarness> {
  const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -0.75 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0.75 }, { ...createDefaultMatchConfig(), arenaFloor: 'flat' });
  for (let i = 0; i < 15; i++) h.tick(NONE, NONE);
  h.second.stamina.resource.subtract(h.second.stamina.resource.max * 0.9);
  const first = mash(3);
  const second = mash(3);
  for (let i = 0; i < 600; i++) {
    const r = h.tick(first.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }), second.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
    if (r.clashResolvedThisTick) break;
  }
  expect(h.clash.controller.getState()).toBe(ClashState.Cooldown);
  expect(h.second.movement.isClashStunned()).toBe(true); // the first won
  return h;
}

describe('after a Clash (owner, 2026-10-04)', () => {
  it('the loser is launched hard: away and into the air', async () => {
    const h = await resolvedClash();
    const v = h.second.body.linvel();
    expect(Math.hypot(v.x, v.z)).toBeGreaterThan(25);
    expect(v.y).toBeGreaterThan(10);
  });

  it('the loser can do nothing — move, attack, jump, Circular — until it recovers; the Air Recovery is the one way out', async () => {
    const h = await resolvedClash();
    expect(h.second.movement.isClashStunned()).toBe(true);
    for (let i = 0; i < 20; i++) {
      h.tick(NONE, press(Action.Attack, Action.JumpDrift));
      expect(h.second.attack.getState()).toBe(AttackState.Neutral);
      expect(h.second.drift.getState?.() ?? DriftState.Idle).toBe(DriftState.Idle);
      expect(h.second.movement.isClashStunned()).toBe(true);
    }
    // Airborne: Dodge = Air Recovery, and it hands control back.
    h.tick(NONE, press(Action.Dodge));
    expect(h.second.movement.isClashStunned()).toBe(false);
  });

  it('without a recovery the stun lasts until it lands', async () => {
    const h = await resolvedClash();
    let ticks = 0;
    while (h.second.movement.isClashStunned() && ticks < 600) {
      h.tick(NONE, NONE);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(10);
    expect(ticks).toBeLessThan(600);
  });

  it('the winner can\'t attack, dodge or jump for its 0.4 s recovery, then can', async () => {
    const h = await resolvedClash();
    // 0.4 s = 24 ticks: pressing on every other tick for 22 of them.
    for (let i = 0; i < 11; i++) {
      h.tick(press(Action.Attack, Action.Dodge, Action.JumpDrift), NONE);
      expect(h.first.attack.getState()).toBe(AttackState.Neutral);
      expect(h.first.dodge.getState()).not.toBe(DodgeState.Dodging);
      h.tick(NONE, NONE);
    }
    for (let i = 0; i < 4; i++) h.tick(NONE, NONE);
    h.tick(press(Action.Attack), NONE);
    expect(h.first.attack.getState()).not.toBe(AttackState.Neutral);
  });
});
