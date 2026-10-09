import { describe, expect, it } from 'vitest';
import { ADVANCED_CONTROLS, isModified, writeAdvanced } from '../../src/app/frontend/advancedControls';
import { createDefaultMatchSetup, matchConfigFor, MATCH_RULE_KEYS } from '../../src/app/frontend/matchSetup';
import { StabilitySystem, stabilityScalesOf } from '../../src/bey/stability/StabilitySystem';
import { STABILITY_BROKEN_RECOVERY_FLOOR, STABILITY_MAX, STABILITY_RECOVERY_PER_S } from '../../src/bey/stability/StabilityTuning';
import { beyMatchRulesOf, createDefaultMatchConfig } from '../../src/config/match/MatchConfig';

// Owner, 2026-10-09: "sliders para a mecânica de estabilidade, especialmente um que aumenta a estabilidade base em até 200%".

const sys = (scales: Partial<ReturnType<typeof stabilityScalesOf>> = {}) => new StabilitySystem(undefined, { maxScale: 1, damageScale: 1, recoveryScale: 1, recoveryDelayScale: 1, ...scales });

describe('Stability scales', () => {
  it('1 everywhere is the game as it was', () => {
    const s = sys();
    expect(s.resource.max).toBe(STABILITY_MAX);
    expect(s.recoveryFloor).toBe(STABILITY_BROKEN_RECOVERY_FLOOR);
    expect(s.applyDamage(30).causedBreak).toBe(false);
    expect(s.resource.value).toBe(70);
  });

  it('+200% base Stability is three times the buffer, and the Broken floor grows with it', () => {
    const s = sys({ maxScale: 3 });
    expect(s.resource.max).toBe(300);
    expect(s.resource.value).toBe(300);
    expect(s.recoveryFloor).toBe(60);
    s.applyDamage(250);
    expect(s.isBroken).toBe(false); // 100 would have broken it twice over
    s.applyDamage(60);
    expect(s.isBroken).toBe(true);
    // Broken until it climbs back above the (scaled) floor.
    s.tick(6.1);
    expect(s.isBroken).toBe(true);
    for (let i = 0; i < 600 && s.isBroken; i++) s.tick(0.1);
    expect(s.isBroken).toBe(false);
    expect(s.resource.value).toBeGreaterThanOrEqual(60);
  });

  it('damage scale multiplies every loss; 0 means nothing ever breaks it', () => {
    const half = sys({ damageScale: 0.5 });
    half.applyDamage(40);
    expect(half.resource.value).toBe(80);
    const none = sys({ damageScale: 0 });
    none.applyDamage(1e6);
    expect(none.resource.value).toBe(STABILITY_MAX);
    expect(none.isBroken).toBe(false);
  });

  it('recovery speed and wait scale how it climbs back', () => {
    const baseline = sys();
    const fast = sys({ recoveryScale: 2, recoveryDelayScale: 0 });
    const never = sys({ recoveryScale: 0 });
    for (const s of [baseline, fast, never]) s.applyDamage(50);
    for (let i = 0; i < 10; i++) for (const s of [baseline, fast, never]) s.tick(0.1);
    expect(baseline.resource.value).toBe(50); // still inside the 3 s wait
    expect(fast.resource.value).toBeCloseTo(50 + STABILITY_RECOVERY_PER_S * 2 * 1, 5); // no wait, twice the speed
    expect(never.resource.value).toBe(50);
  });

  it('a Broken Bey waits longer or shorter with the wait scale', () => {
    const quick = sys({ recoveryDelayScale: 0.25 });
    quick.applyDamage(100);
    expect(quick.isBroken).toBe(true);
    for (let i = 0; i < 40; i++) quick.tick(0.1); // 4 s: past a quarter of the 6 s wait, the climb to the floor has begun
    expect(quick.resource.value).toBeGreaterThan(0);
  });

  it('the Pregame has the four sliders, they reach the match and its Bey rules, and a default setup is unmodified', () => {
    for (const key of ['stabilityMaxScale', 'stabilityDamageScale', 'stabilityRecoveryScale', 'stabilityRecoveryDelayScale'] as const) {
      expect(MATCH_RULE_KEYS).toContain(key);
      expect(ADVANCED_CONTROLS.some((c) => c.key === key)).toBe(true);
      expect(createDefaultMatchConfig()[key]).toBe(1);
    }
    const max = ADVANCED_CONTROLS.find((c) => c.key === 'stabilityMaxScale')!;
    expect(max.kind === 'slider' && max.range.max).toBe(3); // +200%
    expect(max.kind === 'slider' && max.format(3)).toContain('+200%');
    let setup = createDefaultMatchSetup();
    expect(isModified(setup, 'stabilityMaxScale')).toBe(false);
    setup = writeAdvanced(setup, 'stabilityMaxScale', 3);
    expect(isModified(setup, 'stabilityMaxScale')).toBe(true);
    expect(matchConfigFor(setup).stabilityMaxScale).toBe(3);
    expect(beyMatchRulesOf(matchConfigFor(setup)).stabilityMaxScale).toBe(3);
    expect(stabilityScalesOf(beyMatchRulesOf(matchConfigFor(setup))).maxScale).toBe(3);
    expect(stabilityScalesOf(undefined)).toEqual({ maxScale: 1, damageScale: 1, recoveryScale: 1, recoveryDelayScale: 1 });
  });

  it('stays available in Bey Real (it is not one of the controls the mode locks)', async () => {
    const { isLockedByRealMode } = await import('../../src/app/frontend/advancedControls');
    const { defaultRealSetup } = await import('../../src/app/frontend/matchSetup');
    const on = { ...createDefaultMatchSetup(), real: { ...defaultRealSetup(), enabled: true } };
    for (const key of ['stabilityMaxScale', 'stabilityDamageScale', 'stabilityRecoveryScale', 'stabilityRecoveryDelayScale']) {
      expect(isLockedByRealMode(ADVANCED_CONTROLS.find((c) => c.key === key)!, on), key).toBe(false);
    }
  });
});
