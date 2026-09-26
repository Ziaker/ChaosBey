import { describe, expect, it } from 'vitest';
import { AttackState, type ActiveHitbox } from '../../src/combat/attacks/AttackController';
import { detectHits, type HitDetectionSide } from '../../src/combat/hit-detection/HitDetection';
import { BEY_COLLIDER_RADIUS_M } from '../../src/bey/core/BeyTuning';
import { ATTACK_ARCHETYPE, STAMINA_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';

const CIRCULAR_HITBOX: ActiveHitbox = { kind: 'circular', radiusM: 1, knockbackForce: 5, stabilityDamage: 10 };
const DASH_HITBOX: ActiveHitbox = { kind: 'dash', radiusM: 1, knockbackForce: 5, stabilityDamage: 10 };

function side(overrides: Partial<HitDetectionSide> = {}): HitDetectionSide {
  return { positionXZ: { x: 0, z: 0 }, positionYM: 0, hitbox: null, state: AttackState.Neutral, colliderRadiusM: BEY_COLLIDER_RADIUS_M, ...overrides };
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

describe('detectHits — per-Bey collider radius (Milestone 6, GDD section 6/31)', () => {
  // CIRCULAR_HITBOX.radiusM = 1. Default colliderRadiusM = 0.6, so the
  // reach allowance (average of both sides' own radii) is 0.6 by default —
  // reproducing the exact pre-Milestone-6 threshold of 1.6.
  const attackRadius = ATTACK_ARCHETYPE.physical.colliderRadiusM; // 0.65
  const staminaRadius = STAMINA_ARCHETYPE.physical.colliderRadiusM; // 0.58

  it('default-vs-default reach is unchanged from M1-M5 (threshold exactly 1.6)', () => {
    const atThreshold = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive }),
      side({ positionXZ: { x: 1.6, z: 0 } }),
    );
    expect(atThreshold).toHaveLength(1);

    const justBeyond = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive }),
      side({ positionXZ: { x: 1.61, z: 0 } }),
    );
    expect(justBeyond).toHaveLength(0);
  });

  it('an Attack-archetype attacker (0.65) gets real extra reach against a default defender, beyond the old fixed 1.6', () => {
    const events = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive, colliderRadiusM: attackRadius }),
      side({ positionXZ: { x: 1.61, z: 0 } }), // beyond the default-vs-default threshold (1.6)
    );
    // allowance = (0.65 + 0.6) / 2 = 0.625 -> threshold 1.625, so 1.61 connects.
    expect(events).toHaveLength(1);
  });

  it('a Stamina-archetype defender (0.58) does not get the phantom default reach of 0.6', () => {
    const events = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive }),
      side({ positionXZ: { x: 1.6, z: 0 }, colliderRadiusM: staminaRadius }),
    );
    // allowance = (0.6 + 0.58) / 2 = 0.59 -> threshold 1.59, so exactly 1.6 (the old default threshold) now misses.
    expect(events).toHaveLength(0);
  });

  it('two differently-sized Beys combine both their own envelopes (average), not either one alone', () => {
    const justInside = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive, colliderRadiusM: attackRadius }),
      side({ positionXZ: { x: 1.614, z: 0 }, colliderRadiusM: staminaRadius }),
    );
    // allowance = (0.65 + 0.58) / 2 = 0.615 -> threshold 1.615.
    expect(justInside).toHaveLength(1);

    const justOutside = detectHits(
      side({ hitbox: CIRCULAR_HITBOX, state: AttackState.CircularActive, colliderRadiusM: attackRadius }),
      side({ positionXZ: { x: 1.616, z: 0 }, colliderRadiusM: staminaRadius }),
    );
    expect(justOutside).toHaveLength(0);
  });
});
