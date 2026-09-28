// ============================================================
// SIMULATION HITSTOP SELF-TESTS (M9-0A)
// Pure-logic tests (no physics/camera needed) for the gameplay-freeze rule
// itself, now owned by the simulation instead of CombatCameraController —
// see SimulationHitstop.ts's header for why. collectHitstopImpactMagnitudes
// is exercised against hand-built MatchTickResult-shaped fixtures, the same
// style as impactEvents.test.ts, since it wraps buildImpactEventsForTick.
// ============================================================

import { describe, expect, it } from 'vitest';
import { ClashState } from '../../src/combat/clash/ClashController';
import { CLASH_RESOLVED_MAGNITUDE, KO_MAGNITUDE } from '../../src/camera/ImpactMagnitude';
import {
  collectHitstopImpactMagnitudes,
  HITSTOP_MAX_DURATION_S,
  HITSTOP_MIN_MAGNITUDE,
  SimulationHitstop,
} from '../../src/app/simulation/SimulationHitstop';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';

function emptyResult(): { hitEvents: []; combatEvents: []; first: { movement: { impactDeltaSpeedMps: number }; justLanded: boolean; landingIntensity: number }; second: { movement: { impactDeltaSpeedMps: number }; justLanded: boolean; landingIntensity: number }; clashResolvedThisTick: null } {
  return {
    hitEvents: [],
    combatEvents: [],
    first: { movement: { impactDeltaSpeedMps: 0 }, justLanded: false, landingIntensity: 0 },
    second: { movement: { impactDeltaSpeedMps: 0 }, justLanded: false, landingIntensity: 0 },
    clashResolvedThisTick: null,
  };
}

describe('SimulationHitstop', () => {
  it('a strong impact magnitude (e.g. a KO, 1.0) triggers a freeze that decays back to inactive', () => {
    const hitstop = new SimulationHitstop();
    hitstop.registerImpactMagnitudes([KO_MAGNITUDE]);

    expect(hitstop.isActive).toBe(true);
    expect(hitstop.remainingSeconds).toBeGreaterThan(0);

    const settleTicks = Math.ceil((HITSTOP_MAX_DURATION_S + 1) / FIXED_DELTA_SECONDS);
    for (let i = 0; i < settleTicks; i++) hitstop.decay(FIXED_DELTA_SECONDS);

    expect(hitstop.isActive).toBe(false);
    expect(hitstop.remainingSeconds).toBe(0);
  });

  it('a magnitude right below the threshold never triggers a freeze', () => {
    const hitstop = new SimulationHitstop();
    hitstop.registerImpactMagnitudes([HITSTOP_MIN_MAGNITUDE - 0.01]);
    expect(hitstop.isActive).toBe(false);
  });

  it('a magnitude at exactly the threshold triggers a freeze', () => {
    const hitstop = new SimulationHitstop();
    hitstop.registerImpactMagnitudes([HITSTOP_MIN_MAGNITUDE]);
    expect(hitstop.isActive).toBe(true);
  });

  it('decay runs regardless of whether new impacts are registered, so a freeze always ends on its own', () => {
    const hitstop = new SimulationHitstop();
    hitstop.registerImpactMagnitudes([1]);
    const remaining = hitstop.remainingSeconds;
    hitstop.decay(FIXED_DELTA_SECONDS);
    expect(hitstop.remainingSeconds).toBeCloseTo(remaining - FIXED_DELTA_SECONDS, 6);
  });

  it('a later, stronger impact extends the freeze; a later, weaker one never shortens it', () => {
    const hitstop = new SimulationHitstop();
    hitstop.registerImpactMagnitudes([0.5]);
    const afterFirst = hitstop.remainingSeconds;
    hitstop.registerImpactMagnitudes([0.36]);
    expect(hitstop.remainingSeconds).toBe(afterFirst);
    hitstop.registerImpactMagnitudes([1]);
    expect(hitstop.remainingSeconds).toBeGreaterThan(afterFirst);
  });
});

describe('collectHitstopImpactMagnitudes', () => {
  it('returns [] when nothing happened this tick', () => {
    expect(collectHitstopImpactMagnitudes(emptyResult(), ClashState.Idle)).toEqual([]);
  });

  it('maps ordinary combat events (e.g. a ko) to the same magnitude buildImpactEventsForTick would', () => {
    const result = emptyResult();
    (result.combatEvents as unknown[]) = [{ kind: 'ko', targetIsFirst: true }];
    expect(collectHitstopImpactMagnitudes(result, ClashState.Idle)).toEqual([KO_MAGNITUDE]);
  });

  it('on the tick a Clash resolves, returns ONLY the resolution magnitude — never also the resolution\'s own knockback/stabilityBreak/ko combat events', () => {
    const result = emptyResult();
    (result.combatEvents as unknown[]) = [{ kind: 'stabilityBreak', targetIsFirst: true }, { kind: 'ko', targetIsFirst: true }];
    (result as { clashResolvedThisTick: unknown }).clashResolvedThisTick = { outcome: 'FirstWins' };
    expect(collectHitstopImpactMagnitudes(result, ClashState.Idle)).toEqual([CLASH_RESOLVED_MAGNITUDE]);
  });

  it('while a Clash is Active (still mashing, not yet resolved), returns [] — tickMatch already freezes everything itself', () => {
    const result = emptyResult();
    (result.combatEvents as unknown[]) = [{ kind: 'ko', targetIsFirst: true }];
    expect(collectHitstopImpactMagnitudes(result, ClashState.Active)).toEqual([]);
  });
});
