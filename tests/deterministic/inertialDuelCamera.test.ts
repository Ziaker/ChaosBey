// ============================================================
// INERTIAL DUEL CAMERA — spatial-stability regressions
//
// These tests complement the existing visibility tests. Keeping a target in
// frame is not sufficient if the camera destroys spatial orientation while
// doing it; therefore measure yaw travel, yaw reversals and correction bounds
// through the exact pass-through cases that historically forced rescue hacks.
// ============================================================

import { describe, expect, it } from 'vitest';
import { arenaParamsFor, rigDirectorOptions, CAMERA_CONTAIN_RADIUS_M, CAMERA_RINGOUT_WATCH_RADIUS_M } from '../../src/camera/director/CameraRig';
import { InertialDuelDirector, INERTIAL_DUEL_TUNING } from '../../src/camera/director/InertialDuelDirector';
import type { FightFrame, FighterFrame } from '../../src/camera/director/FightFrame';
import { inFrame } from '../../src/camera/director/frameMath';
import type { PresetId } from '../../src/camera/director/CameraParams';

const DT = 1 / 60;
const ASPECT = 16 / 9;

function fighter(x: number, z: number, vx = 0, vz = 0, airborne = false): FighterFrame {
  return {
    position: { x, y: 0.2, z },
    velocity: { x: vx, y: 0, z: vz },
    speed: Math.hypot(vx, vz),
    airborne,
    attack: 'none',
    broken: false,
  };
}

function frame(tick: number, first: FighterFrame, second: FighterFrame): FightFrame {
  return {
    tick,
    time: tick * DT,
    first,
    second,
    intents: [],
    clashActive: false,
    clashProgress: 0,
    roundOver: false,
    ringOutIsFirst: null,
  };
}

function director(preset: PresetId): InertialDuelDirector {
  return new InertialDuelDirector(
    preset,
    arenaParamsFor(preset),
    ASPECT,
    rigDirectorOptions(preset),
    CAMERA_RINGOUT_WATCH_RADIUS_M,
  );
}

describe('Inertial Duel Camera — pass-through stability', () => {
  it('lets the player pass through the opponent without chasing the ~180° fight-axis inversion', () => {
    for (const preset of ['A', 'B', 'C'] as const) {
      const d = director(preset);
      let visibleTicks = 0;
      let maxYawRate = 0;
      let finalTravel = 0;
      let reversals = 0;
      const ticks = 120;
      for (let t = 0; t < ticks; t++) {
        const u = t / (ticks - 1);
        const z = -9 + 18 * u;
        const p = fighter(0.5, z, 0, 18 / ((ticks - 1) * DT));
        const o = fighter(0, 0);
        const out = d.tick(frame(t, p, o), DT);
        if (inFrame(p.position, out.eye, out.focus, out.fov, ASPECT, 0.02) && inFrame(o.position, out.eye, out.focus, out.fov, ASPECT, 0.02)) visibleTicks++;
        maxYawRate = Math.max(maxYawRate, Math.abs(out.debug.composition.yawVelocityDegS));
        finalTravel = out.debug.composition.totalYawTravelDeg;
        reversals = out.debug.composition.yawReversals;
      }
      expect((100 * visibleTicks) / ticks, `${preset}: both Beys visible`).toBeGreaterThanOrEqual(95);
      expect(maxYawRate, `${preset}: bounded composition yaw rate`).toBeLessThanOrEqual(INERTIAL_DUEL_TUNING[preset].maxYawRateDegS + 1e-6);
      expect(finalTravel, `${preset}: crossing must not cause a camera half-turn`).toBeLessThan(60);
      expect(reversals, `${preset}: no oscillatory side chasing`).toBeLessThanOrEqual(1);
    }
  });

  it('survives a double crossing without ping-ponging the world', () => {
    for (const preset of ['A', 'B', 'C'] as const) {
      const d = director(preset);
      let finalTravel = 0;
      let reversals = 0;
      let maxAccel = 0;
      const ticks = 240;
      for (let t = 0; t < ticks; t++) {
        const phase = t / (ticks - 1);
        const z = phase < 0.5 ? -9 + 36 * phase : 9 - 36 * (phase - 0.5);
        const vz = phase < 0.5 ? 18 / (0.5 * (ticks - 1) * DT) : -18 / (0.5 * (ticks - 1) * DT);
        const out = d.tick(frame(t, fighter(0.5, z, 0, vz), fighter(0, 0)), DT);
        finalTravel = out.debug.composition.totalYawTravelDeg;
        reversals = out.debug.composition.yawReversals;
        maxAccel = Math.max(maxAccel, Math.abs(out.debug.composition.yawAccelerationDegS2));
      }
      expect(finalTravel, `${preset}: two crossings still do not justify a full orbit`).toBeLessThan(120);
      expect(reversals, `${preset}: bounded correction reversals`).toBeLessThanOrEqual(2);
      expect(maxAccel, `${preset}: angular acceleration cap`).toBeLessThanOrEqual(INERTIAL_DUEL_TUNING[preset].maxYawAccelDegS2 + 1e-5);
    }
  });

  it('holds optical rescue briefly after the soft-frame pressure clears instead of pumping on/off', () => {
    const d = director('B');

    // Establish a calm world azimuth first.
    for (let t = 0; t < 30; t++) d.tick(frame(t, fighter(0, -3), fighter(0, 3)), DT);

    // Force a very wide lateral composition on the 36 m stage. This remains
    // physically valid but should build focus/distance/FOV rescue pressure.
    let out = d.tick(frame(30, fighter(-30, 0), fighter(30, 0)), DT);
    let peak = out.debug.composition.rescuePressure;
    for (let t = 31; t < 90; t++) {
      out = d.tick(frame(t, fighter(-30, 0), fighter(30, 0)), DT);
      peak = Math.max(peak, out.debug.composition.rescuePressure);
    }
    expect(peak, 'wide composition should engage optical rescue').toBeGreaterThan(0.05);

    // Return to a safe composition. Release is intentionally slower than
    // attack, so pressure must not snap directly to zero on the next frame.
    const firstSafe = d.tick(frame(90, fighter(0, -3), fighter(0, 3)), DT);
    expect(firstSafe.debug.composition.rescuePressure, 'rescue should have release memory').toBeGreaterThan(0);

    let settling = firstSafe;
    for (let t = 91; t < 121; t++) settling = d.tick(frame(t, fighter(0, -3), fighter(0, 3)), DT);
    expect(settling.debug.composition.rescuePressure, 'rescue should decay after returning inside the safe frame').toBeLessThan(peak);

    for (let t = 121; t < 361; t++) settling = d.tick(frame(t, fighter(0, -3), fighter(0, 3)), DT);
    expect(settling.debug.composition.rescuePressure, 'rescue should eventually settle back to neutral').toBeLessThan(0.01);
  });
});

describe('Inertial Duel Camera — 36 m arena integration', () => {
  it('keeps the final composition eye inside the arena-scale containment radius', () => {
    for (const preset of ['A', 'B', 'C'] as const) {
      const d = director(preset);
      let out = d.tick(frame(0, fighter(0, -30), fighter(0, -25)), DT);
      for (let t = 1; t < 240; t++) out = d.tick(frame(t, fighter(0, -30), fighter(0, -25)), DT);
      expect(Math.hypot(out.eye.x, out.eye.z), preset).toBeLessThanOrEqual(CAMERA_CONTAIN_RADIUS_M + 1e-6);
    }
  });

  it('does not anticipate a ring-out at mid-stage, but does near the real 36 m edge', () => {
    const d = director('B');
    const outward = (r: number) => fighter(0, -r, 0, -8, true);
    let mid = d.tick(frame(0, outward(20), fighter(0, 0)), DT);
    for (let t = 1; t < 30; t++) mid = d.tick(frame(t, outward(20), fighter(0, 0)), DT);
    expect(mid.weights.RingOut).toBeLessThan(0.05);

    d.reset();
    let rim = d.tick(frame(0, outward(34), fighter(0, 0)), DT);
    for (let t = 1; t < 30; t++) rim = d.tick(frame(t, outward(34), fighter(0, 0)), DT);
    expect(rim.weights.RingOut).toBeGreaterThan(0.2);
  });
});
