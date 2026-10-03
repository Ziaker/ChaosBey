// Owner, 2026-10-02 (Lote 9, items 2/3/20): the Pregame options that were missing, each through MatchConfig into
// the real match: bowl depth (one h(r) for collider, spawns and every floor reader), round timer and win conditions,
// acceleration / top speed / air control, jump Stamina cost and cooldown — plus remembering the last setup.

import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { BOWL_DEPTH_M, floorHeightAt, floorRimHeight, type ArenaFloor } from '../../src/arena/floor/ArenaFloorProfile';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { RoundOutcome, RoundState } from '../../src/combat/round-rules/RoundState';
import { arenaFloorOf, resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { createDefaultMatchSetup, defaultMatchRules, loadLastSetup, matchConfigFor, saveLastSetup, sanitizeMatchRules, changedRuleLines } from '../../src/app/frontend/matchSetup';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const act = (held: Action[], pressed: Action[] = []): ControllerActions => ({ ...NONE, held: new Set(held), pressedThisFrame: new Set(pressed) });

describe('item 3 — bowl depth (funnel): collider, spawns and floor readers share one h(r)', () => {
  for (const depth of [0, 2.5, 5]) {
    it(`${depth} m: the physics floor under a ray matches floorHeightAt at 0/4/8/11 m; rim = depth; spawns sit on it`, async () => {
      const parts = await CombatHarness.create(undefined, undefined, { arenaFloor: 'bowl-b', arenaBowlDepthM: depth });
      const floor: ArenaFloor = arenaFloorOf(resolveMatchConfig({ arenaFloor: 'bowl-b', arenaBowlDepthM: depth }));
      expect(floorRimHeight(floor)).toBeCloseTo(depth, 9);
      parts.physics.step(); // the scene-query structures are built by a step
      let checked = 0;
      for (const r of [0, 4, 8, 11]) {
        const ray = new RAPIER.Ray({ x: r, y: 20, z: 0.3 }, { x: 0, y: -1, z: 0 });
        const hit = parts.physics.rapierWorld.castRay(ray, 40, true, undefined, undefined, undefined, parts.first.body);
        const hitOther = hit && hit.collider.parent()?.handle === parts.second.body.handle;
        if (!hit || hitOther) continue;
        expect(20 - hit.timeOfImpact, `r ${r}`).toBeCloseTo(floorHeightAt(floor, r, 0.3), 1);
        checked++;
      }
      expect(checked).toBeGreaterThanOrEqual(3);
      // A spawned Bey settles on the floor at this depth.
      for (let i = 0; i < 90; i++) parts.physics.step();
      const p = parts.first.body.translation();
      expect(p.y - floorHeightAt(floor, p.x, p.z)).toBeLessThan(BEY_SPAWN_HEIGHT_M + 0.3);
      expect(p.y - floorHeightAt(floor, p.x, p.z)).toBeGreaterThan(0);
    });
  }

  it('the default depth is the old 2.5 m, and 0 m is flat', () => {
    expect(resolveMatchConfig().arenaBowlDepthM).toBe(BOWL_DEPTH_M);
    expect(floorHeightAt({ id: 'bowl-a', depthM: 0 }, 9, 0)).toBe(0);
    expect(floorHeightAt({ id: 'bowl-a', depthM: 5 }, 9, 0)).toBeCloseTo(2 * floorHeightAt('bowl-a', 9, 0), 9);
  });
});

describe('item 20 — round rules', () => {
  it('a time limit ends an undecided round in a Draw at the limit; 0 = no timer', () => {
    const timed = new RoundState({ timeLimitS: 1 });
    for (let i = 0; i < 59; i++) timed.tickClock(1 / 60);
    expect(timed.isOver).toBe(false);
    timed.tickClock(1 / 60);
    expect(timed.result).toBe(RoundOutcome.Draw);
    const free = new RoundState();
    for (let i = 0; i < 60 * 600; i++) free.tickClock(1 / 60);
    expect(free.isOver).toBe(false);
    expect(free.timeLeftS).toBeNull();
  });

  it('a win condition that is off never ends the round; the others still do', () => {
    const noKo = new RoundState({ winConditions: { ko: false, ringOut: true, spinOut: true } });
    noKo.resolveTick({ firstKoed: true, secondKoed: false, firstRingOut: false, secondRingOut: false });
    expect(noKo.isOver).toBe(false);
    noKo.resolveTick({ firstKoed: false, secondKoed: false, firstRingOut: false, secondRingOut: true });
    expect(noKo.result).toBe(RoundOutcome.FirstWinsByRingOut);
    const noSpin = new RoundState({ winConditions: { ko: true, ringOut: true, spinOut: false } });
    noSpin.resolveTick({ firstKoed: false, secondKoed: false, firstRingOut: false, secondRingOut: false, firstSpunOut: true });
    expect(noSpin.isOver).toBe(false);
  });

  it('in a real match: Stamina 0 with spin-out off keeps playing; the time limit ends it', async () => {
    const h = await CombatHarness.create(undefined, undefined, { winBySpinOut: false, roundTimeLimitS: 2 });
    h.second.stamina.resource.set(0);
    let ticks = 0;
    while (!h.roundState.isOver && ticks < 300) {
      h.tick(NONE, NONE);
      ticks++;
    }
    expect(h.roundState.result).toBe(RoundOutcome.Draw);
    expect(Math.abs(ticks - 120)).toBeLessThanOrEqual(2);
  });

  it('at least one win condition stays on; ring-out off brings a 90 s timer if none was set', () => {
    const none = sanitizeMatchRules({ ...defaultMatchRules(), winByKo: false, winByRingOut: false, winBySpinOut: false });
    expect([none.winByKo, none.winByRingOut, none.winBySpinOut]).toEqual([true, true, true]);
    const noRing = sanitizeMatchRules({ ...defaultMatchRules(), winByRingOut: false });
    expect(noRing.roundTimeLimitS).toBe(90);
    expect(sanitizeMatchRules({ ...defaultMatchRules(), winByRingOut: false, roundTimeLimitS: 45 }).roundTimeLimitS).toBe(45);
  });
});

describe('item 20 — movement and jump rules', () => {
  /** Top speed reached and ticks to 8 m/s, driving straight on a flat floor. */
  async function drive(overrides = {}) {
    const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -14 }, { x: 25, y: BEY_SPAWN_HEIGHT_M, z: 25 }, { arenaFloor: 'flat', momentumGain: 0, ...overrides });
    for (let i = 0; i < 30; i++) h.tick(NONE, NONE);
    let top = 0;
    let to8 = -1;
    for (let t = 0; t < 150; t++) {
      h.tick(act([Action.MoveForward]), NONE);
      const v = h.first.body.linvel();
      const s = Math.hypot(v.x, v.z);
      top = Math.max(top, s);
      if (to8 < 0 && s >= 8) to8 = t;
    }
    h.dispose();
    return { top, to8 };
  }

  it('acceleration and top speed scale the real movement', async () => {
    const base = await drive();
    const quick = await drive({ accelerationScale: 2 });
    const fast = await drive({ topSpeedScale: 1.3 });
    expect(quick.to8).toBeLessThan(base.to8);
    expect(fast.top).toBeGreaterThan(base.top * 1.2);
  });

  it('a jump costs its Stamina when it begins; without enough, no jump; the cooldown spaces jumps', async () => {
    const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -14 }, { x: 25, y: BEY_SPAWN_HEIGHT_M, z: 25 }, { arenaFloor: 'flat', jumpStaminaCost: 10, jumpCooldownS: 3 });
    for (let i = 0; i < 30; i++) h.tick(NONE, NONE);
    const before = h.first.stamina.resource.value;
    const r = h.tick(act([Action.JumpDrift], [Action.JumpDrift]), NONE);
    expect(r.first.driftState).toBe('Hopping');
    expect(before - h.first.stamina.resource.value).toBeGreaterThan(10);
    expect(before - h.first.stamina.resource.value).toBeLessThan(10.2);
    // Land, then a second press inside the 3 s cooldown waits for it.
    for (let i = 0; i < 100; i++) h.tick(NONE, NONE);
    let hopAt = -1;
    for (let t = 0; t < 200 && hopAt < 0; t++) {
      if (h.tick(t === 0 ? act([Action.JumpDrift], [Action.JumpDrift]) : NONE, NONE).first.driftState === 'Hopping') hopAt = t;
    }
    expect(hopAt).toBeGreaterThan(60); // ~3 s after the first, not at once
    // Not enough Stamina: no jump.
    for (let i = 0; i < 200; i++) h.tick(NONE, NONE);
    h.first.stamina.resource.set(5);
    let hopped = false;
    for (let t = 0; t < 30; t++) if (h.tick(t === 0 ? act([Action.JumpDrift], [Action.JumpDrift]) : NONE, NONE).first.driftState === 'Hopping') hopped = true;
    expect(hopped).toBe(false);
  });
});

describe('the Pregame remembers the last setup and explains what changed', () => {
  it('saves and loads every rule and visual option; bad or unknown data falls back to the default', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const setup = {
      ...createDefaultMatchSetup('defense-b'),
      rules: { ...defaultMatchRules(), dashCooldownS: 3, arenaBowlDepthM: 4, winBySpinOut: false },
      visual: { intensity: 0.5, groundWaves: 0, dust: 1.2, motionTrails: 0.7, impactFlash: 1.3 },
      seedText: 'x',
    };
    saveLastSetup(setup, storage);
    const back = loadLastSetup(storage)!;
    expect(back.playerBeyId).toBe('defense-b');
    expect(back.rules).toEqual(setup.rules);
    expect(back.visual).toEqual(setup.visual);
    expect(back.seedText).toBeNull();
    expect(matchConfigFor(back)).toMatchObject({ dashCooldownS: 3, arenaBowlDepthM: 4, winBySpinOut: false });
    store.set('chaosbey.pregame.last.v1', '{not json');
    expect(loadLastSetup(storage)).toBeNull();
    store.set('chaosbey.pregame.last.v1', JSON.stringify({ playerBeyId: 'nope', rules: { dashCooldownS: 'fast' } }));
    expect(loadLastSetup(storage)).toMatchObject({ playerBeyId: createDefaultMatchSetup().playerBeyId, rules: defaultMatchRules() });
  });

  it('"What to expect" lists every rule moved from its default', () => {
    const setup = { ...createDefaultMatchSetup(), rules: { ...defaultMatchRules(), jumpCooldownS: 1, topSpeedScale: 1.2 } };
    expect(changedRuleLines(setup)).toEqual(['top speed ×1.20', 'jump cooldown 1.0 s']);
    expect(changedRuleLines(createDefaultMatchSetup())).toEqual([]);
  });
});
