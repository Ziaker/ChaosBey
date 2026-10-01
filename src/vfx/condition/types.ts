// ============================================================
// CONDITION VISUALS — CONTRACT BETWEEN THE LAYERS AND THE GAME
// The three approved languages (A mechanical wear, B spirit aura, C floor
// instrument) were written against the lab's own state, motion and rig. The
// game feeds the same shapes from what it really computes:
//
//   ConditionState  ← BeyPresentationState (stamina, stability, broken) + events
//   MotionFrame     ← the real pose of the Bey's visual group + a display-only
//                     spin readout (conditionDisplay.ts)
//   ConditionRigLike ← the real BeyVisual (conditionRig.ts)
//
// Layers only OBSERVE (GDD 158). Nothing here reaches gameplay, the physics
// body or the camera: the camera object is read (position, quaternion) to
// face billboards, never written.
// ============================================================

import type * as THREE from 'three';
import type { Particles } from './Particles';
import type { ConditionTuning } from './tuning';

export type LanguageId = 'A' | 'B' | 'C';
export const LANGUAGE_IDS: readonly LanguageId[] = ['A', 'B', 'C'];

export type HitStrength = 'light' | 'medium' | 'heavy';

export type ConditionEvent =
  | { readonly kind: 'hit'; readonly strength: HitStrength; readonly magnitude: number; readonly dirAngle: number; readonly stabilityBefore: number }
  | { readonly kind: 'break' }
  | { readonly kind: 'recover' }
  | { readonly kind: 'spinOut' }
  | { readonly kind: 'down' }
  | { readonly kind: 'reset' };

/** What the layers read about one Bey's condition. All 0..1 unless noted. */
export interface ConditionState {
  /** Seconds since this system started (restarts at 0 on reset). */
  readonly time: number;
  readonly stamina: number;
  readonly stability: number;
  readonly broken: boolean;
  /** Seconds since the last landed hit (large when none). */
  readonly sinceHit: number;
  /** 0 = spinning normally; 0..1 = collapsing; 1 = down. */
  readonly spinOut: number;
  readonly down: boolean;
}

/** The slice of the lab's MotionFrame the layers read, filled from the real pose. */
export interface MotionFrame {
  /** Tip contact point in world space. */
  readonly position: THREE.Vector3;
  /** Direction the top leans toward (radians in the XZ plane). */
  readonly leanDir: number;
  /** Height of the ring's bottom edge above the floor line through the tip (m); <= 0 means the rim touches. */
  readonly rimClearance: number;
  /** Display spin rate (revolutions per second). */
  readonly rps: number;
  /** Drawn rotation of the pieces (clamped to meshMaxRps). */
  readonly meshSpin: number;
  /** Rotation at the display rate: the blur disc and spin lines use it. */
  readonly trueSpin: number;
  /** 0 above wobbleStart, 1 at zero Stamina. */
  readonly wobbleFactor: number;
  /** Eased 0..1 version of `broken`. */
  readonly brokenBlend: number;
  /** Decaying 0..1 shudder after a hit (scaled by how weak Stability was). */
  readonly shudder: number;
  /** Decaying 0..1 flash right after a hit. */
  readonly hitFlash: number;
}

export interface LayerWorld {
  readonly scene: THREE.Object3D;
  readonly camera: THREE.Camera;
  /** Additive particles (sparks, glow). */
  readonly glow: Particles;
  /** Normal-blended particles (smoke, dust, chips). */
  readonly soft: Particles;
  floorHeightAt(x: number, z: number): number;
  floorNormalAt(x: number, z: number, out: THREE.Vector3): THREE.Vector3;
}

export interface LayerFrame {
  readonly state: ConditionState;
  readonly motion: MotionFrame;
  /** Seconds since the system started (for looping animation). */
  readonly time: number;
}

export interface RigMods {
  glowMul: number;
  wear: number;
  rattle: number;
  seamGap: number;
}

export interface RigPalette {
  /** Glow colour of this Bey (the concept's `palette.glow`, or a fallback for the placeholder). */
  readonly glow: number;
}

export interface RigDimsLike {
  /** Ring outer radius (m). */
  readonly ringRadius: number;
  /** Height of the ring's bottom edge above the tip (m). */
  readonly ringBottomY: number;
  readonly ringTopY: number;
  readonly ringMidY: number;
  /** Total height above the tip (m). */
  readonly height: number;
  /** Top of the Top Layer (the emblem / core). */
  readonly topY: number;
}

/** What a layer can reach on one Bey. Implemented over the real visual by conditionRig.ts. */
export interface ConditionRigLike {
  /** World position of the tip contact point; no rotation. */
  readonly root: THREE.Object3D;
  /** Body frame (leaning, shuddering): children follow the Bey's real attitude, pivot at the tip. */
  readonly jitter: THREE.Object3D;
  readonly dims: RigDimsLike;
  readonly palette: RigPalette;
  readonly mods: RigMods;
  bodyToWorld(local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
  rimLowestWorld(leanDir: number, out: THREE.Vector3): THREE.Vector3;
}

export interface ConditionLayer {
  readonly id: LanguageId;
  /** Show/hide everything this layer owns. Re-enabling snaps it to the current state without replaying events. */
  setEnabled(on: boolean): void;
  readonly enabled: boolean;
  /** Called every frame after the rig was placed. Write rig.mods here, spawn particles, animate owned meshes. */
  update(frame: LayerFrame, dt: number): void;
  onEvent(e: ConditionEvent, frame: LayerFrame): void;
  dispose(): void;
}

export interface LayerContext {
  readonly world: LayerWorld;
  readonly rig: ConditionRigLike;
  readonly tuning: ConditionTuning;
}
