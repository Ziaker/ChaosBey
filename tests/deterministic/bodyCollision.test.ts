// Owner, 2026-10-02 (Lote 3, items 5/9/11): momentum raises the top speed,
// and Beys that touch without attacking collide by speed difference — the
// slower takes Stability damage ∝ the difference (plus knockback), the
// faster loses momentum; equal speeds give a minimal symmetric damage.
// Through the real tickMatch().

import { describe, expect, it } from 'vitest';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { BODY_COLLISION_MIN_DAMAGE } from '../../src/bey/momentum/MomentumTuning';
import { CIRCULAR_STABILITY_DAMAGE } from '../../src/combat/attacks/AttackTuning';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const FORWARD: ControllerActions = { ...NONE, held: new Set([Action.MoveForward]) };

/** First at z = -1.2 moving +z at `firstMps`, second at z = +1.2 moving -z at `secondMps`, on a flat floor; runs until they touch. */
async function collide(firstMps: number, secondMps: number, overrides = {}) {
  const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -1.2 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 1.2 }, { arenaFloor: 'flat', ...overrides });
  for (let i = 0; i < 20; i++) harness.tick(NONE, NONE);
  const stability0 = { first: harness.first.stability.resource.value, second: harness.second.stability.resource.value };
  harness.first.momentum.debugSet(1);
  harness.second.momentum.debugSet(1);
  let event: { targetIsFirst: boolean; damage: number; speedDifferenceMps: number } | null = null;
  for (let i = 0; i < 30 && !event; i++) {
    harness.first.body.setLinvel({ x: 0, y: 0, z: firstMps }, true);
    harness.second.body.setLinvel({ x: 0, y: 0, z: -secondMps }, true);
    const r = harness.tick(firstMps > 0 ? FORWARD : NONE, secondMps > 0 ? FORWARD : NONE);
    const e = r.combatEvents.find((c) => c.kind === 'bodyCollision');
    if (e && e.kind === 'bodyCollision') event = e;
  }
  return {
    harness,
    event,
    damage: { first: stability0.first - harness.first.stability.resource.value, second: stability0.second - harness.second.stability.resource.value },
  };
}

describe('body collision by speed difference (owner, 2026-10-02)', () => {
  it('at 4 vs 10 m/s the slower Bey takes far more damage; the faster loses momentum', async () => {
    const { harness, event, damage } = await collide(4, 10);
    expect(event).not.toBeNull();
    expect(event!.targetIsFirst).toBe(true);
    expect(damage.first).toBeGreaterThan(damage.second * 3);
    // ×1 = a Circular's damage at a 10 m/s difference: 6 m/s here (within the controller's own velocity shaping).
    expect(damage.first).toBeGreaterThan(BODY_COLLISION_MIN_DAMAGE + (CIRCULAR_STABILITY_DAMAGE / 10) * 4);
    expect(harness.second.momentum.value).toBeLessThan(0.6);
    expect(harness.first.momentum.value).toBeGreaterThan(0.9);
  });

  it('equal speeds: minimal, symmetric damage', async () => {
    const { event, damage } = await collide(7, 7);
    expect(event).not.toBeNull();
    expect(damage.first).toBeCloseTo(damage.second, 0); // the controller shapes each velocity a little differently
    expect(damage.first).toBeLessThan(BODY_COLLISION_MIN_DAMAGE + 1);
    expect(damage.first).toBeGreaterThan(0);
  });

  it('the slider scales it, and 0 turns it off', async () => {
    const strong = await collide(4, 10, { bodyCollisionDamage: 2 });
    const normal = await collide(4, 10);
    expect(strong.damage.first).toBeGreaterThan(normal.damage.first * 1.5);
    const off = await collide(4, 10, { bodyCollisionDamage: 0 });
    expect(off.damage.first).toBe(0);
    expect(off.damage.second).toBe(0);
  });

  it('one collision per contact (cooldown), and deterministic', async () => {
    const a = await collide(4, 10);
    const b = await collide(4, 10);
    expect(a.damage).toEqual(b.damage);
    let count = 0;
    for (let i = 0; i < 10; i++) if (a.harness.tick(NONE, NONE).combatEvents.some((c) => c.kind === 'bodyCollision')) count++;
    expect(count).toBe(0);
  });

  it('momentum raises the real top speed', async () => {
    const run = async (momentum: number, momentumGain = 1) => {
      const harness = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -30 }, { x: 25, y: BEY_SPAWN_HEIGHT_M, z: 25 }, { arenaFloor: 'flat', momentumDecayS: 1000, momentumGain });
      for (let i = 0; i < 10; i++) harness.tick(NONE, NONE);
      harness.first.momentum.debugSet(momentum);
      let peak = 0;
      for (let i = 0; i < 150; i++) peak = Math.max(peak, harness.tick(FORWARD, NONE).first.movement.speedMps);
      return { peak, base: harness.first.movement.getMaxSpeedMps() };
    };
    const without = await run(0, 0); // gain 0: no boost at all, however much momentum builds
    const full = await run(1);
    expect(without.peak).toBeLessThanOrEqual(without.base * 1.05);
    expect(full.peak).toBeGreaterThan(without.base * 1.5);
  });
});
