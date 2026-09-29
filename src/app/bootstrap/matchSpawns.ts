// ============================================================
// MATCH SPAWNS
// Where a match starts the two Beys. Shared by the live game
// (createMatchScene.ts) and the self-test runner (src/self-test/), so
// self-test batches play the same opening as a real match.
// ============================================================

import { BEY_SPAWN_HEIGHT_M } from '../../bey/core/BeyTuning';
import { floorHeightAt, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';

export interface SpawnPositionM {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// Opposite starting positions, facing each other — arbitrary, generous
// distance for a readable opening (arena radius is 12m).
export const FIRST_SPAWN: SpawnPositionM = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -4 };
export const SECOND_SPAWN: SpawnPositionM = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 4 };

/** The same spawns lifted onto the floor profile (M11 bowls): the spawn height is above the floor there. Flat: FIRST_SPAWN/SECOND_SPAWN exactly. */
export function matchSpawnsFor(floor: ArenaFloorId = 'flat'): { readonly first: SpawnPositionM; readonly second: SpawnPositionM } {
  if (floor === 'flat') return { first: FIRST_SPAWN, second: SECOND_SPAWN };
  const lift = (s: SpawnPositionM): SpawnPositionM => ({ x: s.x, y: s.y + floorHeightAt(floor, s.x, s.z), z: s.z });
  return { first: lift(FIRST_SPAWN), second: lift(SECOND_SPAWN) };
}
