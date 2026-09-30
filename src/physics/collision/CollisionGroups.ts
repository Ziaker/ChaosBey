// ============================================================
// COLLISION GROUPS (M11)
// Which colliders touch which. Rapier pairs two colliders only when each
// one's membership is in the other's filter; a group value packs
// (membership << 16) | filter.
//
// - ARENA: the floor and the wall.
// - BEY_BODY: a Bey's own collider — touches the arena only.
// - BEY_BUMPER: a tall collider on each Bey, the same radius, that only
//   touches the other Bey's bumper. With the Beys' rotations locked
//   (see BeyRigidBody), two short cylinders of different heights closing
//   at Dash speed overlapped deeply in one tick and Rapier separated them
//   vertically: one rode up over the other and passed through it (seen
//   after a Clash Tie). Tall bumpers always overlap far more vertically
//   than sideways, so Bey-Bey contact is always resolved sideways; a real
//   jump (the centres more than a bumper height apart) still clears it.
// ============================================================

const ARENA = 0x0001;
const BEY_BODY = 0x0002;
const BEY_BUMPER = 0x0004;

const groups = (membership: number, filter: number): number => ((membership << 16) | filter) >>> 0;

export const ARENA_COLLISION_GROUPS = groups(ARENA, BEY_BODY | ARENA);
export const BEY_BODY_COLLISION_GROUPS = groups(BEY_BODY, ARENA);
export const BEY_BUMPER_COLLISION_GROUPS = groups(BEY_BUMPER, BEY_BUMPER);
