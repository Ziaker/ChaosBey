// Owner, 2026-10-04 (item 11): "quanto mais rápido, mais dano, mais build up de velocidade = mais movimento no stage
// = mais forte". Through the real tickMatch(): an attack hit's damage follows the attacker's speed, and a Dash keeps
// the speed built up before it (momentum), so a Dash fired at speed hits harder than the same Dash from a standstill.

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { AttackController } from '../../src/combat/attacks/AttackController';
import { DASH_MAX_SPEED_MPS, DASH_MIN_SPEED_MPS } from '../../src/combat/attacks/AttackTuning';
import { SPEED_DAMAGE_MIN_MULTIPLIER, speedDamageMultiplier } from '../../src/combat/attacks/SpeedDamage';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const act = (held: Action[], pressed: Action[] = []): ControllerActions => ({ ...NONE, held: new Set(held), pressedThisFrame: new Set(pressed) });
const LEGACY = { speedDamageGain: 0, dashCarriesSpeed: false };

async function harness(firstZ: number, secondZ: number, overrides = {}): Promise<CombatHarness> {
  const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: firstZ }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: secondZ }, { arenaFloor: 'flat', ...overrides });
  for (let i = 0; i < 30; i++) h.tick(NONE, NONE);
  return h;
}

describe('speedDamageMultiplier', () => {
  it('×1 at the reference speed, more when faster, less when slower, never below the floor; gain 0 = off', () => {
    expect(speedDamageMultiplier(11, 11, 0.5)).toBe(1);
    expect(speedDamageMultiplier(22, 11, 0.5)).toBeCloseTo(1.5, 12);
    expect(speedDamageMultiplier(5.5, 11, 0.5)).toBeCloseTo(0.75, 12);
    expect(speedDamageMultiplier(0, 11, 1.5)).toBe(SPEED_DAMAGE_MIN_MULTIPLIER);
    expect(speedDamageMultiplier(30, 11, 0)).toBe(1);
  });
});

describe('a Dash keeps the speed built up before it (dashCarriesSpeed)', () => {
  function dashSpeedAfterRelease(carries: boolean, entrySpeedMps: number): { speed: number; reference: number | undefined } {
    const attack = new AttackController(undefined, 1.5, carries);
    const tick = (a: ControllerActions, speed = 0) => attack.tick(a, 0, { x: 0, z: 0 }, { x: 0, z: 10 }, 1 / 60, speed);
    tick(act([Action.Attack], [Action.Attack]));
    for (let i = 0; i < 17; i++) tick(act([Action.Attack]));
    tick(NONE, entrySpeedMps); // release: the Dash fires
    const r = tick(NONE, entrySpeedMps);
    return { speed: r.dashOverride!.longitudinalSpeedMps, reference: r.activeHitbox?.referenceSpeedMps };
  }

  it('fired at 22 m/s it runs at 22 m/s; without the rule it drops to its own speed', () => {
    const carried = dashSpeedAfterRelease(true, 22);
    const legacy = dashSpeedAfterRelease(false, 22);
    expect(carried.speed).toBe(22);
    expect(legacy.speed).toBeGreaterThanOrEqual(DASH_MIN_SPEED_MPS);
    expect(legacy.speed).toBeLessThanOrEqual(DASH_MAX_SPEED_MPS);
    // The hit's damage stays tuned to the Dash's own speed for its charge.
    expect(carried.reference).toBe(legacy.speed);
  });

  it('never slower than its own speed: a Dash from a crawl is unchanged', () => {
    expect(dashSpeedAfterRelease(true, 2).speed).toBe(dashSpeedAfterRelease(false, 2).speed);
  });

  it('is on in a match and off for bare constructions', () => {
    expect(createDefaultMatchConfig().dashCarriesSpeed).toBe(true);
    expect(createDefaultMatchConfig().speedDamageGain).toBeGreaterThan(0);
  });
});

describe('item 11 through tickMatch: faster = more damage', () => {
  /** First charges a Dash at rest and releases it at second; optionally already moving at `entrySpeedMps` toward it. */
  async function dashDamage(entrySpeedMps: number | null, overrides = {}): Promise<number> {
    const h = await harness(-2.5, 2.5, overrides);
    let damage = 0;
    for (let t = 0; t < 90; t++) {
      const firstA = t < 18 ? act([Action.Attack], t === 0 ? [Action.Attack] : []) : NONE;
      if (t === 18 && entrySpeedMps !== null) h.first.body.setLinvel({ x: 0, y: 0, z: entrySpeedMps }, true);
      const r = h.tick(firstA, NONE);
      for (const e of r.combatEvents) if (e.kind === 'stabilityDamage' && !e.targetIsFirst) damage += e.amount;
    }
    return damage;
  }

  it('the same Dash fired at 22 m/s (full momentum) deals clearly more than from a standstill', async () => {
    const still = await dashDamage(null);
    const fast = await dashDamage(22);
    expect(still).toBeGreaterThan(0);
    // ×1.49 here: 22 m/s against this Dash's own ~11.1 m/s at the default 50% gain.
    expect(fast).toBeGreaterThan(still * 1.4);
    expect(fast).toBeLessThan(still * 1.6);
  });

  it('one contact, one collision: the fast Dash\'s hit is not followed by a body collision on the same contact', async () => {
    const h = await harness(-2.5, 2.5);
    const damageEvents: number[] = [];
    let bodyCollisions = 0;
    for (let t = 0; t < 90; t++) {
      if (t === 18) h.first.body.setLinvel({ x: 0, y: 0, z: 22 }, true);
      const r = h.tick(t < 18 ? act([Action.Attack], t === 0 ? [Action.Attack] : []) : NONE, NONE);
      for (const e of r.combatEvents) {
        if (e.kind === 'stabilityDamage' && !e.targetIsFirst) damageEvents.push(e.amount);
        if (e.kind === 'bodyCollision') bodyCollisions++;
      }
    }
    expect(damageEvents).toHaveLength(1);
    expect(bodyCollisions).toBe(0);
  });

  it('from a standstill the Dash deals what it did before the rule (its speed is its reference)', async () => {
    const still = await dashDamage(null);
    const legacy = await dashDamage(null, LEGACY);
    expect(still).toBeGreaterThan(legacy * 0.95);
    expect(still).toBeLessThan(legacy * 1.05);
  });

  it('with the rule off, speed changes nothing (the pre-item-11 game)', async () => {
    const still = await dashDamage(null, LEGACY);
    const fast = await dashDamage(22, LEGACY);
    expect(fast).toBeCloseTo(still, 6);
  });

  /** First taps a Circular with second right beside it, standing still: a hit from a standstill. */
  async function standingCircularDamage(overrides = {}): Promise<number> {
    const h = await harness(-0.9, 0.9, overrides);
    let damage = 0;
    for (let t = 0; t < 30; t++) {
      const r = h.tick(t === 0 ? act([Action.Attack], [Action.Attack]) : NONE, NONE);
      for (const e of r.combatEvents) if (e.kind === 'stabilityDamage' && !e.targetIsFirst) damage += e.amount;
    }
    return damage;
  }

  it('a Circular from a standstill hurts half as much (the ×0.5 floor at the default gain)', async () => {
    const withRule = await standingCircularDamage();
    const legacy = await standingCircularDamage(LEGACY);
    expect(legacy).toBeGreaterThan(0);
    expect(withRule / legacy).toBeGreaterThan(0.45);
    expect(withRule / legacy).toBeLessThan(0.6);
  });
});
