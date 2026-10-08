// ============================================================
// RAIL COURSE — a rail that leaves the arena and comes back (Rail Grinding prototype, 0.54.0)
// Owner, 2026-10-08, on the first playable rails (short arcs inside the arena): "é para eles terem entradas que levam para
// fora da arena e depois trazem o bey de volta pra arena ... por que são apenas retos? é pra serem bem largos (não em
// tamanho mas em trajeto)". A course is a long route with a gate at each end INSIDE the wall: the Bey enters at a gate, is
// carried out over the wall, round a wide course outside the arena, and brought back in at the other gate (the way there
// and back is the same route, so either gate is an entrance).
//
// This module is the prototype's shape language, pure data in stage units like RailBlueprint (floor radii, so it follows the
// stage size): a handful of parameters per course, a generator that turns them into a RailBlueprint, and the numbers the
// owner judges a course by (length, how much of it is outside, whether it clears the wall, how long a ride takes). The game
// does not read any of it yet — which courses ship, and where, is the owner's call after the Rail Course Lab.
// ============================================================

import { floorHeightAt, type ArenaFloor } from '../floor/ArenaFloorProfile';
import type { RailBlueprint, RailBlueprintPoint, RailDefinition } from './RailBlueprint';
import { RAIL_TUNING } from './RailTraversal';

export interface RailCourseParams {
  /** Where the first gate sits round the arena (degrees, 0 = +x, counter-clockwise seen from above). */
  readonly gateAngleDeg: number;
  /** How far round the arena the course goes before it comes back (degrees, signed: negative = clockwise). */
  readonly sweepDeg: number;
  /** Distance of the gates from the centre, in floor radii. Under 1 = inside the wall. */
  readonly gateRadiusU: number;
  /** Mean distance of the outside run from the centre, in floor radii. Over 1 = outside the wall. */
  readonly outerRadiusU: number;
  /** Swings in and out along the outside run (whole waves). 0 = a plain arc. */
  readonly waves: number;
  /** Size of each swing, in floor radii. */
  readonly waveAmplitudeU: number;
  /** Height over the floor at the gates (m). */
  readonly insideHeightM: number;
  /** Height over the floor (= over the rim) on the outside run (m): clears the wall. */
  readonly outsideHeightM: number;
  /** Rises and falls of the outside run (whole waves). 0 = level. */
  readonly heightWaves: number;
  readonly heightWaveAmplitudeM: number;
  /** Points that define the route (more = smoother). */
  readonly pointCount: number;
}

/** Share of the course (each end) that is the climb out / the descent in. */
export const COURSE_RAMP_FRACTION = 0.18;

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** 0 at the gates, 1 on the outside run: the course is radial at both ends (it goes straight out through the wall). */
function outsideness(t: number): number {
  return smoothstep(0, COURSE_RAMP_FRACTION, t) * smoothstep(0, COURSE_RAMP_FRACTION, 1 - t);
}

/** The climb to the outside height comes earlier than the move outside: by the time the route reaches the wall it is already over it. */
function heightRamp(t: number): number {
  const edge = COURSE_RAMP_FRACTION * 0.55;
  return smoothstep(0, edge, t) * smoothstep(0, edge, 1 - t);
}

/** A course as a blueprint in floor radii. The first and last point are the two gates. */
export function railCourse(id: string, label: string, p: RailCourseParams): RailBlueprint {
  const count = Math.max(8, Math.round(p.pointCount));
  const points: RailBlueprintPoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const out = outsideness(t);
    const angle = ((p.gateAngleDeg + p.sweepDeg * smoothstep(0, 1, t)) * Math.PI) / 180;
    const radius = p.gateRadiusU + (p.outerRadiusU - p.gateRadiusU) * out + p.waveAmplitudeU * Math.sin(2 * Math.PI * p.waves * t) * out;
    const up = heightRamp(t);
    const height = p.insideHeightM + (p.outsideHeightM - p.insideHeightM) * up + p.heightWaveAmplitudeM * Math.sin(2 * Math.PI * p.heightWaves * t) * out;
    points.push({ u: radius * Math.cos(angle), v: radius * Math.sin(angle), heightM: height });
  }
  return { id, label, points };
}

/** The same course rotated round the arena (a second rail on the other side). */
export function rotatedCourse(params: RailCourseParams, degrees: number): RailCourseParams {
  return { ...params, gateAngleDeg: params.gateAngleDeg + degrees };
}

// ---------------- the ideas the lab compares (PROVISIONAL shapes) ----------------
export interface RailCourseIdea {
  readonly id: 'A' | 'B' | 'C' | 'D';
  readonly name: string;
  readonly note: string;
  /** How many copies of the course round the arena show it best. */
  readonly suggestedRails: number;
  readonly params: RailCourseParams;
}

const BASE: RailCourseParams = {
  gateAngleDeg: 0,
  sweepDeg: 150,
  gateRadiusU: 0.8,
  outerRadiusU: 1.5,
  waves: 0,
  waveAmplitudeU: 0,
  insideHeightM: 1.6,
  outsideHeightM: 5,
  heightWaves: 0,
  heightWaveAmplitudeM: 0,
  pointCount: 120,
};

export const RAIL_COURSE_IDEAS: readonly RailCourseIdea[] = [
  {
    id: 'A',
    name: 'Volta larga',
    note: 'Sai pela parede, contorna a arena por fora em um arco largo e entra de novo mais adiante. O mais simples de ler.',
    suggestedRails: 2,
    params: { ...BASE, sweepDeg: 130, outerRadiusU: 1.55 },
  },
  {
    id: 'B',
    name: 'Ondas',
    note: 'O mesmo arco largo, mas serpenteando para dentro e para fora da parede: curvas de verdade, sem trecho reto.',
    suggestedRails: 2,
    params: { ...BASE, sweepDeg: 150, outerRadiusU: 1.55, waves: 3, waveAmplitudeU: 0.22 },
  },
  {
    id: 'C',
    name: 'Volta completa',
    note: 'Dá (quase) uma volta inteira em torno da arena e volta ao lado da entrada. O percurso mais longo; mostra melhor com 1 rail.',
    suggestedRails: 1,
    params: { ...BASE, sweepDeg: 320, outerRadiusU: 1.6, waves: 1.5, waveAmplitudeU: 0.12 },
  },
  {
    id: 'D',
    name: 'Montanha-russa',
    note: 'Arco largo que sobe e desce (alturas diferentes) e serpenteia: um percurso em três dimensões.',
    suggestedRails: 2,
    params: { ...BASE, sweepDeg: 160, outerRadiusU: 1.5, waves: 2, waveAmplitudeU: 0.18, heightWaves: 3, heightWaveAmplitudeM: 2.6, outsideHeightM: 6.5 },
  },
];

// ---------------- what the owner judges a course by ----------------
export interface RailCourseContext {
  readonly floor: ArenaFloor;
  /** The match's floor radius (m): 36 m × the stage size. */
  readonly floorRadiusM: number;
  /** The wall's height over the rim (m): MatchConfig.arenaWallHeightM. */
  readonly wallHeightM: number;
}

export interface RailCourseMetrics {
  readonly lengthM: number;
  /** Length of the part beyond the wall's radius (m) and its share of the whole. */
  readonly outsideLengthM: number;
  readonly outsideShare: number;
  /** Farthest point from the centre (m). */
  readonly maxRadiusM: number;
  readonly highestM: number;
  readonly lowestM: number;
  /** Smallest gap between the route and the top of the wall where it passes over it (m); null if it never leaves the arena. A value ≤ 0 means the route runs through the wall. */
  readonly wallClearanceM: number | null;
  /** Times the route crosses the wall (2 for a normal course: out and back in). */
  readonly wallCrossings: number;
  /** Time to ride the whole course with the rail speed law (s). */
  readonly rideTimeS: number;
  /** Distance between the two gates (m): how far the ride "teleports" the Bey. */
  readonly gateSeparationM: number;
}

/** Seconds to ride `lengthM` metres entering at the start speed and accelerating toward the target speed (RAIL_TUNING). */
export function rideTimeFor(lengthM: number): number {
  const dt = 1 / 120;
  let speed = RAIL_TUNING.startSpeedMps;
  let travelled = 0;
  let time = 0;
  while (travelled < lengthM && time < 600) {
    speed = Math.min(RAIL_TUNING.maxSpeedMps, speed < RAIL_TUNING.targetSpeedMps ? Math.min(RAIL_TUNING.targetSpeedMps, speed + RAIL_TUNING.accelerationMps2 * dt) : speed);
    travelled += speed * dt;
    time += dt;
  }
  return time;
}

export function courseMetrics(rail: RailDefinition, context: RailCourseContext): RailCourseMetrics {
  const path = rail.path;
  const step = 0.5;
  let outsideLengthM = 0;
  let maxRadiusM = 0;
  let highestM = -Infinity;
  let lowestM = Infinity;
  let wallClearanceM: number | null = null;
  let wallCrossings = 0;
  let wasOutside = false;
  const rimY = floorHeightAt(context.floor, context.floorRadiusM, 0);
  for (let s = 0; s <= path.lengthM; s += step) {
    const sample = path.sampleAt(s);
    const r = Math.hypot(sample.position.x, sample.position.z);
    const outside = r > context.floorRadiusM;
    if (outside) outsideLengthM += step;
    if (s > 0 && outside !== wasOutside) wallCrossings++;
    wasOutside = outside;
    maxRadiusM = Math.max(maxRadiusM, r);
    highestM = Math.max(highestM, sample.position.y);
    lowestM = Math.min(lowestM, sample.position.y);
    // Over the wall: a window around its radius (the wall is thin, ±1 m covers a fast crossing sampled every half metre).
    if (Math.abs(r - context.floorRadiusM) <= 1) {
      const gap = sample.position.y - (rimY + context.wallHeightM);
      wallClearanceM = wallClearanceM === null ? gap : Math.min(wallClearanceM, gap);
    }
  }
  const first = path.points[0]!;
  const last = path.points[path.points.length - 1]!;
  return {
    lengthM: path.lengthM,
    outsideLengthM,
    outsideShare: outsideLengthM / path.lengthM,
    maxRadiusM,
    highestM,
    lowestM,
    wallClearanceM,
    wallCrossings,
    rideTimeS: rideTimeFor(path.lengthM),
    gateSeparationM: Math.hypot(last.x - first.x, last.z - first.z),
  };
}
