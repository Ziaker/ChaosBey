// Owner, 2026-10-02 (Lote 3): momentum builds with sustained fast, straight
// movement (4 s to fill), drains otherwise (2 s), raises the top speed by
// momentum × gain (+100%), and a collision costs part of it.

import { describe, expect, it } from 'vitest';
import { MomentumSystem } from '../../src/bey/momentum/MomentumSystem';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';

const DT = 1 / 60;
const RULES = { momentumGain: 1, momentumFillS: 4, momentumDecayS: 2, momentumLossOnCollision: 0.5 };

function run(m: MomentumSystem, seconds: number, speed: number, top: number, heading: (i: number) => number | null, grounded = true): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) m.tick(speed, top, heading(i), grounded, DT);
}

describe('MomentumSystem (owner, 2026-10-02)', () => {
  it('MatchConfig defaults: +100% gain, 4 s fill, 2 s decay, collision damage ×1, 50% loss', () => {
    expect(createDefaultMatchConfig()).toMatchObject({ momentumGain: 1, momentumFillS: 4, momentumDecayS: 2, bodyCollisionDamage: 1, momentumLossOnCollision: 0.5 });
  });

  it('fills in 4 s of fast straight movement, doubling the top speed, then drains in 2 s when stopped', () => {
    const m = new MomentumSystem(RULES);
    run(m, 2, 10, 11, () => 0);
    expect(m.value).toBeCloseTo(0.5, 2);
    run(m, 2, 10, 11, () => 0);
    expect(m.value).toBe(1);
    expect(m.topSpeedMultiplier).toBe(2);
    run(m, 1, 0, 22, () => null);
    expect(m.value).toBeCloseTo(0.5, 2);
    run(m, 1, 0, 22, () => null);
    expect(m.value).toBe(0);
  });

  it('does not build below half the current top speed, nor in a sharp turn; holds in the air', () => {
    const slow = new MomentumSystem(RULES);
    run(slow, 2, 5, 11, () => 0);
    expect(slow.value).toBe(0);
    const turning = new MomentumSystem(RULES);
    run(turning, 2, 10, 11, (i) => i * 0.1); // 6 rad/s
    expect(turning.value).toBe(0);
    const air = new MomentumSystem(RULES);
    run(air, 2, 10, 11, () => 0);
    const before = air.value;
    run(air, 1, 0, 11, () => null, false);
    expect(air.value).toBe(before);
  });

  it('a collision costs the configured share; gain 0 disables the speed boost', () => {
    const m = new MomentumSystem(RULES);
    run(m, 4, 10, 11, () => 0);
    m.loseOnCollision();
    expect(m.value).toBeCloseTo(0.5, 9);
    const noGain = new MomentumSystem({ ...RULES, momentumGain: 0 });
    run(noGain, 4, 10, 11, () => 0);
    expect(noGain.topSpeedMultiplier).toBe(1);
  });
});
