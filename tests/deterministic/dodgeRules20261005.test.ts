// Owner, 2026-10-05: "corrija todos problemas relacionados ao perfect dodge ser ativado multiplas vezes, ser cancelavel
// em outros ataques e também corrige os problemas da camera lenta tambem ser ativada multiplas vezes ao desviar, reduza
// o cooldown base pela metade". Through the real tickMatch(), with the match's own rules.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { DodgeController, DodgeState } from '../../src/dodge/DodgeController';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const hold = (held: Action[], pressed: Action[] = []): ControllerActions => ({ ...NONE, held: new Set(held), pressedThisFrame: new Set(pressed) });

async function harness(firstZ = -2, secondZ = 2): Promise<CombatHarness> {
  const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: firstZ }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: secondZ }, { ...createDefaultMatchConfig(), arenaFloor: 'flat' });
  for (let i = 0; i < 40; i++) h.tick(NONE, NONE);
  return h;
}

describe('one Perfect Dodge per dodge (owner, 2026-10-05)', () => {
  it('a dodge grants at most one Perfect Dodge, whatever it evades; the next dodge can grant its own', () => {
    const dodge = new DodgeController(0.1, 0);
    const press = hold([Action.Dodge], [Action.Dodge]);
    const body = { linvel: () => ({ x: 0, y: 0, z: 0 }) } as never;
    dodge.tick(body, press, 0, true, 100, 1 / 60);
    expect(dodge.getState()).toBe(DodgeState.Dodging);
    expect(dodge.claimPerfectDodge()).toBe(true);
    expect(dodge.claimPerfectDodge(), 'a second attack evaded by the same dodge').toBe(false);
    for (let i = 0; i < 60 && dodge.getState() !== DodgeState.Idle; i++) dodge.tick(body, NONE, 0, true, 100, 1 / 60);
    dodge.tick(body, press, 0, true, 100, 1 / 60);
    expect(dodge.getState()).toBe(DodgeState.Dodging);
    expect(dodge.claimPerfectDodge(), 'a new dodge').toBe(true);
  });

  it('a Dash evaded in the perfect window reports one Perfect Dodge (one freeze), not one per overlapping tick', async () => {
    const h = await harness(-2, 4);
    let perfect = 0;
    let dodged = 0;
    for (let t = 0; t < 120; t++) {
      // second charges a short Dash at first; first dodges sideways as it arrives.
      const second = t < 20 ? hold([Action.Attack], t === 0 ? [Action.Attack] : []) : NONE;
      const first = t === 24 ? hold([Action.Dodge, Action.SteerLeft], [Action.Dodge]) : NONE;
      const r = h.tick(first, second);
      perfect += r.combatEvents.filter((e) => e.kind === 'perfectDodge' && e.targetIsFirst).length;
      dodged += r.combatEvents.filter((e) => e.kind === 'dodged' && e.targetIsFirst).length;
    }
    expect(dodged).toBe(1);
    expect(perfect).toBe(1);
  });
});

describe('a dodge and an attack never cancel each other (owner, 2026-10-05)', () => {
  it('while dodging, Attack does nothing — no Circular, no charge — and works again after the dodge', async () => {
    const h = await harness(-10, 10);
    h.tick(hold([Action.Dodge], [Action.Dodge]), NONE);
    expect(h.first.dodge.getState()).toBe(DodgeState.Dodging);
    let ticks = 0;
    while (h.first.dodge.getState() === DodgeState.Dodging && ticks < 120) {
      h.tick(ticks % 2 === 0 ? hold([Action.Attack], [Action.Attack]) : NONE, NONE);
      if (h.first.dodge.getState() === DodgeState.Dodging) expect(h.first.attack.getState(), `tick ${ticks} of the dodge`).toBe(AttackState.Neutral);
      ticks++;
    }
    expect(ticks).toBeGreaterThan(10);
    h.tick(hold([Action.Attack], [Action.Attack]), NONE);
    expect(h.first.attack.getState()).not.toBe(AttackState.Neutral);
  });

  it('a dodge started during a Dash charge drops the charge: no Dash fires out of the dodge', async () => {
    const h = await harness(-10, 10);
    for (let t = 0; t < 20; t++) h.tick(hold([Action.Attack], t === 0 ? [Action.Attack] : []), NONE);
    expect(h.first.attack.getState()).toBe(AttackState.ChargingDash);
    h.tick(hold([Action.Attack, Action.Dodge], [Action.Dodge]), NONE);
    expect(h.first.dodge.getState()).toBe(DodgeState.Dodging);
    expect(h.first.attack.getState()).toBe(AttackState.Neutral);
    for (let t = 0; t < 60; t++) {
      h.tick(NONE, NONE); // Attack released during / after the dodge: nothing to release any more
      expect(h.first.attack.getState()).not.toBe(AttackState.DashActive);
    }
  });

  it('no ground dodge while the Bey\'s own Circular or Dash is out or recovering', async () => {
    for (const kind of ['circular', 'dash'] as const) {
      const h = await harness(-10, 10);
      const holdTicks = kind === 'circular' ? 2 : 20;
      let sawCommitted = false;
      for (let t = 0; t < 120; t++) {
        const attack = t < holdTicks ? [Action.Attack] : [];
        const committed = h.first.attack.isCommitted();
        const dodge = committed ? [Action.Dodge] : [];
        h.tick(hold([...attack, ...dodge], [...(t === 0 ? [Action.Attack] : []), ...dodge]), NONE);
        if (committed) {
          sawCommitted = true;
          expect(h.first.dodge.getState(), `${kind}, tick ${t}`).not.toBe(DodgeState.Dodging);
        }
      }
      expect(sawCommitted, kind).toBe(true);
    }
  });
});

describe('dodge cooldown (owner, 2026-10-05)', () => {
  it('the base dodge cooldown is half what it was: 1.25 s (was 2.5 s)', () => {
    expect(createDefaultMatchConfig().dodgeCooldownS).toBe(1.25);
  });
});
