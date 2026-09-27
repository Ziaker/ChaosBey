// ============================================================
// CLASH PRESENTATION LAB — VISUAL POSE LAYER (contact lean + bowl)
// Pure math, Node-testable. Runs AFTER ClashStageSim has copied each
// physics body's transform onto its visual, and only ever moves the
// VISUAL: the Rapier bodies, the Clash rules and the knockback stay
// exactly as they are.
//
// Two jobs:
//  1. Bowl: the lab's physics floor is flat (the approved 3.2m bowl is
//     not in the game's physics yet — visual-prototypes-approval.md §5),
//     but the approved arena art is a bowl. Every Bey is lifted onto the
//     visual surface (y += h(r)) and tilted to the local slope, pivoting
//     on its tip so it stays seated on the floor instead of floating
//     or sinking into it.
//  2. Locked contact: while the Clash is Active, both Beys lean into the
//     contact point and shudder under the push (a lean that grows with
//     each side's own mash surge and with who is ahead), again pivoting
//     on the tip, and are nudged apart by exactly the amount the lean
//     carries their rims forward, so the rims keep meeting instead of
//     interpenetrating.
// ============================================================

import * as THREE from 'three';

export interface ContactPoseParams {
  /** Base lean into the contact (radians). */
  readonly leanRad: number;
  /** Shudder amplitude (radians) and frequency (Hz). */
  readonly wobbleRad: number;
  readonly wobbleHz: number;
}

export interface VisualPoseInput {
  /** Physics body origin (world). */
  readonly bodyPosition: THREE.Vector3;
  /** Physics body rotation (world). */
  readonly bodyQuaternion: THREE.Quaternion;
  /** How far below the body origin the tip touches the floor (m). */
  readonly tipDropM: number;
  /** World XZ direction toward the opponent (unit), or null when not in contact. */
  readonly towardOpponent: THREE.Vector2 | null;
  /** 0..1 blend of the locked-contact pose (0 = pure physics pose). */
  readonly contactWeight: number;
  /** Extra lean factor for this side (mash surge + advantage), 1 = base lean. */
  readonly leanScale: number;
  readonly params: ContactPoseParams;
  /** Seconds, for a deterministic shudder. */
  readonly timeS: number;
  /** Phase offset so the two Beys don't shudder in lockstep. */
  readonly phase: number;
  /** Visual floor height at distance r from the center (flat = () => 0). */
  readonly floorHeightAt: (r: number) => number;
}

export interface VisualPose {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** Total tilt away from vertical of the extra (slope + lean) rotation, radians — for debug/tests. */
  readonly extraTiltRad: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const SLOPE_PROBE_M = 0.05;

/** Rotation that tilts +Y toward the horizontal unit direction (dx, dz) by `angle` radians. */
function tiltToward(dx: number, dz: number, angle: number): THREE.Quaternion {
  const axis = new THREE.Vector3(dz, 0, -dx); // UP × (dx,0,dz): rotating UP about it moves UP toward (dx,0,dz)
  if (axis.lengthSq() < 1e-12 || angle === 0) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle);
}

export function computeVisualPose(input: VisualPoseInput): VisualPose {
  const p = input.bodyPosition;
  const r = Math.hypot(p.x, p.z);

  // 1. Bowl: the surface normal of h(r) leans toward the center as the floor rises.
  const slope = (input.floorHeightAt(r + SLOPE_PROBE_M) - input.floorHeightAt(Math.max(0, r - SLOPE_PROBE_M))) / (r + SLOPE_PROBE_M - Math.max(0, r - SLOPE_PROBE_M));
  const qSlope = r > 1e-6 ? tiltToward(-p.x / r, -p.z / r, Math.atan(slope)) : new THREE.Quaternion();

  // 2. Locked contact: lean into the opponent plus a shudder (along and across the push).
  let qLean = new THREE.Quaternion();
  let rimNudge = 0;
  const w = THREE.MathUtils.clamp(input.contactWeight, 0, 1);
  if (input.towardOpponent && w > 0) {
    const d = input.towardOpponent;
    const { leanRad, wobbleRad, wobbleHz } = input.params;
    const t = input.timeS * Math.PI * 2 * wobbleHz + input.phase;
    const along = (leanRad * input.leanScale + wobbleRad * Math.sin(t)) * w;
    const across = wobbleRad * 0.6 * Math.sin(t * 1.37 + 1.1) * w;
    qLean = tiltToward(d.x, d.y, along).multiply(tiltToward(-d.y, d.x, across));
    // Leaning carries the rim (≈ body-origin height above the tip) forward by tip·sin(lean); step back by that much so the rims just meet.
    rimNudge = input.tipDropM * Math.sin(Math.max(0, along));
  }

  const extra = qSlope.clone().multiply(qLean);
  // Pivot on the tip: rotating about the body origin would swing the tip sideways; put it back where it was.
  const tipLocal = new THREE.Vector3(0, -input.tipDropM, 0);
  const pivotFix = tipLocal.clone().sub(tipLocal.clone().applyQuaternion(extra));

  const position = new THREE.Vector3(p.x, p.y + input.floorHeightAt(r), p.z).add(pivotFix);
  if (input.towardOpponent && rimNudge > 0) {
    position.x -= input.towardOpponent.x * rimNudge;
    position.z -= input.towardOpponent.y * rimNudge;
  }
  const quaternion = extra.clone().multiply(input.bodyQuaternion);
  const extraTiltRad = UP.clone().applyQuaternion(extra).angleTo(UP);
  return { position, quaternion, extraTiltRad };
}

/**
 * Share of the Clash HUD bar owned by the first (player) side, 0..1. Equal
 * ClashPower → 0.5; the leader's part grows in proportion to the power
 * difference. `gain` stretches small real differences (the formula's
 * ClashPower values often differ by only a few %) so a lead is visible at
 * a glance; it never changes which side is ahead or when the lead flips.
 */
export function hudShare(firstPower: number, secondPower: number, gain: number): number {
  const total = firstPower + secondPower;
  if (!(total > 1e-9)) return 0.5;
  const advantage = (firstPower - secondPower) / total; // -1..1
  return THREE.MathUtils.clamp(0.5 + 0.5 * advantage * gain, 0.04, 0.96);
}
