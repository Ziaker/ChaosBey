import { describe, expect, it } from 'vitest';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';

describe('PhysicsWorld.create', () => {
  it('binds the Rapier world timestep to FIXED_DELTA_SECONDS explicitly, not Rapier\'s own default', () => {
    // Regression test: this must not merely happen to match Rapier's
    // built-in default. If FIXED_DELTA_SECONDS ever changes, this test
    // catches PhysicsWorld silently drifting out of sync with the fixed
    // timestep loop that drives it.
    return PhysicsWorld.create().then((physics) => {
      // Rapier stores the timestep as an f32 internally, so it round-trips
      // with a small precision loss versus our f64 constant — that's
      // expected, not a bug. What this test guards against is the value
      // silently reverting to a *different* default if PhysicsWorld ever
      // stops setting `world.timestep` explicitly.
      expect(physics.rapierWorld.timestep).toBeCloseTo(FIXED_DELTA_SECONDS, 6);
    });
  });
});
