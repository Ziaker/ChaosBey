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
export const GRAVITY_Y = -10.5;
/** Downward acceleration magnitude (positive), for systems (e.g. DriftController's variable-jump release-cut math) that need the actual number Rapier applies rather than re-deriving it from observed body velocity. */
export const GRAVITY_MPS2 = -GRAVITY_Y;

/**
 * Two Bey bodies overlap in height (so they can touch): the gap between their centres is at most the sum of their
 * body half-heights. The one rule both the bumper contact filter below and the body-collision rules use (owner audit
 * B3, 2026-10-03: the collision rule used the horizontal reach as its vertical tolerance — ~1.3 m, a ghost contact
 * with one Bey well above the other).
 */
export function beyBodiesOverlapVertically(y1: number, halfHeight1M: number, y2: number, halfHeight2M: number): boolean {
  return Math.abs(y1 - y2) <= halfHeight1M + halfHeight2M;
}

export class PhysicsWorld {
  /** Bey-Bey bumper colliders (see physics/collision/CollisionGroups.ts) → their Bey's body, its half-height, and its height at the start of the current step. */
  private readonly bumpers = new Map<number, { body: RAPIER.RigidBody; halfHeightM: number; y: number }>();

  /**
   * Two bumpers only touch while the two Bey bodies overlap in height; a Bey
   * really above the other (a jump, a launch) passes over it instead of
   * standing on the other's tall bumper (M11: seen with the bumpers alone —
   * one Bey balanced on top of the other for the rest of a round).
   */
  private readonly hooks: RAPIER.PhysicsHooks = {
    filterContactPair: (collider1, collider2) => {
      const b1 = this.bumpers.get(collider1);
      const b2 = this.bumpers.get(collider2);
      if (b1 === undefined || b2 === undefined) return RAPIER.SolverFlags.COMPUTE_IMPULSE;
      // Heights cached at the start of step(): the world cannot be read from inside a hook (Rapier holds it).
      return beyBodiesOverlapVertically(b1.y, b1.halfHeightM, b2.y, b2.halfHeightM) ? RAPIER.SolverFlags.COMPUTE_IMPULSE : RAPIER.SolverFlags.EMPTY;
    },
    filterIntersectionPair: () => true,
  };

  /**
   * Owner audit B3 (2026-10-03): Rapier's JS World.step() only forwards the physics hooks when an EventQueue is
   * passed too (`stepWithEvents`); with `undefined` it silently ran `step()` without them, so the bumper contact
   * filter above was never called (M11 onward) — two Beys touched whenever their 3 m bumpers overlapped, even with
   * one 2 m above the other. An auto-draining queue (nothing reads its events) makes the hooks run.
   */
  private readonly eventQueue = new RAPIER.EventQueue(true);

  private constructor(readonly rapierWorld: RAPIER.World) {}

  /** Registers a Bey-Bey bumper collider with its Bey body's half-height (for the contact filter above). */
  registerBeyBumper(collider: RAPIER.Collider, bodyHalfHeightM: number): void {
    const body = collider.parent();
    if (!body) throw new Error('registerBeyBumper: the bumper must be attached to its Bey body.');
    this.bumpers.set(collider.handle, { body, halfHeightM: bodyHalfHeightM, y: body.translation().y });
  }

  /**
   * Owner, 2026-10-04 (MatchConfig.gravityScale): "por que os beys caem em câmera lenta?" — the world is ~25× the
   * size of a real Bey, so real gravity reads as the Moon. A match multiplies it; bare constructions keep ×1.
   */
  setGravityScale(scale: number): void {
    this.rapierWorld.gravity = { x: 0, y: GRAVITY_Y * scale, z: 0 };
    this.gravityScaleValue = scale > 0 ? scale : 1;
  }

  private gravityScaleValue = 1;

  /**
   * × every Bey and floor friction coefficient (owner, 2026-10-04: "está impossível buildar momentum com o bey perdendo
   * velocidade a cada toquezinho"). Rapier's floor friction is μ·m·g, so the ×3.6 gravity made it a ×3.6 hidden brake
   * (~17 m/s² of sliding drag that only the throttle could hide — every curve, where the thrust drops, bled speed).
   * Dividing μ by the gravity scale keeps the friction force what it was at ×1 (the game's grip lives in
   * MovementController). Set the gravity scale before creating colliders.
   */
  get frictionScale(): number {
    return 1 / this.gravityScaleValue;
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
    for (const bumper of this.bumpers.values()) bumper.y = bumper.body.translation().y;
    this.rapierWorld.step(this.eventQueue, this.hooks);
  }
}
