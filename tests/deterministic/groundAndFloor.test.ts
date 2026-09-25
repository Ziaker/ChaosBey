import { describe, expect, it } from 'vitest';
import { BEY_COLLIDER_HALF_HEIGHT_M, BEY_COLLIDER_RADIUS_M } from '../../src/bey/core/BeyTuning';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { TestBeyHarness } from './physicsHarness';

describe('resting on the floor', () => {
  it('settles at a height matching the visual floor surface (y=0)', async () => {
    const harness = await TestBeyHarness.create();
    const noInput = new ScriptedController([{ fromTick: 0, held: [] }]);

    let finalY = 0;
    for (let i = 0; i < 120; i++) {
      harness.tick(noInput.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      finalY = harness.beyBody.translation().y;
    }

    // Regression: the physics floor collider used to sit ARENA_FLOOR_THICKNESS/2
    // above the visual floor mesh's top surface, so the Bey would rest ~0.25m
    // above where the floor actually appears on screen.
    expect(finalY).toBeGreaterThan(BEY_COLLIDER_HALF_HEIGHT_M - 0.05);
    expect(finalY).toBeLessThan(BEY_COLLIDER_HALF_HEIGHT_M + 0.05);
  });
});

describe('grounded detection while tilted', () => {
  it('stays grounded while tilted at a known angle, not only while perfectly upright', async () => {
    const harness = await TestBeyHarness.create();
    const noInput = new ScriptedController([{ fromTick: 0, held: [] }]);
    for (let i = 0; i < 30; i++) {
      harness.tick(noInput.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
    }

    // Directly place the Bey resting at a known 20° tilt, rather than
    // relying on impact dynamics to produce and sustain one — this
    // isolates the grounded query itself from recovery-torque timing.
    // supportOffset is the standard cylinder support-function distance
    // from center to its lowest point when tilted by `tiltRad` around a
    // horizontal axis: R*sin(tilt) + halfHeight*cos(tilt).
    const tiltRad = (20 * Math.PI) / 180;
    const halfAngle = tiltRad / 2;
    const supportOffset = BEY_COLLIDER_RADIUS_M * Math.sin(tiltRad) + BEY_COLLIDER_HALF_HEIGHT_M * Math.cos(tiltRad);
    harness.beyBody.setTranslation({ x: 0, y: supportOffset + 0.02, z: 0 }, true);
    harness.beyBody.setRotation({ x: Math.sin(halfAngle), y: 0, z: 0, w: Math.cos(halfAngle) }, true);
    harness.beyBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    harness.beyBody.setAngvel({ x: 0, y: 0, z: 0 }, true);

    let sawGroundedWhileTilted = false;
    const tiltThresholdRad = (15 * Math.PI) / 180;
    for (let i = 0; i < 10; i++) {
      const result = harness.tick(noInput.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      if (result.spin.tiltRad > tiltThresholdRad && result.grounded) {
        sawGroundedWhileTilted = true;
      }
    }

    // Regression: a fixed-distance raycast (colliderHalfHeight + small
    // tolerance ≈ 0.23m) is wrong the moment the Bey tilts — at just 20°
    // tilt the collider's true lowest point is already ~0.39m from
    // center, well past that fixed distance, so the old check would
    // falsely report airborne here even though the Bey never left the
    // floor.
    expect(sawGroundedWhileTilted).toBe(true);
  });
});

describe('floor landing and bounce', () => {
  it('lands, bounces without gaining energy, and settles without penetrating the floor', async () => {
    const harness = await TestBeyHarness.create({ x: 0, y: 3, z: 0 });
    const noInput = new ScriptedController([{ fromTick: 0, held: [] }]);

    let touchedGround = false;
    let minVyEver = 0; // most negative — the peak downward (falling/impact) speed.
    let maxVyEver = 0; // most positive — the peak bounce-back speed.
    const lateRestingYSamples: number[] = [];

    for (let i = 0; i < 300; i++) {
      const result = harness.tick(noInput.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS }));
      const t = harness.beyBody.translation();
      const v = harness.beyBody.linvel();

      expect(Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)).toBe(true);
      expect(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)).toBe(true);
      // A discrete solver can allow brief compression on a hard, high-speed
      // impact (falling ~2.8m covers more than the collider's own height
      // in a single tick at touchdown) — that's normal and gets corrected
      // over the next few ticks. This generous bound only catches falling
      // through the world entirely; the strict "no PERSISTENT penetration"
      // check is the settled-sample loop below.
      expect(t.y).toBeGreaterThan(BEY_COLLIDER_HALF_HEIGHT_M - 0.3);

      minVyEver = Math.min(minVyEver, v.y);
      maxVyEver = Math.max(maxVyEver, v.y);

      if (!touchedGround && result.grounded) {
        touchedGround = true;
      }
      if (touchedGround && i > 250) {
        lateRestingYSamples.push(t.y);
      }
    }

    // The narrow-phase contact `result.grounded` reflects is one tick
    // behind physics.step() (contacts are computed *during* the step that
    // resolves the bounce), so reading velocity right at the "just
    // grounded" transition would already be post-bounce. Tracking the
    // global min/max vertical velocity instead sidesteps that lag: in a
    // single-drop scenario the deepest fall is the impact, and — because
    // restitution < 1 guarantees each bounce is weaker than the last — the
    // highest bounce-back is necessarily the first (biggest) one.
    const impactSpeedMps = Math.abs(minVyEver);
    expect(impactSpeedMps).toBeGreaterThan(2); // a real fall happened, not an edge case with ~0 impact speed.
    // Restitution < 1: the bounce-back speed must never exceed, let alone
    // gain over, the impact speed (no energy gain from the collision).
    expect(maxVyEver).toBeLessThan(impactSpeedMps);

    expect(lateRestingYSamples.length).toBeGreaterThan(0);
    for (const y of lateRestingYSamples) {
      expect(y).toBeGreaterThan(BEY_COLLIDER_HALF_HEIGHT_M - 0.05);
      expect(y).toBeLessThan(BEY_COLLIDER_HALF_HEIGHT_M + 0.1);
    }
  });
});
