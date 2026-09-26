// ============================================================
// PROCEDURAL BEY MESH — ENGINEERING/DESIGN PROTOTYPE, NOT FINAL
// Explicitly placeholder art (GDD section 1.6/96/97) — none of this is
// the approved Bey visual design. It exists to (a) make spin/tilt/wobble/
// impact behavior visible for testing and (b) let the owner evaluate the
// GDD-required "assembled mechanical top" anatomy — four stacked,
// visually distinct pieces (ring / upper body / lower weight section /
// driver tip) rather than a single primitive cylinder — before any
// material/color/emissive/particle decision is made.
//
// Two-group structure per GDD section 17/83: `group` carries the
// physics-derived position + tilt + wobble; `spinGroup` (its child, holding
// all four pieces) is rotated purely from the decoupled visual spin value
// and never touches physics.
//
// The whole assembly is anchored so the driver tip's point sits at the
// physics collider's bottom (GDD section 104 explicitly allows the visual
// mesh to be decoupled from the collider — this anchor just keeps a taller
// 4-piece stack from visibly floating or clipping through the floor at
// rest; the collider itself, defined in BeyTuning.ts, is unchanged).
// ============================================================

import * as THREE from 'three';
import { BEY_COLLIDER_HALF_HEIGHT_M, BEY_COLLIDER_RADIUS_M } from '../core/BeyTuning';

export interface BeyVisual {
  readonly group: THREE.Group;
  readonly spinGroup: THREE.Group;
}

export interface BeyMeshColorOverride {
  /** PROTOTYPE differentiation only (GDD section 96/97) — not an approved final material/color. See BeyArchetypes.ts. */
  bodyColorHex: number;
  emissiveColorHex: number;
}

/**
 * The four pieces' individual radius/height, top-to-bottom. Each piece is a
 * near-uniform cylinder (only a slight taper) so adjacent pieces meet at a
 * visible ledge/seam — read as distinct assembled components, not one
 * smooth cone. Concrete per-archetype values (BeyArchetypes.ts) are design
 * prototypes exploring silhouette/proportion, not final shape.
 */
export interface BeyMeshProportions {
  ringRadiusM: number;
  ringHeightM: number;
  upperBodyRadiusM: number;
  upperBodyHeightM: number;
  lowerBodyRadiusM: number;
  lowerBodyHeightM: number;
  tipRadiusM: number;
  tipHeightM: number;
}

/** Roughly matches the single-cylinder placeholder's prior overall footprint — the neutral/default Bey's silhouette. */
export const DEFAULT_BEY_MESH_PROPORTIONS: BeyMeshProportions = {
  ringRadiusM: BEY_COLLIDER_RADIUS_M,
  ringHeightM: 0.12,
  upperBodyRadiusM: BEY_COLLIDER_RADIUS_M * 0.83,
  upperBodyHeightM: 0.1,
  lowerBodyRadiusM: BEY_COLLIDER_RADIUS_M * 0.75,
  lowerBodyHeightM: 0.14,
  tipRadiusM: 0.12,
  tipHeightM: 0.08,
};

export interface BeyMeshOptions {
  colorOverride?: BeyMeshColorOverride;
  proportions?: BeyMeshProportions;
}

function stackedPiece(topRadiusM: number, bottomRadiusM: number, heightM: number, material: THREE.Material, centerY: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(topRadiusM, bottomRadiusM, heightM, 24), material);
  mesh.position.y = centerY;
  return mesh;
}

export function createBeyMesh(options?: BeyMeshOptions): BeyVisual {
  const proportions = options?.proportions ?? DEFAULT_BEY_MESH_PROPORTIONS;
  const material = new THREE.MeshStandardMaterial({
    color: options?.colorOverride?.bodyColorHex ?? 0x4fd1ff,
    emissive: options?.colorOverride?.emissiveColorHex ?? 0x0b3a4a,
    roughness: 0.4,
    metalness: 0.6,
  });

  const group = new THREE.Group();
  const spinGroup = new THREE.Group();
  group.add(spinGroup);

  // 4. Driver/tip — the piece that visibly touches the arena. Genuinely
  // tapers to a near-point at the bottom, unlike the other three pieces.
  let y = -BEY_COLLIDER_HALF_HEIGHT_M;
  const tip = stackedPiece(proportions.tipRadiusM, 0.015, proportions.tipHeightM, material, y + proportions.tipHeightM / 2);
  spinGroup.add(tip);
  y += proportions.tipHeightM;

  // 3. Lower body / weight section — visual mass, transition to the base.
  const lowerBody = stackedPiece(
    proportions.lowerBodyRadiusM,
    proportions.lowerBodyRadiusM * 0.92,
    proportions.lowerBodyHeightM,
    material,
    y + proportions.lowerBodyHeightM / 2,
  );
  spinGroup.add(lowerBody);
  y += proportions.lowerBodyHeightM;

  // 2. Upper body — connective mechanical volume between weight section and ring.
  const upperBody = stackedPiece(
    proportions.upperBodyRadiusM,
    proportions.upperBodyRadiusM * 0.92,
    proportions.upperBodyHeightM,
    material,
    y + proportions.upperBodyHeightM / 2,
  );
  spinGroup.add(upperBody);
  y += proportions.upperBodyHeightM;

  // 1. Ring — main identity and impact zone, the widest piece.
  const ringCenterY = y + proportions.ringHeightM / 2;
  const ring = stackedPiece(proportions.ringRadiusM, proportions.ringRadiusM * 0.9, proportions.ringHeightM, material, ringCenterY);
  spinGroup.add(ring);

  // Visible marker on the ring so the fast continuous spin actually reads on screen.
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, proportions.ringHeightM * 1.05, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0x554400 }),
  );
  marker.position.set(proportions.ringRadiusM * 0.8, ringCenterY, 0);
  spinGroup.add(marker);

  return { group, spinGroup };
}
