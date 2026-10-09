// ============================================================
// BEY REAL — TWO BEYS TOUCHING
// A plain body-to-body contact in a Bey Real match (no attack connecting) is resolved the way two real tops meet: the bounce
// depends on how hard they still spin (a tired top rebounds less), and the two rims rub — friction at the contact point drags
// both Beys sideways and moves spin between them (tops that spin opposite ways mesh, tops that spin the same way grind each
// other down). Impacts and rubbing cost spin; the impact also costs Stability.
//
// Pure arithmetic on the speeds the Beys carried into the step (the game's physics world has separated the bodies already; this
// replaces its bounce, not its separation). Masses are relative: the mean of the two is 1, so the numbers are the lab's
// (prototypes/bey-real-physics-concepts/src/sim/RealSim.ts, `bodyContact`).
// ============================================================

import type { Vec2 } from '../../physics/Vec2';
import type { RealModeConfig } from './RealTuning';

/** The speed of a rim at full spin (m/s): what the friction drags against. */
export const RIM_SPEED_MPS = 10;

export interface ContactBody {
  /** The horizontal velocity it carried into the step. */
  readonly velocity: Vec2;
  /** Mass (any unit: only the ratio counts). */
  readonly mass: number;
  /** Share of the full spin left, 0..1. */
  readonly spin: number;
  /** +1 / -1: the way it spins. */
  readonly dir: 1 | -1;
}

export interface ContactOutcome {
  /** The velocities after the contact (horizontal). */
  readonly velocityA: Vec2;
  readonly velocityB: Vec2;
  /** Change of each Bey's spin (shares of the full spin; negative = lost). */
  readonly spinDeltaA: number;
  readonly spinDeltaB: number;
  /** The normal impulse, in the lab's units (relative mass 1): what the Stability cost scales with. */
  readonly impulse: number;
  /** The closing speed along the line between them (m/s). */
  readonly closingMps: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp(t, 0, 1);

/** `normal` is the unit vector from A to B. Returns null when they are not approaching. */
export function resolveRealContact(config: RealModeConfig, a: ContactBody, b: ContactBody, normal: Vec2): ContactOutcome | null {
  const closing = (a.velocity.x - b.velocity.x) * normal.x + (a.velocity.z - b.velocity.z) * normal.z;
  if (closing <= 0) return null;
  const mean = (a.mass + b.mass) / 2;
  const invA = mean / a.mass;
  const invB = mean / b.mass;
  const invSum = invA + invB;
  const e = lerp(config.restitutionLow, config.restitutionHigh, 0.5 * (a.spin + b.spin));
  const jn = ((1 + e) * closing) / invSum;
  let vax = a.velocity.x - normal.x * jn * invA;
  let vaz = a.velocity.z - normal.z * jn * invA;
  let vbx = b.velocity.x + normal.x * jn * invB;
  let vbz = b.velocity.z + normal.z * jn * invB;

  // Rim friction: the rims slide against each other; the spins decide how much.
  const tx = -normal.z;
  const tz = normal.x;
  const rimA = a.dir * a.spin * RIM_SPEED_MPS;
  const rimB = b.dir * b.spin * RIM_SPEED_MPS;
  const vtRel = vax * tx + vaz * tz + rimA - (vbx * tx + vbz * tz - rimB);
  const jtMax = config.rimFriction * jn;
  const jt = clamp(-vtRel / invSum, -jtMax, jtMax);
  vax += tx * jt * invA;
  vaz += tz * jt * invA;
  vbx -= tx * jt * invB;
  vbz -= tz * jt * invB;

  // Spin: it moves between them with the friction, and impacts and rubbing wear it down.
  const rub = Math.abs(jt);
  const wear = config.hitSpinLoss * jn + config.rubSpinLoss * rub;
  return {
    velocityA: { x: vax, z: vaz },
    velocityB: { x: vbx, z: vbz },
    spinDeltaA: a.dir * config.spinExchange * jt - wear,
    spinDeltaB: b.dir * config.spinExchange * jt - wear,
    impulse: jn,
    closingMps: closing,
  };
}
