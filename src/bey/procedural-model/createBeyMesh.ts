// ============================================================
// PROCEDURAL BEY MESH — ENGINEERING/DESIGN PROTOTYPE, NOT FINAL
// Explicitly placeholder art (GDD section 1.6/96/97) — none of this is
// the approved Bey visual design. It exists to (a) make spin/tilt/wobble/
// impact behavior visible for testing and (b) let the owner evaluate the
// GDD-required "assembled mechanical top" anatomy before any material/
// color/emissive/particle decision is made.
//
// Owner direction (visual round 2, approved as the macro silhouette
// direction in round 3): a "tornado/mechanical top" silhouette, not
// stacked discs — wide at the ring, tapering CONTINUOUSLY down to the
// driver tip's point. Each of the four pieces (ring / upper body / lower
// weight section / driver tip) is defined by its OWN top+bottom radius,
// and adjacent pieces share the same radius at their seam (piece N's
// bottom radius === piece N+1's top radius), so the whole body reads as
// one converging volume, not four separate flat-sided cylinders with big
// ledges between them. The lower weight section + tip are deliberately
// given real height/volume (roughly 60%+ of total height) rather than a
// thin stub, so the bottom of the Bey stays visually present through
// tilt/wobble/bounce/off-axis spin.
//
// Owner refinement (visual round 3): the continuous taper alone made the
// four pieces nearly illegible again (especially on Attack/Stamina) — a
// thin recessed GROOVE is now inserted at each of the 3 seams (a short,
// slightly-smaller-radius cylindrical band) so each piece still reads as
// an assembled mechanical component without reintroducing a stepped/
// stacked-disc look.
//
// Two-group structure per GDD section 17/83: `group` carries the
// physics-derived position + tilt + wobble; `spinGroup` (its child, holding
// all four pieces + grooves) is rotated purely from the decoupled visual
// spin value and never touches physics.
//
// The whole assembly is anchored so the driver tip's point sits at THIS
// Bey's own physical collider's bottom. Milestone 6 review 3: this used to
// be hardcoded to the global BEY_COLLIDER_HALF_HEIGHT_M constant, which
// silently mismatched any archetype whose BeyPhysicalProfile.
// colliderHalfHeightM differs from the default (0.2) — visually clipping
// through the floor (a taller collider) or floating above it (a shorter
// one). The caller now passes its own colliderHalfHeightM explicitly (see
// BeyArchetypes.ts, which derives it from the same BeyPhysicalProfile
// object used to build the real Rapier collider — one source, not a
// duplicated literal), defaulting to the shared default constant only when
// omitted. GDD section 104 still permits the visual mesh's SHAPE to be
// fully decoupled from the collider; only the anchor point is kept
// consistent so a taller/shorter prototype doesn't visibly float or dig
// into the arena floor at rest.
// ============================================================

import * as THREE from 'three';
import { BEY_COLLIDER_HALF_HEIGHT_M } from '../core/BeyTuning';

export interface BeyVisual {
  readonly group: THREE.Group;
  readonly spinGroup: THREE.Group;
}

export interface BeyMeshColorOverride {
  /** PROTOTYPE differentiation only (GDD section 96/97) — not an approved final material/color. See BeyArchetypes.ts. */
  bodyColorHex: number;
  emissiveColorHex: number;
}

/** One tapered piece of the assembly: its own top/bottom radius + height. */
export interface BeyMeshPieceProportions {
  topRadiusM: number;
  bottomRadiusM: number;
  heightM: number;
}

/**
 * The four pieces, top-to-bottom. For a continuous "tornado" taper (not
 * stacked discs), each piece's bottomRadiusM should equal the next piece
 * down's topRadiusM — createBeyMesh() doesn't enforce this, but every
 * concrete profile (DEFAULT below, and BeyArchetypes.ts) is authored that
 * way. Concrete per-archetype values are design prototypes exploring
 * silhouette/proportion, not final shape.
 */
export interface BeyMeshProportions {
  ring: BeyMeshPieceProportions;
  upperBody: BeyMeshPieceProportions;
  lowerBody: BeyMeshPieceProportions;
  tip: BeyMeshPieceProportions;
}

/** The neutral/default Bey's silhouette — a modest tornado taper, roughly matching the prior single-cylinder placeholder's footprint. */
export const DEFAULT_BEY_MESH_PROPORTIONS: BeyMeshProportions = {
  ring: { topRadiusM: 0.6, bottomRadiusM: 0.5, heightM: 0.12 },
  upperBody: { topRadiusM: 0.5, bottomRadiusM: 0.42, heightM: 0.1 },
  lowerBody: { topRadiusM: 0.42, bottomRadiusM: 0.28, heightM: 0.14 },
  tip: { topRadiusM: 0.28, bottomRadiusM: 0.02, heightM: 0.12 },
};

// Groove seam between adjacent pieces: a short cylindrical band recessed
// slightly inward from the seam's shared radius. Kept thin/shallow so it
// reads as a mechanical assembly seam, not a step back to stacked discs.
const GROOVE_HEIGHT_M = 0.018;
const GROOVE_DEPTH_FACTOR = 0.88;

export interface BeyMeshOptions {
  colorOverride?: BeyMeshColorOverride;
  proportions?: BeyMeshProportions;
  /** This Bey's own BeyPhysicalProfile.colliderHalfHeightM — see the file header. Defaults to the shared default profile's value. */
  colliderHalfHeightM?: number;
}

function taperedPiece(piece: BeyMeshPieceProportions, material: THREE.Material, centerY: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(piece.topRadiusM, piece.bottomRadiusM, piece.heightM, 28), material);
  mesh.position.y = centerY;
  return mesh;
}

function groovePiece(seamRadiusM: number, material: THREE.Material, centerY: number): THREE.Mesh {
  const r = seamRadiusM * GROOVE_DEPTH_FACTOR;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, GROOVE_HEIGHT_M, 28), material);
  mesh.position.y = centerY;
  return mesh;
}

export function createBeyMesh(options?: BeyMeshOptions): BeyVisual {
  const proportions = options?.proportions ?? DEFAULT_BEY_MESH_PROPORTIONS;
  const colliderHalfHeightM = options?.colliderHalfHeightM ?? BEY_COLLIDER_HALF_HEIGHT_M;
  const material = new THREE.MeshStandardMaterial({
    color: options?.colorOverride?.bodyColorHex ?? 0x4fd1ff,
    emissive: options?.colorOverride?.emissiveColorHex ?? 0x0b3a4a,
    roughness: 0.4,
    metalness: 0.6,
  });

  const group = new THREE.Group();
  const spinGroup = new THREE.Group();
  group.add(spinGroup);

  // 4. Driver/tip — the piece that visibly touches the arena, converging
  // to a near-point. Deliberately substantial (not a thin stub) so the
  // Bey's bottom half stays visually present through tilt/wobble/bounce.
  let y = -colliderHalfHeightM;
  const tip = taperedPiece(proportions.tip, material, y + proportions.tip.heightM / 2);
  spinGroup.add(tip);
  y += proportions.tip.heightM;

  const groove1 = groovePiece(proportions.tip.topRadiusM, material, y + GROOVE_HEIGHT_M / 2);
  spinGroup.add(groove1);
  y += GROOVE_HEIGHT_M;

  // 3. Lower body / weight section — the bulk of the "tornado" body's downward convergence.
  const lowerBody = taperedPiece(proportions.lowerBody, material, y + proportions.lowerBody.heightM / 2);
  spinGroup.add(lowerBody);
  y += proportions.lowerBody.heightM;

  const groove2 = groovePiece(proportions.lowerBody.topRadiusM, material, y + GROOVE_HEIGHT_M / 2);
  spinGroup.add(groove2);
  y += GROOVE_HEIGHT_M;

  // 2. Upper body — connective mechanical volume between weight section and ring.
  const upperBody = taperedPiece(proportions.upperBody, material, y + proportions.upperBody.heightM / 2);
  spinGroup.add(upperBody);
  y += proportions.upperBody.heightM;

  const groove3 = groovePiece(proportions.upperBody.topRadiusM, material, y + GROOVE_HEIGHT_M / 2);
  spinGroup.add(groove3);
  y += GROOVE_HEIGHT_M;

  // 1. Ring — main identity and impact zone, the widest piece.
  const ringCenterY = y + proportions.ring.heightM / 2;
  const ring = taperedPiece(proportions.ring, material, ringCenterY);
  spinGroup.add(ring);

  // Visible marker on the ring so the fast continuous spin actually reads on screen.
  const marker = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, proportions.ring.heightM * 1.05, 0.1),
    new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0x554400 }),
  );
  marker.position.set(proportions.ring.topRadiusM * 0.8, ringCenterY, 0);
  spinGroup.add(marker);

  return { group, spinGroup };
}
