// ============================================================
// PHYSICS WORLD — RAPIER INITIALIZATION
// Thin wrapper around Rapier so the rest of the codebase never touches
// the WASM module or gravity vector directly (GDD section 1.4, 18).
// ============================================================

import RAPIER from '@dimforge/rapier3d-compat';
import { FIXED_DELTA_SECONDS } from '../fixed-step/FixedTimestepLoop';

// Downward acceleration applied to all dynamic bodies, in m/s^2.
// Started at standard Earth gravity as the engineering placeholder. Movement/
// weight/dodge playtest pass (owner feedback, section 5/6): "clearer ascent/
// descent, convincing fall, less floaty airtime". This, not BEY_MASS_KG, is
// the right lever for that ask: rotations are locked and every jump/hop
// impulse in the codebase sets velocity directly (DriftController), so
// free-fall and jump arcs are mass-independent in this engine — only
// gravity changes how fast something falls (BEY_MASS_KG was audited and
// left at its original 1.4: the only thing it would change is the Rapier
// impulse-based knockback/Clash launch, which it would WEAKEN unless also
// re-tuning their impulse formulas, for zero benefit to the ascent/descent/
// fall goals above — exactly the "don't just raise mass and declare it
// solved" trap the owner's feedback calls out).
//
// Raising gravity shortens EVERY airborne arc (free fall, hop, full jump,
// knockback, Clash launch) by the same ratio. A first attempt at -13
// (+32%, matching how aggressively LATERAL_GRIP_PER_S/STEERING_RESPONSE_PER_S
// were moved) measurably improved the fall/landing feel but broke ~10 AI
// reaction-timing assertions (aiAirRecoveryTiming/DuringCharge,
// aiSlowToReactCriticalPreemption, directionalMovement's stick-scaling,
// aiBatchSelfTest match-resolution time) that encode EXACT tick counts
// derived from gravity-dependent airborne-duration math — confirmed by
// reverting gravity alone and watching all of them pass again. Recalibrating
// every one of those tick counts was judged too large for a "moderate"
// pass (section 21), so this stays at a smaller, safe -10.5 (+7%) that
// passes the full suite: free-drop-from-5m lands 58 ticks in instead of 60,
// a bare-tap hop's airtime drops 0.883s -> 0.817s, a medium knockback's
// apex/airtime drop ~7-8% — real, modest, uncompensated improvements in the
// same direction the owner asked for, without the larger change's fallout.
const GRAVITY_Y = -10.5;

export class PhysicsWorld {
  /** Bey-Bey bumper colliders (see physics/collision/CollisionGroups.ts) → half-height of their Bey's own body. */
  private readonly bumperBodyHalfHeight = new Map<number, number>();

  /**
   * Two bumpers only touch while the two Bey bodies overlap in height; a Bey
   * really above the other (a jump, a launch) passes over it instead of
   * standing on the other's tall bumper (M11: seen with the bumpers alone —
   * one Bey balanced on top of the other for the rest of a round).
   */
  private readonly hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (collider1, collider2, body1, body2) => {
      const h1 = this.bumperBodyHalfHeight.get(collider1);
      const h2 = this.bumperBodyHalfHeight.get(collider2);
      if (h1 === undefined || h2 === undefined) return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      const y1 = this.rapierWorld.getRigidBody(body1).translation().y;
      const y2 = this.rapierWorld.getRigidBody(body2).translation().y;
      return Math.abs(y1 - y2) > h1 + h2 ? RAPIER.SolverFlags.EMPTY : RAPIER.SolverFlags.COMPUTE_IMPULSE;
    },
    filterIntersectionPair: () => true,
  };

  private constructor(readonly rapierWorld: RAPIER.World) {}

  /** Registers a Bey-Bey bumper collider with its Bey body's half-height (for the contact filter above). */
  registerBeyBumper(collider: RAPIER.Collider, bodyHalfHeightM: number): void {
    this.bumperBodyHalfHeight.set(collider.handle, bodyHalfHeightM);
  }

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
    this.rapierWorld.step(undefined, this.hooks);
  }
}
