import type RAPIER from '@dimforge/rapier3d-compat';
import type { BeyHandlingProfile } from '../archetype/BeyHandlingProfile';
import type { MotionParams } from '../motion/MotionPresets';
import { MovementController, type MovementPreStepInput } from './MovementController';

/**
 * Match-only policy wrapper for Master §12's speed-limit behavior playtest.
 *
 * The underlying MovementController remains the single owner of steering, grip, acceleration and physical response.
 * Permissive (default) is exactly the existing behavior. Strict only clamps ordinary GROUNDED locomotion after that
 * controller has done its normal pre-step work. It deliberately leaves Dash, Dodge, airborne flight and an active
 * post-impact window alone so counters, knockback, wall bounces, launches and ring-outs keep their real physical
 * overspeed. Air control remains the only locomotion policy that acts on a normal airborne trajectory.
 */
export class MatchMovementController extends MovementController {
  constructor(
    handling: BeyHandlingProfile,
    motion: MotionParams,
    scales: { readonly acceleration: number; readonly topSpeed: number; readonly airControl: number },
    private readonly strictSpeedCap: boolean,
  ) {
    super(handling, motion, scales);
  }

  override applyPreStep(body: RAPIER.RigidBody, input: MovementPreStepInput): void {
    // Read before super(): during a post-impact window super intentionally leaves the collision-resolved velocity alone.
    const postImpactPlaying = this.getSnapshot(body, input.grounded).isPostImpactCooldown;
    super.applyPreStep(body, input);

    if (!this.strictSpeedCap || !input.grounded || postImpactPlaying || input.dashOverride || input.dodgeOverride) return;

    const capMps = this.getMaxSpeedMps() * (input.topSpeedMultiplier ?? 1);
    if (!(capMps > 0)) return;
    const velocity = body.linvel();
    const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
    if (horizontalSpeed <= capMps) return;

    const scale = capMps / horizontalSpeed;
    // Horizontal/top-speed rule only. Preserve vertical velocity exactly: jump/fall/bowl physics owns Y.
    body.setLinvel({ x: velocity.x * scale, y: velocity.y, z: velocity.z * scale }, true);
  }
}
