// ============================================================
// BEY VISUAL CONCEPTS — ASSEMBLY
// Stacks the four pieces bottom-up:
//
//   y = 0 ............ tip contact point (touches the floor)
//   DRIVER ........... tip + driverBody
//   groove
//   DISC ............. smaller than the ring, visible below it
//   groove
//   RING ............. widest piece
//   TOP LAYER ........ nested in the ring center at ring.seatY
//
// Each piece is a named group (`driver`, `disc`, `ring`, `topLayer`) so it
// is easy to find in the scene graph, and so the viewer can pull them apart
// vertically (exploded view) to show the four pieces separately.
// ============================================================

import * as THREE from 'three';
import { createMaterialKit } from './materials';
import type { BuiltPiece, ConceptDefinition, ConceptParts } from './types';

// ---------------- ASSEMBLY TUNING ----------------
const SEAM_GROOVE_HEIGHT = 0.07;       // Height of the recessed band between pieces.
const SEAM_GROOVE_INSET = 0.9;         // Groove radius as a fraction of the smaller adjacent seam radius.
const EXPLODE_GAP = 0.9;               // Vertical gap per piece when fully exploded.
// --------------------------------------------------

export const PIECE_ORDER = ['driver', 'disc', 'ring', 'topLayer'] as const;
export type PieceName = (typeof PIECE_ORDER)[number];

export interface PieceMeasurement {
  /** Widest top-view extent of this piece alone. */
  readonly diameter: number;
  readonly height: number;
}

export interface ConceptMeasurements {
  /** Widest top-view extent (arbitrary prototype units, ~cm). */
  readonly diameter: number;
  readonly height: number;
  /** Length of the tip alone. */
  readonly tipLength: number;
  readonly pieces: Readonly<Record<PieceName, PieceMeasurement>>;
}

export interface BuiltConcept {
  readonly root: THREE.Group;
  readonly measurements: ConceptMeasurements;
  /** 0 = assembled, 1 = fully exploded. */
  setExplode(amount: number): void;
  dispose(): void;
}

export function assembleConcept(definition: ConceptDefinition): BuiltConcept {
  const mats = createMaterialKit(definition.palette);
  const ctx = { mats };
  const built = Object.fromEntries(
    (Object.keys(definition.parts) as Array<keyof ConceptParts>).map((slot) => [slot, definition.parts[slot](ctx)]),
  ) as Record<keyof ConceptParts, BuiltPiece>;

  const groove = (radius: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, SEAM_GROOVE_HEIGHT, 64).translate(0, -SEAM_GROOVE_HEIGHT / 2, 0), mats.darkPlastic);
    m.castShadow = true;
    return m;
  };

  // Driver = tip + body.
  const driver = new THREE.Group();
  driver.add(built.tip.object);
  const body = built.driverBody.object;
  body.position.y = built.tip.height;
  driver.add(body);
  const driverTop = built.tip.height + built.driverBody.height;

  const disc = new THREE.Group();
  disc.add(built.disc.object, groove(SEAM_GROOVE_INSET * Math.min(built.driverBody.topRadius, built.disc.bottomRadius)));
  const discBase = driverTop + SEAM_GROOVE_HEIGHT;

  const ring = new THREE.Group();
  ring.add(built.ring.object, groove(SEAM_GROOVE_INSET * Math.min(built.disc.topRadius, built.ring.bottomRadius)));
  const ringBase = discBase + built.disc.height + SEAM_GROOVE_HEIGHT;

  const topLayer = new THREE.Group();
  topLayer.add(built.topLayer.object);
  const topBase = ringBase + (built.ring.seatY ?? built.ring.height);

  const baseY: Record<PieceName, number> = { driver: 0, disc: discBase, ring: ringBase, topLayer: topBase };
  const holders: Record<PieceName, THREE.Group> = { driver, disc, ring, topLayer };

  const root = new THREE.Group();
  root.name = `concept:${definition.id}`;
  for (const name of PIECE_ORDER) {
    holders[name].name = name;
    holders[name].position.y = baseY[name];
    root.add(holders[name]);
  }

  root.updateMatrixWorld(true);
  const pieces = Object.fromEntries(PIECE_ORDER.map((name) => [name, measure(holders[name])])) as Record<PieceName, PieceMeasurement>;
  const box = new THREE.Box3().setFromObject(root);

  return {
    root,
    measurements: {
      diameter: Math.max(...PIECE_ORDER.map((n) => pieces[n].diameter)),
      height: box.max.y - Math.min(0, box.min.y),
      tipLength: built.tip.height,
      pieces,
    },
    setExplode(amount: number) {
      PIECE_ORDER.forEach((name, index) => {
        holders[name].position.y = baseY[name] + amount * index * EXPLODE_GAP;
      });
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) geometries.add(object.geometry);
      });
      geometries.forEach((g) => g.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
  };
}

function measure(holder: THREE.Object3D): PieceMeasurement {
  let maxRadius = 0;
  const v = new THREE.Vector3();
  holder.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const position = object.geometry.getAttribute('position');
    if (!position) return;
    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      maxRadius = Math.max(maxRadius, Math.hypot(v.x, v.z));
    }
  });
  const box = new THREE.Box3().setFromObject(holder);
  return { diameter: maxRadius * 2, height: box.max.y - box.min.y };
}
