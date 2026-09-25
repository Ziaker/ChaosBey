// ============================================================
// PHYSICS WORLD — RAPIER INITIALIZATION
// Thin wrapper around Rapier so the rest of the codebase never touches
// the WASM module or gravity vector directly (GDD section 1.4, 18).
// ============================================================

import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DELTA_SECONDS } from '../fixed-step/FixedTimestepLoop';

// Downward acceleration applied to all dynamic bodies, in m/s^2.
// Standard Earth gravity is used as the engineering starting point; final
// gameplay feel (fall speed, jump arcs) is tuning data owned by jump/physics
// systems once they exist, not by this bootstrap wrapper.
const GRAVITY_Y = -9.81;

export class PhysicsWorld {
  private constructor(readonly rapierWorld: RAPIER.World) {}

  /** Rapier ships as WebAssembly and must be initialized asynchronously before any RAPIER.* class can be constructed. */
  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
    // Rapier defaults its internal timestep to 1/60s on its own, which
    // happens to match FIXED_DELTA_SECONDS today — but that would silently
    // drift out of sync if the fixed-step loop's tick rate ever changes.
    // Bind it explicitly to the same source of truth instead of relying on
    // the coincidence (GDD section 80: simulation must not have two
    // competing definitions of its own timestep).
    world.timestep = FIXED_DELTA_SECONDS;
    return new PhysicsWorld(world);
  }

  /** Advances the physics simulation by exactly one fixed tick. Must be called from FixedTimestepLoop's onFixedTick, never from a render callback (GDD section 80). */
  step(): void {
    this.rapierWorld.step();
  }
}
