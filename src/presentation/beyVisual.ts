// ============================================================
// BEY VISUAL DEFINITIONS, REGISTRY AND VFX ANCHORS
// Gameplay definition ≠ visual definition. A BeyDefinition (Attack / Defense
// / Stamina today) carries the numbers the simulation reads. A
// BeyVisualDefinition describes how a Bey looks and where effects attach. The
// two meet only through a mapping table, so:
//   - the three gameplay archetypes can wear any registered visual;
//   - visual concepts can exist with no gameplay definition behind them (the
//     nine approved concepts have no stats, and none are invented here);
//   - a visual can never change a collider, a mass or a stat: it builds a
//     BeyVisual (two Three.js groups) and nothing else.
//
// The structure follows the approved anatomy (visual-prototypes-approval.md
// section 1): Top Layer, Ring, Disc, Driver. This module ships NO concept and
// NO model: with every presentation flag off, and while nothing is registered,
// resolution returns the current placeholder mesh untouched.
// ============================================================

import * as THREE from 'three';
import type { BeyDefinition } from '../bey/archetype/BeyDefinition';
import type { BeyVisual } from '../bey/procedural-model/createBeyMesh';
import type { PresentationFeatures } from './features';

/** The four approved pieces, top to bottom. */
export type BeyVisualPieceId = 'topLayer' | 'ring' | 'disc' | 'driver';

/** What one piece is built from: a builder key (the future part builders) and material / emissive-channel keys in the material registry. */
export interface BeyVisualPieceSpec {
  readonly builder: string;
  readonly materials: readonly string[];
  /** Material keys (or channel names) that glow. Small and low intensity by the approved rules. */
  readonly emissive?: readonly string[];
}

export type BeyVisualStatus = 'placeholder' | 'concept' | 'final';

/** Attachment points effects ask for by name instead of knowing a mesh hierarchy. */
export const VFX_ANCHOR_NAMES = ['center', 'tip', 'topLayer', 'ringRim'] as const;
export type VfxAnchorName = (typeof VFX_ANCHOR_NAMES)[number];

export interface LocalOffset {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface BeyVisualDefinition {
  readonly id: string;
  readonly label: string;
  readonly status: BeyVisualStatus;
  /** The approved four-piece structure. Absent for the monolithic placeholder. */
  readonly pieces?: Readonly<Partial<Record<BeyVisualPieceId, BeyVisualPieceSpec>>>;
  /** Exact anchors in the Bey group's local space. Any anchor left out is derived from the built mesh's bounds. */
  readonly anchors?: Readonly<Partial<Record<VfxAnchorName, LocalOffset>>>;
  /** Builds a fresh visual for one spawned Bey (Three.js objects cannot be shared between two Beys). The gameplay definition is passed for placement data such as the collider half-height. */
  create(gameplay: BeyDefinition): BeyVisual;
}

export class BeyVisualRegistry {
  private readonly definitions = new Map<string, BeyVisualDefinition>();
  private readonly assignments = new Map<string, string>();

  register(definition: BeyVisualDefinition): void {
    if (this.definitions.has(definition.id)) throw new Error(`BeyVisualRegistry.register("${definition.id}"): already registered.`);
    this.definitions.set(definition.id, definition);
  }

  get(id: string): BeyVisualDefinition | undefined {
    return this.definitions.get(id);
  }

  list(): readonly BeyVisualDefinition[] {
    return [...this.definitions.values()];
  }

  /** Makes a gameplay definition wear a registered visual. Replaces an earlier assignment. */
  assign(gameplayDefinitionId: string, visualId: string): void {
    if (!this.definitions.has(visualId)) throw new Error(`BeyVisualRegistry.assign("${gameplayDefinitionId}"): visual "${visualId}" is not registered.`);
    this.assignments.set(gameplayDefinitionId, visualId);
  }

  assignedVisualId(gameplayDefinitionId: string): string | undefined {
    return this.assignments.get(gameplayDefinitionId);
  }

  /** Test helper and hot-reload escape hatch: forgets everything registered. */
  clear(): void {
    this.definitions.clear();
    this.assignments.clear();
  }
}

/** The process-wide registry future integrations register their visuals in. Empty today. */
export const BEY_VISUAL_REGISTRY = new BeyVisualRegistry();

/** The visual every gameplay definition has today: whatever its own `appearance` builds (the procedural placeholder). */
export function legacyPlaceholderVisual(gameplay: BeyDefinition): BeyVisualDefinition {
  return { id: `placeholder:${gameplay.id}`, label: `${gameplay.name} (placeholder)`, status: 'placeholder', create: (definition) => definition.appearance.createVisual() };
}

/**
 * Which visual a gameplay definition gets. With `newBeyVisuals` off, or with
 * nothing registered and assigned for it, always the legacy placeholder: the
 * same call (`definition.appearance.createVisual()`) the scene made before.
 */
export function resolveBeyVisualDefinition(gameplay: BeyDefinition, features: PresentationFeatures, registry: BeyVisualRegistry = BEY_VISUAL_REGISTRY): BeyVisualDefinition {
  if (features.newBeyVisuals) {
    const assigned = registry.assignedVisualId(gameplay.id);
    const definition = assigned ? registry.get(assigned) : undefined;
    if (definition) return definition;
  }
  return legacyPlaceholderVisual(gameplay);
}

/**
 * Resolves anchors on one spawned Bey's visual. Offsets are in the Bey group's
 * local space (so they follow position, tilt and wobble, not the spin about the
 * vertical axis). Declared anchors are used as given; the rest come from the
 * built mesh's bounds, which is exact for tip and topLayer and an approximation
 * for ringRim (the widest radius, three quarters of the way up). A final Bey
 * visual declares its own exact anchors.
 */
export class BeyVisualAnchors {
  private readonly offsets: Readonly<Record<VfxAnchorName, LocalOffset>>;

  constructor(
    private readonly visual: BeyVisual,
    declared: BeyVisualDefinition['anchors'] = {},
  ) {
    const derived = deriveAnchorOffsets(visual);
    this.offsets = {
      center: declared.center ?? derived.center,
      tip: declared.tip ?? derived.tip,
      topLayer: declared.topLayer ?? derived.topLayer,
      ringRim: declared.ringRim ?? derived.ringRim,
    };
  }

  getLocal(name: string): LocalOffset | null {
    return (VFX_ANCHOR_NAMES as readonly string[]).includes(name) ? this.offsets[name as VfxAnchorName] : null;
  }

  /** Writes the anchor's current world position into `out`. False if the name is not an anchor. */
  getWorld(name: string, out: { x: number; y: number; z: number }): boolean {
    const local = this.getLocal(name);
    if (!local) return false;
    this.visual.group.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(local.x, local.y, local.z).applyMatrix4(this.visual.group.matrixWorld);
    out.x = p.x;
    out.y = p.y;
    out.z = p.z;
    return true;
  }
}

function deriveAnchorOffsets(visual: BeyVisual): Record<VfxAnchorName, LocalOffset> {
  visual.group.updateWorldMatrix(true, true);
  const inverse = new THREE.Matrix4().copy(visual.group.matrixWorld).invert();
  const box = new THREE.Box3().setFromObject(visual.group).applyMatrix4(inverse);
  if (box.isEmpty()) {
    const origin = { x: 0, y: 0, z: 0 };
    return { center: origin, tip: origin, topLayer: origin, ringRim: origin };
  }
  const radius = Math.max(Math.abs(box.min.x), Math.abs(box.max.x), Math.abs(box.min.z), Math.abs(box.max.z));
  return {
    center: { x: 0, y: 0, z: 0 },
    tip: { x: 0, y: box.min.y, z: 0 },
    topLayer: { x: 0, y: box.max.y, z: 0 },
    ringRim: { x: radius, y: box.min.y + 0.75 * (box.max.y - box.min.y), z: 0 },
  };
}
