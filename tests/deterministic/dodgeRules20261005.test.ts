// Owner, 2026-10-05: "corrija todos problemas relacionados ao perfect dodge ser ativado multiplas vezes, ser cancelavel
// em outros ataques e também corrige os problemas da camera lenta tambem ser ativada multiplas vezes ao desviar, reduza
// o cooldown base pela metade". Through the real tickMatch(), with the match's own rules.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { AttackState } from '../../src/combat/attacks/AttackController';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { DodgeController, DodgeState } from '../../src/dodge/DodgeController';
import { INTANGIBLE_AFTER_DODGE_MAX_S } from '../../src/dodge/DodgeTuning';
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

describe('a dodging Bey is invincible and intangible (owner, 2026-10-05)', () => {
  // "durante o dodge, o bey fica invencível e intangível, além de NUNCA deixar os beys tocar um no outro durante o
  // perfect dodge". Checked: with the intangibility switched off, the first case takes a collision with damage (tick 51).
  it('a Dash at a dodging Bey passes straight through it: no hit, no body collision, no push, one Perfect Dodge', async () => {
    for (const dodgeTick of [20, 24, 26]) {
      const h = await harness(-2, 4);
      const reach = h.first.definition.physical.colliderRadiusM + h.second.definition.physical.colliderRadiusM;
      let closest = Infinity;
      let perfect = 0;
      for (let t = 0; t < 90; t++) {
        const second = t < 20 ? hold([Action.Attack], t === 0 ? [Action.Attack] : []) : NONE;
        const first = t === dodgeTick ? hold([Action.Dodge], [Action.Dodge]) : NONE;
        const r = h.tick(first, second);
        const a = h.first.body.translation();
        const b = h.second.body.translation();
        closest = Math.min(closest, Math.hypot(a.x - b.x, a.z - b.z));
        perfect += r.combatEvents.filter((e) => e.kind === 'perfectDodge').length;
        const touched = r.combatEvents.filter((e) => e.kind === 'stabilityDamage' || e.kind === 'knockback' || e.kind === 'bodyCollision');
        expect(touched, `dodge at ${dodgeTick}, tick ${t}`).toEqual([]);
      }
      expect(closest, `dodge at ${dodgeTick}: the Dash went through the body`).toBeLessThan(reach * 0.5);
      expect(perfect, `dodge at ${dodgeTick}`).toBe(1);
    }
  });

  it('after the dodge it stays intangible while the two still overlap (at most the cap), then is solid again', () => {
    const dodge = new DodgeController(0.1, 0);
    const body = { linvel: () => ({ x: 0, y: 0, z: 0 }) } as never;
    expect(dodge.isIntangible()).toBe(false);
    dodge.tick(body, hold([Action.Dodge], [Action.Dodge]), 0, true, 100, 1 / 60);
    dodge.updateIntangibility(false, 1 / 60);
    expect(dodge.isIntangible(), 'dodging').toBe(true);
    for (let i = 0; i < 120 && dodge.getState() === DodgeState.Dodging; i++) {
      dodge.tick(body, NONE, 0, true, 100, 1 / 60);
      dodge.updateIntangibility(true, 1 / 60);
    }
    expect(dodge.getState()).not.toBe(DodgeState.Dodging);
    dodge.updateIntangibility(true, 1 / 60);
    expect(dodge.isIntangible(), 'dodge over, still inside the other Bey').toBe(true);
    dodge.updateIntangibility(false, 1 / 60);
    expect(dodge.isIntangible(), 'out of the other Bey').toBe(false);

    // Stuck inside for longer than the cap: solid again after it (the solver separates them).
    const stuck = new DodgeController(0.1, 0);
    stuck.tick(body, hold([Action.Dodge], [Action.Dodge]), 0, true, 100, 1 / 60);
    stuck.updateIntangibility(true, 1 / 60);
    for (let i = 0; i < 120 && stuck.getState() === DodgeState.Dodging; i++) stuck.tick(body, NONE, 0, true, 100, 1 / 60);
    let ticks = 0;
    while (stuck.isIntangible() && ticks < 600) {
      stuck.updateIntangibility(true, 1 / 60);
      ticks++;
    }
    expect(ticks / 60).toBeCloseTo(INTANGIBLE_AFTER_DODGE_MAX_S, 1);
  });
});
