import { describe, expect, it } from 'vitest';
import { HitstopClock } from '../../src/app/simulation/Hitstop';
import { HITSTOP_DURATION_PER_MAGNITUDE_S, HITSTOP_MAX_DURATION_S, HITSTOP_MIN_MAGNITUDE } from '../../src/app/simulation/HitstopTuning';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';

// Hitstop is simulation state since M9 (owner decision): it decides whether
// tickMatch() runs. These are the hitstop cases the camera tests covered
// before the timer moved out of CombatCameraController, plus the Clash
// rule and a tick-by-tick comparison with the pre-M9 camera arithmetic.

/** The exact hitstop arithmetic CombatCameraController applied before M9. */
function preM9CameraHitstop(remainingS: number, magnitudes: readonly number[], dt: number): number {
  let r = remainingS;
  for (const magnitude of magnitudes) {
    if (magnitude >= HITSTOP_MIN_MAGNITUDE) {
      const duration = Math.min(HITSTOP_MAX_DURATION_S, magnitude * HITSTOP_DURATION_PER_MAGNITUDE_S);
      r = Math.max(r, duration);
    }
  }
  return Math.max(0, r - dt);
}

describe('HitstopClock', () => {
  it('a strong impact (magnitude 1, e.g. a KO) freezes gameplay, then the freeze ends by itself', () => {
    const clock = new HitstopClock();
    clock.advance([1], false, FIXED_DELTA_SECONDS);
    expect(clock.isFreezing()).toBe(true);
    expect(clock.getRemainingS()).toBeGreaterThan(0);

    let frozenTicks = 0;
    for (let i = 0; i < 120 && clock.isFreezing(); i++) {
      frozenTicks++;
      clock.advance([], false, FIXED_DELTA_SECONDS);
    }
    expect(clock.isFreezing()).toBe(false);
    expect(clock.getRemainingS()).toBe(0);
    // Capped at HITSTOP_MAX_DURATION_S: never a long lock-up.
    expect(frozenTicks).toBeLessThanOrEqual(Math.ceil(HITSTOP_MAX_DURATION_S / FIXED_DELTA_SECONDS));
  });

  it('a sub-hitstop magnitude (e.g. a clean dodge, 0.2) never freezes gameplay', () => {
    const clock = new HitstopClock();
    clock.advance([0.2], false, FIXED_DELTA_SECONDS);
    expect(clock.isFreezing()).toBe(false);
  });

  it('a tiny magnitude (0.03) never freezes gameplay', () => {
    const clock = new HitstopClock();
    clock.advance([0.03], false, FIXED_DELTA_SECONDS);
    expect(clock.isFreezing()).toBe(false);
  });

  it('does not report a freeze while a Clash is Active (the Clash already freezes the match), but keeps counting down', () => {
    const clock = new HitstopClock();
    clock.advance([1], true, FIXED_DELTA_SECONDS);
    expect(clock.isFreezing()).toBe(false);
    expect(clock.getRemainingS()).toBeGreaterThan(0);
    clock.advance([], false, FIXED_DELTA_SECONDS);
    expect(clock.isFreezing()).toBe(clock.getRemainingS() > 0);
  });

  it('matches the pre-M9 camera arithmetic bit for bit over a long random impact sequence (live freeze timing unchanged)', () => {
    const rng = SeededRng.fromSeedText('hitstop-parity');
    const clock = new HitstopClock();
    let reference = 0;
    for (let tick = 0; tick < 5000; tick++) {
      const magnitudes = rng.nextBool(0.1) ? [rng.nextFloat(), rng.nextFloat() * 0.5] : [];
      clock.advance(magnitudes, false, FIXED_DELTA_SECONDS);
      reference = preM9CameraHitstop(reference, magnitudes, FIXED_DELTA_SECONDS);
      expect(clock.getRemainingS()).toBe(reference);
      expect(clock.isFreezing()).toBe(reference > 0);
    }
  });
});
