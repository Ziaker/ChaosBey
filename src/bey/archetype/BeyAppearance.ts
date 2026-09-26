// ============================================================
// BEY APPEARANCE — VISUAL FACTORY INTERFACE (MILESTONE 6)
// Decouples a BeyDefinition's visual identity from its gameplay data (GDD
// section 1.4/104: the collider/physics never reference this, and this
// never reaches into physics). createVisual() is called once per spawned
// Bey instance, since Three.js objects can't be shared between two Beys
// on screen at once.
//
// Every BeyAppearance in BeyArchetypes.ts right now is explicitly a
// PROTOTYPE (GDD section 96/97): placeholder shape/color only, to make the
// three archetypes visually distinguishable for owner review, not the
// approved final Bey visual design. Nothing here should be treated as
// final shape, material, color, emissive or particle identity until the
// owner approves a specific prototype.
// ============================================================

import type { BeyVisual } from '../procedural-model/createBeyMesh';

export interface BeyAppearance {
  createVisual(): BeyVisual;
}
