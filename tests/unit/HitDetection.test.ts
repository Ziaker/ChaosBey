import { describe, expect, it } from 'vitest';
import { AttackState, type ActiveHitbox } from '../../src/combat/attacks/AttackController';
import { detectHits, type HitDetectionSide } from '../../src/combat/hit-detection/HitDetection';

const CIRCULAR_HITBOX: ActiveHitbox = { kind: 'circular', radiusM: 1, knockbackForce: 5, stabilityDamage: 10 };
const DASH_HITBOX: ActiveHitbox = { kind: 'dash', radiusM: 1, knockbackForce: 5, stabilityDamage: 10 };

function side(overrides: Partial<HitDetectionSide> = {}): HitDetectionSide {
  return { positionXZ: { x: 0, z: 0 }, positionYM: 0, hitbox: null, state: AttackState.Neutral, ...overrides };
}

describe('detectHits', () => {
  it('detects a hit when the attacker hitbox overlaps the defender collider at the same height', () => {
    const events = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive }),
      side({ positionXZ: { x: 1, z: 0 } }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.attackerIsFirst).toBe(true);
    expect(events[0]?.hitbox).toBe(CIRCULAR_HITBOX);
  });

  it('detects no hit when the attacker hitbox does not reach the defender horizontally', () => {
    const events = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive }),
      side({ positionXZ: { x: 10, z: 0 } }),
    );

    expect(events).toHaveLength(0);
  });

  it('misses when the two Beys are horizontally aligned but too far apart vertically (GDD 20/109: not a flat 2D check)', () => {
    const events = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive, positionYM: 0 }),
      side({ positionXZ: { x: 1, z: 0 }, positionYM: 5 }),
    );

    expect(events).toHaveLength(0);
  });

  it('still hits despite a modest vertical offset within the hitbox reach (e.g. a hop apex)', () => {
    const events = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive, positionYM: 0.5 }),
      side({ positionXZ: { x: 1, z: 0 }, positionYM: 0 }),
    );

    expect(events).toHaveLength(1);
  });

  it('checks both sides independently, allowing a simultaneous double-hit', () => {
    const events = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive }),
      side({ positionXZ: { x: 1, z: 0 }, hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive }),
    );

    expect(events).toHaveLength(2);
    expect(events.some((e) => e.attackerIsFirst)).toBe(true);
    expect(events.some((e) => !e.attackerIsFirst)).toBe(true);
  });

  it('produces no events when neither side has an active hitbox', () => {
    const events = detectHits(side(), side({ positionXZ: { x: 1, z: 0 } }));

    expect(events).toHaveLength(0);
  });

  it('GDD 23/107: a Circular Attack catching an opponent mid-Dash sets caughtOpponentDashing', () => {
    const events = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive }),
      side({ positionXZ: { x: 1, z: 0 }, state: AttackState.DashActive }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.caughtOpponentDashing).toBe(true);
  });

  it('does not set caughtOpponentDashing when the defender is not mid-Dash', () => {
    const events = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive }),
      side({ positionXZ: { x: 1, z: 0 } }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.caughtOpponentDashing).toBe(false);
  });

  it('does not set caughtOpponentDashing for a Dash Attack hitbox even against a Dashing opponent', () => {
    const events = detectHits(
      side({ hitbox: DASH_HITBOX, state: AttackState.DashActive }),
      side({ positionXZ: { x: 1, z: 0 }, state: AttackState.DashActive }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]?.caughtOpponentDashing).toBe(false);
  });
});
