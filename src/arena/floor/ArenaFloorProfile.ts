// ============================================================
// ARENA FLOOR PROFILES (M11 lane 4 — bowl A/B/C for playtest)
// The single source of truth for the floor's shape (GDD 1.3, 101):
// collider, visuals, spawns, placement, camera floor guard and debug all
// read h(r) from here.
//
// The three bowl profiles are the shapes approved in
// docs/design-decisions/visual-prototypes-approval.md §2, one per arena
// direction in the lab. Arena scale pass (owner request): the stage is 3x
// wider (R = 12 m -> 36 m) and the centre is sunk BOWL_DEPTH_M = 2.5 m below
// the rim (was 3.2 m at R = 12). Each profile keeps its approved curve, in
// units of R (the plateau radius scales with R too):
//   A  parabolic dish     h(r) = D · (r/R)²
//   B  funnel             h(r) = D · (r/R)^1.3
//   C  central plateau    h(r) = 0 for r ≤ P, else D · ((r−P)/(R−P))^1.4   (P = 0.2167·R = 7.8 m)
// A and B are smooth at the centre (slope 0 there), C is flat to P and
// then eases up (exponent > 1: slope 0 at P) — none has a hard corner.
// `flat` (h = 0) is no longer the default: it is kept only as the
// explicit baseline to compare the bowls against. The default floor is the
// parabolic dish (DEFAULT_ARENA_FLOOR). A profile is independent of the
// visual theme.
//
// What the slope does to gameplay comes only from gravity and the real
// contact with the concave collider — no extra "slope pull" force is
// invented here (how strong it should be is approval §4 item 4, open).
// Ring-out keeps its radius (RingOutTuning.ts); the wall is measured from
// the rim (approval §2.3).
// ============================================================

import { ARENA_FLOOR_RADIUS } from '../colliders/ArenaTuning';

export type ArenaFloorId = 'flat' | 'bowl-a' | 'bowl-b' | 'bowl-c';

/** Rim height above the centre for every bowl: the target depth of the central basin (owner request: 2.5 m; approval §2.1 had 3.2 m at R = 12 m). */
export const BOWL_DEPTH_M = 2.5;
/** Profile C's flat central plateau radius: the approved 2.6 m at R = 12 m, scaled with the arena (3x -> 7.8 m, approval §2.2). */
export const BOWL_C_PLATEAU_RADIUS_M = 7.8;

export interface ArenaFloorProfile {
  readonly id: ArenaFloorId;
  /** Short name for menus. */
  readonly label: string;
  /** One line for menus and reports. */
  readonly description: string;
  /** Floor height (m) at distance r from the centre, for 0 ≤ r ≤ ARENA_FLOOR_RADIUS. */
  readonly heightAtRadius: (r: number) => number;
  /** dh/dr at r (for the floor normal and slope readouts). */
  readonly slopeAtRadius: (r: number) => number;
}

const R = ARENA_FLOOR_RADIUS;
const D = BOWL_DEPTH_M;
const P = BOWL_C_PLATEAU_RADIUS_M;

const clampR = (r: number): number => Math.min(R, Math.max(0, r));

export const ARENA_FLOORS: Readonly<Record<ArenaFloorId, ArenaFloorProfile>> = {
  flat: {
    id: 'flat',
    label: 'Flat (baseline)',
    description: 'No slope at all. Kept only as the baseline to compare the bowls against; no longer the default.',
    heightAtRadius: () => 0,
    slopeAtRadius: () => 0,
  },
  'bowl-a': {
    id: 'bowl-a',
    label: 'Bowl A — Parabolic dish',
    description: 'Gentle centre, slope growing toward the wall (2.5 m rim).',
    heightAtRadius: (r) => D * (clampR(r) / R) ** 2,
    slopeAtRadius: (r) => (2 * D * clampR(r)) / (R * R),
  },
  'bowl-b': {
    id: 'bowl-b',
    label: 'Bowl B — Funnel',
    description: 'Slopes almost all the way to the centre (2.5 m rim).',
    heightAtRadius: (r) => D * (clampR(r) / R) ** 1.3,
    slopeAtRadius: (r) => {
      const x = clampR(r);
      return x <= 0 ? 0 : ((1.3 * D) / R) * (x / R) ** 0.3;
    },
  },
  'bowl-c': {
    id: 'bowl-c',
    label: 'Bowl C — Central plateau',
    description: 'A flat 7.8 m plateau in the middle, then a curve up to the wall (2.5 m rim).',
    heightAtRadius: (r) => {
      const x = clampR(r);
      return x <= P ? 0 : D * ((x - P) / (R - P)) ** 1.4;
    },
    slopeAtRadius: (r) => {
      const x = clampR(r);
      return x <= P ? 0 : ((1.4 * D) / (R - P)) * ((x - P) / (R - P)) ** 0.4;
    },
  },
};

export const ARENA_FLOOR_IDS: readonly ArenaFloorId[] = ['flat', 'bowl-a', 'bowl-b', 'bowl-c'];
/** The stage is never flat by default: the parabolic dish (smooth everywhere, slope 0 at the centre, steepest at the wall). */
export const DEFAULT_ARENA_FLOOR: ArenaFloorId = 'bowl-a';

export function isArenaFloorId(value: unknown): value is ArenaFloorId {
  return typeof value === 'string' && (ARENA_FLOOR_IDS as readonly string[]).includes(value);
}

/** Floor height under (x, z). Past the floor edge it is the rim height (the wall sits there). */
export function floorHeightAt(floor: ArenaFloorId, x: number, z: number): number {
  return ARENA_FLOORS[floor].heightAtRadius(Math.hypot(x, z));
}

/** Height of the rim (the floor at its edge) above the centre: 0 flat, 2.5 m (BOWL_DEPTH_M) for a bowl. */
export function floorRimHeight(floor: ArenaFloorId): number {
  return ARENA_FLOORS[floor].heightAtRadius(R);
}

/** Unit floor normal under (x, z) (points up and toward the centre on a slope). */
export function floorNormalAt(floor: ArenaFloorId, x: number, z: number): { x: number; y: number; z: number } {
  const r = Math.hypot(x, z);
  const s = ARENA_FLOORS[floor].slopeAtRadius(r);
  if (r < 1e-9 || s === 0) return { x: 0, y: 1, z: 0 };
  // Surface y = h(r): gradient = s · (x/r, z/r); normal ∝ (−∇h, 1).
  const nx = (-s * x) / r;
  const nz = (-s * z) / r;
  const len = Math.hypot(nx, 1, nz);
  return { x: nx / len, y: 1 / len, z: nz / len };
}

/** Slope angle (degrees) under (x, z). */
export function floorSlopeDegAt(floor: ArenaFloorId, x: number, z: number): number {
  return (Math.atan(ARENA_FLOORS[floor].slopeAtRadius(Math.hypot(x, z))) * 180) / Math.PI;
}
