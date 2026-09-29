// ============================================================
// HEADING ARROW (M11 — render only)
// A discrete chevron on the floor just ahead of the player's Bey, pointing
// along its current physical heading (MovementController.headingRad) — the
// direction thrust pushes. A spinning top has no visible front, so without
// it the player can't see where the Bey is facing. It shows the heading,
// never the desired input direction (that one is Debug Lab / F3 only).
// ============================================================

import * as THREE from 'three';

const ARROW_LENGTH_M = 0.42;
const ARROW_HALF_WIDTH_M = 0.26;
/** Gap between the Bey's rim and the arrow's back edge. */
const ARROW_GAP_M = 0.18;
/** Above the Bey's base, so it never z-fights the floor. */
const ARROW_LIFT_M = 0.03;

export class HeadingArrow {
  readonly object: THREE.Mesh;

  constructor(parent: THREE.Object3D) {
    // A chevron in the XZ plane pointing +Z (yaw 0 in the fromYaw convention).
    const shape = new THREE.Shape();
    shape.moveTo(0, ARROW_LENGTH_M);
    shape.lineTo(ARROW_HALF_WIDTH_M, 0);
    shape.lineTo(0, ARROW_LENGTH_M * 0.38);
    shape.lineTo(-ARROW_HALF_WIDTH_M, 0);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape);
    // Shape is in XY; lay it on the floor with the tip toward +Z.
    geometry.rotateX(Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    this.object = new THREE.Mesh(geometry, material);
    this.object.name = 'heading-arrow';
    this.object.renderOrder = 2;
    this.object.visible = false;
    parent.add(this.object);
  }

  /** Places the arrow ahead of a Bey at `position` (center) facing `headingRad`; `radiusM`/`halfHeightM` are its collider's. */
  update(position: { x: number; y: number; z: number }, headingRad: number, radiusM: number, halfHeightM: number): void {
    const distance = radiusM + ARROW_GAP_M;
    this.object.position.set(position.x + Math.sin(headingRad) * distance, position.y - halfHeightM + ARROW_LIFT_M, position.z + Math.cos(headingRad) * distance);
    this.object.rotation.set(0, headingRad, 0);
    this.object.visible = true;
  }

  hide(): void {
    this.object.visible = false;
  }
}
