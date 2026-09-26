// ============================================================
// BEY VISUAL CONCEPTS — SHARED TYPES
// VISUAL EXPLORATION PROTOTYPE ONLY (GDD section 1.6 / 33 / 96).
// Nothing here is used by gameplay, physics, colliders or stats.
// ============================================================

import type * as THREE from 'three';

export type ConceptArchetype = 'attack' | 'defense' | 'stamina';
export type ConceptLetter = 'A' | 'B' | 'C';

/**
 * Temporary comparison palette for one concept. Hex RGB values.
 * Every model gets painted plastic + metal + dark material + a translucent
 * piece + a small emissive detail, so no concept reads as one flat color.
 */
export interface ConceptPalette {
  /** Main painted plastic (largest colored surfaces). */
  primary: number;
  /** Secondary painted plastic (under-layers, secondary plates). */
  secondary: number;
  /** Small accent paint (stripes, inlays, caps). */
  accent: number;
  /** Bare metal (weights, impact faces, shafts). */
  metal: number;
  /** Dark metal / gunmetal (frames, housings). */
  darkMetal: number;
  /** Tint of translucent parts. */
  translucent: number;
  /** Emissive detail color — kept small and low intensity (physical object, not hologram). */
  glow: number;
}

/** Materials built from a ConceptPalette. One kit per built model so disposal is simple. */
export interface MaterialKit {
  readonly paint: THREE.Material;
  readonly paintAlt: THREE.Material;
  readonly accent: THREE.Material;
  readonly metal: THREE.Material;
  readonly darkMetal: THREE.Material;
  readonly darkPlastic: THREE.Material;
  readonly rubber: THREE.Material;
  readonly translucent: THREE.Material;
  readonly glow: THREE.Material;
}

export interface PartContext {
  readonly mats: MaterialKit;
}

/**
 * One built part. `object` is authored with its own local y = 0 at its
 * mounting base; `height` is how much vertical space it occupies in the
 * bottom-up stack (tip -> lowerBody -> middleLayer). Upper ring and core
 * are mounted, not stacked, so their `height` is informational only.
 */
export interface BuiltPart {
  readonly object: THREE.Object3D;
  readonly height: number;
}

/** A configured part factory. Created by calling a part builder with params, e.g. `tips.needle({ length: 1.7 })`. */
export type PartBuilder = (ctx: PartContext) => BuiltPart;

/**
 * The five swappable anatomy slots. Assembly order (see assembleConcept.ts):
 *   tip          — point at y = 0 (touches the floor), stacked first
 *   lowerBody    — driver housing, stacked on top of the tip
 *   middleLayer  — chassis / weight layer, stacked on top of the lower body
 *   upperRing    — main silhouette element, mounted at the middle layer's BASE
 *   core         — center / emblem, mounted at the middle layer's TOP
 *
 * To remix, copy a slot from another concept, e.g.
 *   parts: { ...ATTACK_B.parts, tip: ATTACK_C.parts.tip }
 */
export interface ConceptParts {
  readonly tip: PartBuilder;
  readonly lowerBody: PartBuilder;
  readonly middleLayer: PartBuilder;
  readonly upperRing: PartBuilder;
  readonly core: PartBuilder;
}

export interface ConceptDefinition {
  /** Stable id, also used as URL hash (e.g. `attack-b`). */
  readonly id: string;
  readonly archetype: ConceptArchetype;
  readonly letter: ConceptLetter;
  /** One-line description of the visual idea. NOT a name. */
  readonly headline: string;
  /** 1–2 sentences about the structural idea. */
  readonly description: string;
  /** Short structural tags shown as chips (element count, tip type, …). */
  readonly traits: readonly string[];
  readonly palette: ConceptPalette;
  readonly parts: ConceptParts;
}
