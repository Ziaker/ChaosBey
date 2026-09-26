// ============================================================
// BEY VISUAL CONCEPTS — SHARED TYPES
// VISUAL EXPLORATION PROTOTYPE ONLY (GDD section 1.6 / 33 / 96).
// Nothing here is used by gameplay, physics, colliders or stats.
//
// Anatomy — four pieces, modeled on how battle-top products are built
// (Beyblade equivalents in parentheses, for reference only):
//
//   1. TOP LAYER — raised center with the emblem   (Face Bolt + Energy Ring / Chip)
//   2. RING      — widest piece, impact identity   (Fusion/Metal Wheel / Layer)
//   3. DISC      — weight disc, SMALLER than the    (Forge Disc / Spin Track)
//                  ring and visible below it
//   4. DRIVER    — housing + long tip               (Driver / Performance Tip / Bit)
//
// Owner reference: Defense C (round 1) was the one direction that read as
// assembled pieces; every concept now follows its layout, with the disc
// made clearly visible. Recessed grooves mark the Ring/Disc and
// Disc/Driver seams so each piece reads as its own component.
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
 * One built piece, authored with its own local y = 0 at its BOTTOM seam.
 * `bottomRadius` / `topRadius` are the body radii at its lower / upper seam
 * (used by the assembler for seam grooves); decorations such as lobes or
 * blades may extend past them.
 */
export interface BuiltPiece {
  readonly object: THREE.Object3D;
  readonly height: number;
  readonly bottomRadius: number;
  readonly topRadius: number;
  /** Ring only: local y where the top layer sits. Defaults to `height`. */
  readonly seatY?: number;
}

/** A configured piece factory, e.g. `tips.needle({ topRadius: 0.5, height: 1.4 })`. */
export type PieceBuilder = (ctx: PartContext) => BuiltPiece;

/**
 * The swappable slots. Stack order, bottom-up (see assembleConcept.ts):
 *   tip -> driverBody -> disc -> ring -> topLayer
 * `driverBody` + `tip` together form piece 4 (the Driver); they are
 * separate slots only so tips can be swapped independently.
 *
 * To remix, copy a slot from another concept, e.g.
 *   parts: { ...ATTACK_B.parts, tip: ATTACK_C.parts.tip }
 */
export interface ConceptParts {
  readonly topLayer: PieceBuilder;
  readonly ring: PieceBuilder;
  readonly disc: PieceBuilder;
  readonly driverBody: PieceBuilder;
  readonly tip: PieceBuilder;
}

/** Short description of each of the four pieces, shown in the info card. */
export interface PieceNotes {
  readonly topLayer: string;
  readonly ring: string;
  readonly disc: string;
  readonly driver: string;
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
  readonly pieces: PieceNotes;
  readonly palette: ConceptPalette;
  readonly parts: ConceptParts;
}
