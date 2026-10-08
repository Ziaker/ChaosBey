// ============================================================
// RAIL BLUEPRINT — a rail authored in stage units, resolved onto the actual floor (Rail Grinding preparation, 0.50.0)
// docs/planning/RAIL_GRINDING_FUTURE_UPDATE.md §6: the stage can be scaled in the Pregame and its funnel deepened or made
// flat, so a rail must not be hard-coded in metres. It is authored in units of the floor radius (u, v) with a height above
// the floor, and resolved against the real floor profile (shape, depth) and the real radius of the match: the route follows
// the bowl and the stage size. The route is subdivided finely enough that the straight pieces between samples hug a curved
// floor.
// ============================================================

import { floorHeightAt, type ArenaFloor } from '../floor/ArenaFloorProfile';
import { RailPath, type Point3 } from './RailPath';

export interface RailBlueprintPoint {
  /** x / floor radius. */
  readonly u: number;
  /** z / floor radius. */
  readonly v: number;
  /** Height of the rail above the floor under it (m, not scaled with the stage). */
  readonly heightM: number;
}

export interface RailBlueprint {
  /** Stable id (replay, telemetry, debug). */
  readonly id: string;
  readonly label: string;
  readonly points: readonly RailBlueprintPoint[];
  readonly closed?: boolean;
}

export interface RailDefinition {
  readonly id: string;
  readonly label: string;
  readonly enabled: boolean;
  readonly path: RailPath;
  /** The floor radius the rail was resolved for (m): inside it a Bey is in the arena, beyond it the Bey is out over the wall. */
  readonly arenaRadiusM: number;
}

/** The longest straight piece of a resolved rail (m): finer than the floor's curvature needs, coarse enough to stay cheap. */
export const RAIL_RESOLVE_STEP_M = 1;

export interface RailResolveContext {
  /** The floor (shape + depth) the match plays on. */
  readonly floor: ArenaFloor;
  /** The match's floor radius (m): 36 m × the stage size. */
  readonly floorRadiusM: number;
}

/** Puts a blueprint on the floor of a match: subdivided, each sample at the floor's height under it plus the rail's own. */
export function resolveRail(blueprint: RailBlueprint, context: RailResolveContext): RailDefinition {
  const world = blueprint.points.map((p) => ({ x: p.u * context.floorRadiusM, z: p.v * context.floorRadiusM, heightM: p.heightM }));
  const closed = blueprint.closed === true;
  const samples: Point3[] = [];
  const pieceCount = closed ? world.length : world.length - 1;
  for (let i = 0; i < pieceCount; i++) {
    const a = world[i]!;
    const b = world[(i + 1) % world.length]!;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / RAIL_RESOLVE_STEP_M));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      samples.push({ x, y: floorHeightAt(context.floor, x, z) + a.heightM + (b.heightM - a.heightM) * t, z });
    }
  }
  if (!closed) {
    const last = world[world.length - 1]!;
    samples.push({ x: last.x, y: floorHeightAt(context.floor, last.x, last.z) + last.heightM, z: last.z });
  }
  return { id: blueprint.id, label: blueprint.label, enabled: true, path: new RailPath(samples, closed), arenaRadiusM: context.floorRadiusM };
}
