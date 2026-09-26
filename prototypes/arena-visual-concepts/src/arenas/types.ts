// ============================================================
// ARENA VISUAL CONCEPTS — TYPES
// VISUAL EXPLORATION PROTOTYPE ONLY (GDD sections 1.6, 35, 36, 98).
// The game's arena colliders, ring-out rules and dimensions are NOT
// changed; these concepts use the current arena size (floor radius 12 m,
// wall ~2 m, src/arena/colliders/ArenaTuning.ts) purely as a visual scale.
// ============================================================

import type * as THREE from 'three';

/** Answers to the GDD section 98 "new arena" questions, shown in the info card. */
export interface ArenaAnswers {
  readonly architecture: string;
  readonly floor: string;
  readonly boundary: string;
  readonly lighting: string;
  readonly background: string;
  readonly impact: string;
}

export interface ArenaFrameState {
  /** Seconds since the page started. */
  readonly time: number;
  readonly dt: number;
  /** 0 = normal, 1 = full Clash lighting (eased by the viewer). */
  readonly clash: number;
}

export interface BuiltArena {
  readonly root: THREE.Object3D;
  /** Floor surface height at distance r from the center (y = 0 at the center). */
  floorHeightAt(r: number): number;
  /** Inner radius of the boundary wall. */
  readonly wallRadius: number;
  /** Colors used for impact sparks: [hot core, cooler tail]. */
  readonly sparkColors: readonly [number, number];
  /** Tone-mapping exposure for this arena's lighting. */
  readonly exposure: number;
  /** Scene fog for this arena (applied by the viewer), or null. */
  readonly fog: THREE.Fog | THREE.FogExp2 | null;
  /** Environment-map strength for metal reflections on the Beys. */
  readonly environmentIntensity: number;
  /** Per-frame animation (ambient motion + Clash lighting). */
  update(state: ArenaFrameState): void;
  /** Brief light flash at a wall impact point (world position). */
  flash(point: THREE.Vector3): void;
  dispose(): void;
}

export interface ArenaConcept {
  readonly id: string;
  readonly letter: 'A' | 'B' | 'C';
  /** Temporary descriptive label — NOT a final arena name. */
  readonly headline: string;
  readonly description: string;
  readonly answers: ArenaAnswers;
  build(): BuiltArena;
}
