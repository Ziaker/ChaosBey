// ============================================================
// FLOOR READOUT (M11 lane 4 — debug only)
// What the floor is doing under a Bey, for the Debug Lab inspector and
// the F3 overlay (visual-prototypes-approval.md §5.1 item 5: floor height
// under the Bey, floor normal, slope force). Read-only; nothing here
// feeds the simulation.
// ============================================================

import { floorHeightAt, floorNormalAt, floorSlopeDegAt, type ArenaFloorId } from './ArenaFloorProfile';

/** Gravity used by the physics world (PhysicsWorld.ts), for the downhill-pull readout. */
const GRAVITY_MPS2 = 9.81;

export interface FloorReadout {
  readonly floorHeightM: number;
  readonly heightAboveFloorM: number;
  readonly slopeDeg: number;
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  /** Gravity's component along the slope (m/s², toward the centre): g·sin(slope). 0 on flat ground. */
  readonly downhillPullMps2: number;
}

export function floorReadout(floor: ArenaFloorId, position: { x: number; y: number; z: number }): FloorReadout {
  const floorHeightM = floorHeightAt(floor, position.x, position.z);
  const slopeDeg = floorSlopeDegAt(floor, position.x, position.z);
  return {
    floorHeightM,
    heightAboveFloorM: position.y - floorHeightM,
    slopeDeg,
    normal: floorNormalAt(floor, position.x, position.z),
    downhillPullMps2: GRAVITY_MPS2 * Math.sin((slopeDeg * Math.PI) / 180),
  };
}
