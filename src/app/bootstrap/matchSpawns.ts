// ============================================================
// MATCH SPAWNS
// Where a match starts the two Beys. Shared by the live game
// (createMatchScene.ts) and the self-test runner (src/self-test/), so
// self-test batches play the same opening as a real match.
// ============================================================

import { BEY_SPAWN_HEIGHT_M } from '../../bey/core/BeyTuning';

export interface SpawnPositionM {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// Opposite starting positions, facing each other — arbitrary, generous
// distance for a readable opening (arena radius is 12m).
export const FIRST_SPAWN: SpawnPositionM = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: -4 };
export const SECOND_SPAWN: SpawnPositionM = { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 4 };
