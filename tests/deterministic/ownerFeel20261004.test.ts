// Owner, 2026-10-04: the jump height is decided by one rule (tap = short hop, held = full jump — steering never
// changes it); the Beys are 45% faster with faster turns that keep their speed; the stage is a 7 m funnel by default.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const act = (held: Action[], pressed: Action[] = []): ControllerActions => ({ ...NONE, held: new Set(held), pressedThisFrame: new Set(pressed) });

async function harness(overrides = {}): Promise<CombatHarness> {
  const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -20 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 25 }, { ...createDefaultMatchConfig(), arenaFloor: 'flat', ...overrides }); // the shipped defaults, not the harness's mechanism baseline
  for (let i = 0; i < 40; i++) h.tick(NONE, NONE);
  return h;
}

/** Apex (m above the take-off) of one X press held for `holdTicks`, with `extra` keys held the whole time. */
async function jumpApex(holdTicks: number, extra: Action[] = [], runUpTicks = 0): Promise<number> {
  const h = await harness();
  for (let i = 0; i < runUpTicks; i++) h.tick(act([Action.MoveForward]), NONE);
  const y0 = h.first.body.translation().y;
  let apex = 0;
  for (let t = 0; t < 120; t++) {
    const x = t < holdTicks ? [Action.JumpDrift] : [];
    h.tick(act([...x, ...extra], t === 0 ? [Action.JumpDrift] : []), NONE);
    apex = Math.max(apex, h.first.body.translation().y - y0);
  }
  return apex;
}

describe('jump: one rule decides the height (owner, 2026-10-04)', () => {
  it('a tap is always the short hop and a hold is always the full jump, whatever the exact timing', async () => {
    const full = createDefaultMatchConfig().jumpFullHeightM;
    for (const tap of [1, 3, 6]) expect(await jumpApex(tap)).toBeLessThan(0.4);
    for (const hold of [9, 15, 40]) expect(Math.abs((await jumpApex(hold)) - full)).toBeLessThan(0.15);
  });

  it('steering never changes the height: held = full jump, tap = short hop, moving straight or turning', async () => {
    const full = createDefaultMatchConfig().jumpFullHeightM;
    expect(Math.abs((await jumpApex(30, [Action.MoveForward], 60)) - full)).toBeLessThan(0.2);
    expect(Math.abs((await jumpApex(30, [Action.MoveForward, Action.SteerLeft], 60)) - full)).toBeLessThan(0.2);
    expect(await jumpApex(3, [Action.MoveForward, Action.SteerLeft], 60)).toBeLessThan(0.4);
  });
});

describe('speed feel (owner, 2026-10-04)', () => {
  async function topSpeed(overrides = {}): Promise<number> {
    const h = await harness(overrides);
    let peak = 0;
    for (let t = 0; t < 150; t++) {
      h.tick(act([Action.MoveForward]), NONE);
      const v = h.first.body.linvel();
      peak = Math.max(peak, Math.hypot(v.x, v.z));
    }
    return peak;
  }

  it('the Beys run at least 45% faster than before', async () => {
    const now = await topSpeed();
    const before = await topSpeed({ topSpeedScale: 1, accelerationScale: 1, turnRateScale: 1, turnSpeedRetention: 0, momentumGain: 1 });
    expect(now).toBeGreaterThanOrEqual(before * 1.45 - 0.05);
  });

  it('a hard turn at speed keeps far more of its speed', async () => {
    async function speedAfterTurn(overrides = {}): Promise<number> {
      const h = await harness(overrides);
      for (let t = 0; t < 90; t++) h.tick(act([Action.MoveForward]), NONE);
      const v0 = h.first.body.linvel();
      const s0 = Math.hypot(v0.x, v0.z);
      for (let t = 0; t < 30; t++) h.tick(act([Action.MoveForward, Action.SteerLeft]), NONE);
      const v = h.first.body.linvel();
      return Math.hypot(v.x, v.z) / s0;
    }
    const kept = await speedAfterTurn();
    const old = await speedAfterTurn({ turnSpeedRetention: 0 });
    expect(kept).toBeGreaterThan(old);
    expect(kept).toBeGreaterThan(0.85);
  });
});

describe('funnel stage by default (owner, 2026-10-04)', () => {
  it('a match is the Funnel at 7 m by default', () => {
    expect(createDefaultMatchConfig()).toMatchObject({ arenaFloor: 'bowl-b', arenaBowlDepthM: 7 });
  });
});
