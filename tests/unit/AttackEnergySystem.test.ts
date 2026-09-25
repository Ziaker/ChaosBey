import { describe, expect, it } from 'vitest';
import { AttackEnergySystem } from '../../src/bey/attack-energy/AttackEnergySystem';
import {
  ATTACK_ENERGY_CONSUMPTION_PER_S,
  ATTACK_ENERGY_MAX,
  ATTACK_ENERGY_RECOVERY_DELAY_S,
  ATTACK_ENERGY_RECOVERY_PER_S,
} from '../../src/bey/attack-energy/AttackEnergyTuning';

const DT = 1 / 60;

describe('AttackEnergySystem', () => {
  it('drains while consuming (charging a Dash Attack)', () => {
    const system = new AttackEnergySystem();

    system.tick(true, DT);

    expect(system.resource.fraction).toBeLessThan(1);
    expect(system.resource.value).toBeCloseTo(ATTACK_ENERGY_MAX - ATTACK_ENERGY_CONSUMPTION_PER_S * DT, 5);
  });

  it('never regenerates while still consuming, even across many ticks', () => {
    const system = new AttackEnergySystem();

    let previous = system.resource.value;
    for (let i = 0; i < 30; i++) {
      system.tick(true, DT);
      expect(system.resource.value).toBeLessThanOrEqual(previous);
      previous = system.resource.value;
    }
  });

  it('does not regenerate immediately after consumption stops (recovery delay)', () => {
    const system = new AttackEnergySystem();
    system.tick(true, DT); // consume a bit first
    const afterConsuming = system.resource.value;

    // Advance less than the recovery delay, no longer consuming.
    const delayTicks = Math.floor(ATTACK_ENERGY_RECOVERY_DELAY_S / DT) - 2;
    for (let i = 0; i < delayTicks; i++) {
      system.tick(false, DT);
    }

    expect(system.resource.value).toBe(afterConsuming);
  });

  it('regenerates once the recovery delay has elapsed, bounded to max', () => {
    const system = new AttackEnergySystem();
    system.tick(true, 1); // drain by a full second's worth first
    const afterConsuming = system.resource.value;
    expect(afterConsuming).toBeCloseTo(ATTACK_ENERGY_MAX - ATTACK_ENERGY_CONSUMPTION_PER_S, 5);

    system.tick(false, ATTACK_ENERGY_RECOVERY_DELAY_S); // clears the delay in one step
    expect(system.resource.value).toBeGreaterThan(afterConsuming);
    expect(system.resource.value).toBeLessThanOrEqual(ATTACK_ENERGY_MAX);

    // Keep recovering well past a full refill — must stay clamped, never overshoot.
    for (let i = 0; i < 20; i++) {
      system.tick(false, 1);
      expect(system.resource.value).toBeLessThanOrEqual(ATTACK_ENERGY_MAX);
    }
    expect(system.resource.isFull).toBe(true);
  });

  it('recovers at the approved rate once the delay has passed', () => {
    const system = new AttackEnergySystem();
    system.tick(true, 1); // drain by a full second's worth; resets the "since last consumption" clock
    system.tick(false, ATTACK_ENERGY_RECOVERY_DELAY_S); // reach the delay threshold, with plenty of headroom below max
    const afterCrossingDelay = system.resource.value;
    expect(afterCrossingDelay).toBeLessThan(ATTACK_ENERGY_MAX);

    system.tick(false, DT);

    expect(system.resource.value - afterCrossingDelay).toBeCloseTo(ATTACK_ENERGY_RECOVERY_PER_S * DT, 5);
  });
});
