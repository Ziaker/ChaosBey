// Owner audit, 2026-10-03 — B3/B4/B5 (Lote 3's body collisions), through the real tickMatch():
// B3: no ghost collision with one Bey above the other: the vertical overlap comes from the bodies' real
//     half-heights (the same rule as the physics contact filter), not the horizontal reach.
// B4: a tie favours nobody: same Bey, same speeds, mirrored — identical results with first/second swapped; neither
//     loses momentum, both take the minimum damage, no knockback.
// B5: one collision per contact, really: held in contact far longer than the 0.35 s cooldown, still one; only a
//     separation re-arms it.

import { describe, expect, it } from 'vitest';
import { ATTACK_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { BODY_COLLISION_COOLDOWN_S, BODY_COLLISION_MIN_DAMAGE } from '../../src/bey/momentum/MomentumTuning';
import type { ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };

async function harness(): Promise<CombatHarness> {
  const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -4 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 4 }, { arenaFloor: 'flat' }, undefined, { first: ATTACK_ARCHETYPE, second: ATTACK_ARCHETYPE });
  for (let i = 0; i < 20; i++) h.tick(NONE, NONE);
  return h;
}

describe('B3 — no ghost body collision with one Bey above the other', () => {
  /** First driven at the second, which sits `dyAbove` higher at nearly the same XZ (or far away: `control`). */
  async function above(dyAbove: number, control: boolean) {
    const h = await harness();
    const p = h.first.body.translation();
    const s0 = { first: h.first.stability.resource.value, second: h.second.stability.resource.value };
    let events = 0;
    for (let t = 0; t < 3; t++) {
      h.second.body.setTranslation({ x: control ? p.x + 20 : p.x, y: p.y + dyAbove, z: p.z + 0.6 }, true);
      h.second.body.setLinvel({ x: 0, y: 0, z: -4 }, true);
      h.first.body.setLinvel({ x: 0, y: 0, z: 4 }, true);
      events += h.tick(NONE, NONE).combatEvents.filter((e) => e.kind === 'bodyCollision' || e.kind === 'knockback').length;
    }
    const out = { events, damage: { first: s0.first - h.first.stability.resource.value, second: s0.second - h.second.stability.resource.value } };
    h.dispose();
    return out;
  }

  it('nearly the same XZ, closing fast, but clear above it: no collision, no knockback, and the same damage as with it far away', async () => {
    const reachY = ATTACK_ARCHETYPE.physical.colliderHalfHeightM * 2;
    for (const dy of [reachY + 0.05, reachY + 0.3, 1.0]) {
      const r = await above(dy, false);
      const c = await above(dy, true);
      expect(r.events, `dy ${dy}`).toBe(0);
      expect(r.damage, `dy ${dy}`).toEqual(c.damage);
    }
  });

  it('control: overlapping in height, the same approach is a collision', async () => {
    const r = await above(0, false);
    expect(r.events).toBeGreaterThan(0);
  });
});

/** The two Beys (same definition) driven straight into each other at the given speeds. */
async function collide(firstMps: number, secondMps: number) {
  const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -1.2 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 1.2 }, { arenaFloor: 'flat' }, undefined, { first: ATTACK_ARCHETYPE, second: ATTACK_ARCHETYPE });
  for (let i = 0; i < 20; i++) h.tick(NONE, NONE);
  h.first.momentum.debugSet(1);
  h.second.momentum.debugSet(1);
  const s0 = { first: h.first.stability.resource.value, second: h.second.stability.resource.value };
  const events: { kind: string; targetIsFirst: boolean }[] = [];
  for (let i = 0; i < 30 && !events.some((e) => e.kind === 'bodyCollision'); i++) {
    h.first.body.setLinvel({ x: 0, y: 0, z: firstMps }, true);
    h.second.body.setLinvel({ x: 0, y: 0, z: -secondMps }, true);
    for (const e of h.tick(NONE, NONE).combatEvents) if ('targetIsFirst' in e && e.targetIsFirst !== undefined) events.push({ kind: e.kind, targetIsFirst: e.targetIsFirst as boolean });
  }
  const out = {
    damage: { first: s0.first - h.first.stability.resource.value, second: s0.second - h.second.stability.resource.value },
    momentum: { first: h.first.momentum.value, second: h.second.momentum.value },
    events,
  };
  h.dispose();
  return out;
}

describe('B4 — a tie favours nobody', () => {
  it('same Bey, same speed: both take the minimum damage, nobody loses momentum, no knockback', async () => {
    const r = await collide(7, 7);
    expect(r.events.filter((e) => e.kind === 'bodyCollision').map((e) => e.targetIsFirst).sort()).toEqual([false, true]);
    expect(r.events.some((e) => e.kind === 'knockback')).toBe(false);
    expect(r.damage.first).toBeCloseTo(BODY_COLLISION_MIN_DAMAGE, 9);
    expect(r.damage.second).toBeCloseTo(BODY_COLLISION_MIN_DAMAGE, 9);
    expect(r.momentum.first).toBe(r.momentum.second);
    expect(r.momentum.first).toBeGreaterThan(0.9);
  });

  it('mirrored: swapping first and second mirrors the result exactly (4 vs 10 and 10 vs 4)', async () => {
    const a = await collide(4, 10);
    const b = await collide(10, 4);
    expect(a.damage.first).toBeCloseTo(b.damage.second, 9);
    expect(a.damage.second).toBeCloseTo(b.damage.first, 9);
    expect(a.momentum.first).toBeCloseTo(b.momentum.second, 9);
    expect(a.momentum.second).toBeCloseTo(b.momentum.first, 9);
    expect(a.events.map((e) => `${e.kind}:${e.targetIsFirst}`)).toEqual(b.events.map((e) => `${e.kind}:${!e.targetIsFirst}`));
  });
});

describe('B5 — one collision per contact, however long the contact lasts', () => {
  it('pushed together for 3 s (> 8× the cooldown): one collision; separate and come back: a second one', async () => {
    const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -1.4 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 1.4 }, { arenaFloor: 'flat' }, undefined, { first: ATTACK_ARCHETYPE, second: ATTACK_ARCHETYPE });
    for (let i = 0; i < 20; i++) h.tick(NONE, NONE);
    let collisions = 0;
    const count = () => {
      // Keep shoving them into each other at a qualifying closing speed every tick.
      h.first.body.setLinvel({ x: 0, y: 0, z: 3 }, true);
      h.second.body.setLinvel({ x: 0, y: 0, z: -3 }, true);
      collisions += h.tick(NONE, NONE).combatEvents.filter((e) => e.kind === 'bodyCollision').length;
    };
    expect(3).toBeGreaterThan(8 * BODY_COLLISION_COOLDOWN_S);
    for (let t = 0; t < 180; t++) count();
    const inContact = collisions;
    // Separate for real, then come back together.
    for (let t = 0; t < 40; t++) {
      h.first.body.setLinvel({ x: 0, y: 0, z: -4 }, true);
      h.second.body.setLinvel({ x: 0, y: 0, z: 4 }, true);
      h.tick(NONE, NONE);
    }
    for (let t = 0; t < 60; t++) count();
    expect(inContact).toBe(2); // a tie: one event per side
    expect(collisions).toBe(4);
    h.dispose();
  });
});
