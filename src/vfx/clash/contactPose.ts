// Ported from prototypes/clash-presentation-concepts/src/presentation/contactPose.ts (Clash Presentation Lab, direction C approved 2026-09-27;
// docs/design-decisions/clash-presentation-approval.md 3.1), contact half only.
// ============================================================
// CLASH — LOCKED-CONTACT POSE (visual only)
// While the Clash is Active both Beys lean into the contact point and shudder
// under the push (a lean that grows with each side's own mash surge and with
// who is ahead), pivoting on the tip, and are nudged apart by exactly the amount
// the lean carries their rims forward, so the rims keep meeting instead of
// interpenetrating.
//
// Runs AFTER the match scene copied each physics body's transform onto its
// visual, and only ever moves the VISUAL group: the Rapier bodies, the Clash
// rules and the knockback stay exactly as they are, and the next frame's sync
// starts again from the body.
//
// Not ported: the lab's bowl half (lifting each Bey onto a visual bowl and
// tilting it to the slope). The lab's physics floor was flat; the game's bowl is
// real physics now, so the body pose already sits on the surface.
// ============================================================

import * as THREE from 'three';

export interface ContactPoseParams {
  /** Base lean into the contact (radians). */
  readonly leanRad: number;
  /** Shudder amplitude (radians) and frequency (Hz). */
  readonly wobbleRad: number;
  readonly wobbleHz: number;
}

export interface ContactPoseInput {
  /** The visual group's pose as the physics sync left it. */
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** How far below the group origin the tip touches the floor (m). */
  readonly tipDropM: number;
  /** World XZ direction toward the opponent (unit). */
  readonly towardOpponent: THREE.Vector2;
  /** 0..1 blend of the locked-contact pose (0 = pure physics pose). */
  readonly contactWeight: number;
  /** Extra lean factor for this side (mash surge + advantage), 1 = base lean. */
  readonly leanScale: number;
  readonly params: ContactPoseParams;
  /** Seconds, for a deterministic shudder. */
  readonly timeS: number;
  /** Phase offset so the two Beys don't shudder in lockstep. */
  readonly phase: number;
}

export interface ContactPose {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  /** Tilt away from the physics attitude added by the lean, radians (for tests). */
  readonly extraTiltRad: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/** Rotation that tilts +Y toward the horizontal unit direction (dx, dz) by `angle` radians. */
function tiltToward(dx: number, dz: number, angle: number): THREE.Quaternion {
  const axis = new THREE.Vector3(dz, 0, -dx); // UP × (dx,0,dz): rotating UP about it moves UP toward (dx,0,dz)
  if (axis.lengthSq() < 1e-12 || angle === 0) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle);
}

export function computeContactPose(input: ContactPoseInput): ContactPose {
  const w = THREE.MathUtils.clamp(input.contactWeight, 0, 1);
  if (w <= 0) return { position: input.position.clone(), quaternion: input.quaternion.clone(), extraTiltRad: 0 };
  const d = input.towardOpponent;
  const { leanRad, wobbleRad, wobbleHz } = input.params;
  const t = input.timeS * Math.PI * 2 * wobbleHz + input.phase;
  const along = (leanRad * input.leanScale + wobbleRad * Math.sin(t)) * w;
  const across = wobbleRad * 0.6 * Math.sin(t * 1.37 + 1.1) * w;
  const extra = tiltToward(d.x, d.y, along).multiply(tiltToward(-d.y, d.x, across));
  // Leaning carries the rim (≈ body-origin height above the tip) forward by tip·sin(lean); step back by that much so the rims just meet.
  const rimNudge = input.tipDropM * Math.sin(Math.max(0, along));
  // Pivot on the tip: rotating about the group origin would swing the tip sideways; put it back where it was.
  const tipLocal = new THREE.Vector3(0, -input.tipDropM, 0);
  const pivotFix = tipLocal.clone().sub(tipLocal.clone().applyQuaternion(extra));
  const position = input.position.clone().add(pivotFix);
  position.x -= d.x * rimNudge;
  position.z -= d.y * rimNudge;
  const quaternion = extra.clone().multiply(input.quaternion);
  return { position, quaternion, extraTiltRad: UP.clone().applyQuaternion(extra).angleTo(UP) };
}

/**
 * Share of a tug-of-war bar owned by the first side, 0..1. Equal ClashPower → 0.5; the
 * leader's part grows with the power difference, stretched by `gain` (the formula's
 * ClashPower values often differ by only a few %). Never changes which side is ahead.
 */
export function clashAdvantageShare(firstPower: number, secondPower: number, gain: number): number {
  const total = firstPower + secondPower;
  if (!(total > 1e-9)) return 0.5;
  const advantage = (firstPower - secondPower) / total; // -1..1
  return THREE.MathUtils.clamp(0.5 + 0.5 * advantage * gain, 0.04, 0.96);
}
