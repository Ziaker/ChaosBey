import { describe, expect, it } from 'vitest';
import { AttackState, type ActiveHitbox } from '../../src/combat/attacks/AttackController';
import { detectHits } from '../../src/combat/hit-detection/HitDetection';

const CIRCULAR_HITBOX: ActiveHitbox = { kind: 'circular', radiusM: 1, knockbackForce: 5, stabilityDamage: 10 };
const DASH_HITBOX: ActiveHitbox = { kind: 'dash', radiusM: 1, knockbackForce: 5, stabilityDamage: 10 };

describe('detectHits', () => {
  it('detects a hit when the attacker hitbox overlaps the defender collider', () => {
    const events = detectHits({ x: 0, z: 0 }, CIRCULAR_HITBOX, AttackState.CircularActive, { x: 1, z: 0 }, null, AttackState.Neutral);

    expect(events).toHaveLength(1);
    expect(events[0]?.attackerIsFirst).toBe(true);
    expect(events[0]?.hitbox).toBe(CIRCULAR_HITBOX);
  });

  it('detects no hit when the attacker hitbox does not reach the defender', () => {
    const events = detectHits({ x: 0, z: 0 }, CIRCULAR_HITBOX, AttackState.CircularActive, { x: 10, z: 0 }, null, AttackState.Neutral);

    expect(events).toHaveLength(0);
  });

  it('checks both sides independently, allowing a simultaneous double-hit', () => {
    const events = detectHits(
      { x: 0, z: 0 },
      CIRCULAR_HITBOX,
      AttackState.CircularActive,
      { x: 1, z: 0 },
      CIRCULAR_HITBOX,
      AttackState.CircularActive,
    );

    expect(events).toHaveLength(2);
    expect(events.some((e) => e.attackerIsFirst)).toBe(true);
    expect(events.some((e) => !e.attackerIsFirst)).toBe(true);
  });

  it('produces no events when neither side has an active hitbox', () => {
    const events = detectHits({ x: 0, z: 0 }, null, AttackState.Neutral, { x: 1, z: 0 }, null, AttackState.Neutral);

    expect(events).toHaveLength(0);
  });

  it('GDD 23/107: a Circular Attack catching an opponent mid-Dash sets caughtOpponentDashing', () => {
    const events = detectHits(
      { x: 0, z: 0 },
      CIRCULAR_HITBOX,
      AttackState.CircularActive,
      { x: 1, z: 0 },
      null,
      AttackState.DashActive,
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.caughtOpponentDashing).toBe(true);
  });

  it('does not set caughtOpponentDashing when the defender is not mid-Dash', () => {
    const events = detectHits(
      { x: 0, z: 0 },
      CIRCULAR_HITBOX,
      AttackState.CircularActive,
      { x: 1, z: 0 },
      null,
      AttackState.Neutral,
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.caughtOpponentDashing).toBe(false);
  });

  it('does not set caughtOpponentDashing for a Dash Attack hitbox even against a Dashing opponent', () => {
    const events = detectHits({ x: 0, z: 0 }, DASH_HITBOX, AttackState.DashActive, { x: 1, z: 0 }, null, AttackState.DashActive);

    expect(events).toHaveLength(1);
    expect(events[0]?.caughtOpponentDashing).toBe(false);
  });
});
