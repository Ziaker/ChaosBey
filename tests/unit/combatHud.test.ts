// M10 lane E: the combat HUD's model — the approved Clash bar rule and the
// per-side readout (clash-presentation-approval.md 3.5).

import { describe, expect, it } from 'vitest';
import { AttackState } from '../../src/combat/attacks/AttackController';
import {
  CLASH_BAR_MAX_SHARE,
  CLASH_BAR_MIN_SHARE,
  clashBarShare,
  followClashBar,
  hudSide,
  stepUpCue,
  UP_CUE_AFTER_STEER_S,
  UP_CUE_S,
  roundEndBanner,
} from '../../src/app/frontend/hudModel';

describe('Clash tug-of-war bar', () => {
  it('is 0.5 + 0.5 × advantage × 4, limited to 4%–96%', () => {
    expect(clashBarShare(0, 0)).toBe(0.5);
    expect(clashBarShare(1, 1)).toBe(0.5);
    // advantage (0.55 − 0.45) / 1 = 0.1 → 0.5 + 0.2
    expect(clashBarShare(0.55, 0.45)).toBeCloseTo(0.7, 12);
    expect(clashBarShare(0.45, 0.55)).toBeCloseTo(0.3, 12);
    expect(clashBarShare(1, 0)).toBe(CLASH_BAR_MAX_SHARE);
    expect(clashBarShare(0, 1)).toBe(CLASH_BAR_MIN_SHARE);
  });

  it('follows the live power at 8/s, independent of frame rate', () => {
    expect(followClashBar(0.5, 0.9, 0)).toBe(0.5);
    const oneFrame = followClashBar(0.5, 0.9, 1 / 30);
    let twoFrames = followClashBar(0.5, 0.9, 1 / 60);
    twoFrames = followClashBar(twoFrames, 0.9, 1 / 60);
    expect(twoFrames).toBeCloseTo(oneFrame, 12);
    // After one second it has covered 1 − e^−8 ≈ 99.97% of the way.
    expect(followClashBar(0.5, 0.9, 1)).toBeCloseTo(0.9, 3);
  });
});

describe('HUD side readout', () => {
  const base = { staminaFraction: 0.8, stabilityFraction: 0.6, isBroken: false, dashReadiness: 0.5, momentum: 0.25, dashChargeFraction: 0.4, attackState: AttackState.Neutral };

  it('clamps the meters and shows the Dash charge only while charging', () => {
    expect(hudSide(base)).toEqual({ stamina: 0.8, stability: 0.6, broken: false, dashReadiness: 0.5, momentum: 0.25, dashCharge: 0, tag: null });
    expect(hudSide({ ...base, attackState: AttackState.ChargingDash })).toMatchObject({ dashCharge: 0.4, tag: 'CHARGING' });
    expect(hudSide({ ...base, staminaFraction: 1.4, stabilityFraction: -1, dashReadiness: Number.NaN })).toMatchObject({ stamina: 1, stability: 0, dashReadiness: 0 });
  });

  it('tags a broken Bey above anything else, then the active attack', () => {
    expect(hudSide({ ...base, isBroken: true, attackState: AttackState.DashActive }).tag).toBe('BROKEN');
    expect(hudSide({ ...base, attackState: AttackState.DashActive }).tag).toBe('DASH');
    expect(hudSide({ ...base, attackState: AttackState.CircularActive }).tag).toBe('SPIN');
  });

  it('names how a round ended, never a Clash', () => {
    expect(roundEndBanner('FirstWinsByRingOut')).toBe('RING OUT!');
    expect(roundEndBanner('SecondWinsByKo')).toBe('K.O.!');
    expect(roundEndBanner('Draw')).toBe('DRAW');
    expect(roundEndBanner('Ongoing')).toBeNull();
  });
});

describe('the round-start arrow cue (owner polish, 2026-10-07, idea 6)', () => {
  it('stays UP_CUE_S, fading over its last second, then goes', () => {
    let left = UP_CUE_S;
    let cue = stepUpCue(left, false, true, 0);
    expect(cue).toMatchObject({ visible: true, opacity: 1 });
    cue = stepUpCue(UP_CUE_S, false, true, UP_CUE_S - 0.5);
    expect(cue.visible).toBe(true);
    expect(cue.opacity).toBeCloseTo(0.5, 5);
    left = cue.leftS;
    cue = stepUpCue(left, false, true, 0.6);
    expect(cue.visible).toBe(false);
    expect(stepUpCue(0, false, true, 0.016).visible).toBe(false); // gone for good
  });

  it('the first steer lets it go in a short fade, not an abrupt cut', () => {
    const cue = stepUpCue(UP_CUE_S, true, true, 0.016);
    expect(cue.visible).toBe(true);
    expect(cue.leftS).toBeLessThanOrEqual(UP_CUE_AFTER_STEER_S);
    expect(stepUpCue(cue.leftS, true, true, 0.5).visible).toBe(false);
  });

  it('is off with the control hints', () => {
    expect(stepUpCue(UP_CUE_S, false, false, 0.016).visible).toBe(false);
  });
});
