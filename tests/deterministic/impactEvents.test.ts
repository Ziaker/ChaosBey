// ============================================================
// IMPACT EVENTS SELF-TESTS
// Pure-function tests against hand-built fixtures (no physics harness
// needed — buildImpactEventsForTick only reads plain data).
// ============================================================

import { describe, expect, it } from 'vitest';
import type { ActiveHitbox } from '../../src/combat/attacks/AttackController';
import type { HitEvent } from '../../src/combat/hit-detection/HitDetection';
import type { CombatEvent } from '../../src/app/simulation/tickMatch';
import { buildImpactEventsForTick, type ImpactEventsResultSubset } from '../../src/camera/ImpactEvents';
import { KO_MAGNITUDE, RING_OUT_MAGNITUDE, STABILITY_BREAK_MAGNITUDE } from '../../src/camera/ImpactMagnitude';

const FIRST_POS = { x: 1, y: 0, z: 2 };
const SECOND_POS = { x: -3, y: 0, z: 4 };

function emptyResult(): ImpactEventsResultSubset {
  return {
    hitEvents: [],
    combatEvents: [],
    first: { movement: { impactDeltaSpeedMps: 0 }, justLanded: false, landingIntensity: 0 },
    second: { movement: { impactDeltaSpeedMps: 0 }, justLanded: false, landingIntensity: 0 },
  };
}

const HITBOX: ActiveHitbox = { kind: 'circular', radiusM: 1, knockbackForce: 20, stabilityDamage: 8 };

describe('buildImpactEventsForTick', () => {
  it('returns an empty array when nothing happened this tick', () => {
    expect(buildImpactEventsForTick(emptyResult(), FIRST_POS, SECOND_POS)).toEqual([]);
  });

  it('maps a hitEvent to a "hit" centered on the defender (not the attacker)', () => {
    const result = emptyResult();
    const hit: HitEvent = { attackerIsFirst: true, hitbox: HITBOX, caughtOpponentDashing: false };
    result.hitEvents = [hit];

    const events = buildImpactEventsForTick(result, FIRST_POS, SECOND_POS);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'hit', isFirst: false, worldPositionM: SECOND_POS });
    expect(events[0]!.magnitude).toBeGreaterThan(0);
  });

  it('maps stabilityBreak/ko/ringOut/perfectDodge/dodged combatEvents to fixed-floor magnitudes, and ignores stabilityDamage/knockback', () => {
    const result = emptyResult();
    const combatEvents: CombatEvent[] = [
      { kind: 'stabilityDamage', targetIsFirst: true, amount: 8 },
      { kind: 'stabilityBreak', targetIsFirst: true },
      { kind: 'knockback', targetIsFirst: false, force: 20 },
      { kind: 'ko', targetIsFirst: false },
      { kind: 'ringOut', targetIsFirst: true },
      { kind: 'perfectDodge', targetIsFirst: false },
      { kind: 'dodged', targetIsFirst: true },
    ];
    result.combatEvents = combatEvents;

    const events = buildImpactEventsForTick(result, FIRST_POS, SECOND_POS);
    const kinds = events.map((e) => e.kind);
    // stabilityDamage and knockback are intentionally not mapped.
    expect(kinds).not.toContain('stabilityDamage');
    expect(kinds).not.toContain('knockback');
    expect(kinds.sort()).toEqual(['dodged', 'ko', 'perfectDodge', 'ringOut', 'stabilityBreak'].sort());

    const stabilityBreakEvent = events.find((e) => e.kind === 'stabilityBreak')!;
    expect(stabilityBreakEvent.magnitude).toBe(STABILITY_BREAK_MAGNITUDE);
    expect(stabilityBreakEvent.isFirst).toBe(true);
    expect(stabilityBreakEvent.worldPositionM).toEqual(FIRST_POS);

    const koEvent = events.find((e) => e.kind === 'ko')!;
    expect(koEvent.magnitude).toBe(KO_MAGNITUDE);
    expect(koEvent.isFirst).toBe(false);
    expect(koEvent.worldPositionM).toEqual(SECOND_POS);

    const ringOutEvent = events.find((e) => e.kind === 'ringOut')!;
    expect(ringOutEvent.magnitude).toBe(RING_OUT_MAGNITUDE);
  });

  it('maps a wall/floor impact on either Bey to a "wallImpact" event at that Bey\'s position', () => {
    const result = emptyResult();
    result.first.movement.impactDeltaSpeedMps = 5;
    result.second.movement.impactDeltaSpeedMps = 3;

    const events = buildImpactEventsForTick(result, FIRST_POS, SECOND_POS);
    expect(events).toHaveLength(2);
    const firstEvent = events.find((e) => e.isFirst)!;
    const secondEvent = events.find((e) => !e.isFirst)!;
    expect(firstEvent).toMatchObject({ kind: 'wallImpact', worldPositionM: FIRST_POS });
    expect(secondEvent).toMatchObject({ kind: 'wallImpact', worldPositionM: SECOND_POS });
  });

  it('maps justLanded on either Bey to a "landing" event using that Bey\'s landingIntensity', () => {
    const result = emptyResult();
    result.first.justLanded = true;
    result.first.landingIntensity = 0.8;

    const events = buildImpactEventsForTick(result, FIRST_POS, SECOND_POS);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'landing', isFirst: true, worldPositionM: FIRST_POS });
    expect(events[0]!.magnitude).toBeGreaterThan(0);
  });
});
