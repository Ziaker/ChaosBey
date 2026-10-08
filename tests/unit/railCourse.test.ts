// Rail Course Lab (0.54.0, prototype): the course generator, the numbers a course is judged by, the ride preview and the lab's
// rails. Owner, 2026-10-08: rails should leave the arena and come back, on long curved routes — "bem largos (não em tamanho
// mas em trajeto)". Nothing here reaches the game.

import { describe, expect, it } from 'vitest';
import { MATCH_BOWL_DEPTH_DEFAULT_M, type ArenaFloor } from '../../src/arena/floor/ArenaFloorProfile';
import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';
import { resolveRail } from '../../src/arena/rails/RailBlueprint';
import { courseMetrics, rideTimeFor, railCourse, RAIL_COURSE_IDEAS, rotatedCourse } from '../../src/arena/rails/RailCourse';
import { RAIL_TUNING } from '../../src/arena/rails/RailTraversal';
import { ARENA_PRESETS } from '../../src/arena/presets/ArenaPresets';
import { labRails, MAX_LAB_RAILS, PARAM_SPECS } from '../../prototypes/rail-course-lab/src/labRails';
import { RideSim } from '../../prototypes/rail-course-lab/src/sim/RideSim';

const FLOOR: ArenaFloor = { id: 'bowl-b', depthM: MATCH_BOWL_DEPTH_DEFAULT_M };
const R = ARENA_FLOOR_RADIUS;
const DT = 1 / 60;

describe('rail course generator', () => {
  it('starts and ends at two gates inside the wall, and spends most of the route outside it', () => {
    for (const idea of RAIL_COURSE_IDEAS) {
      const rail = resolveRail(railCourse(idea.id, idea.name, idea.params), { floor: FLOOR, floorRadiusM: R });
      const first = rail.path.points[0]!;
      const last = rail.path.points[rail.path.points.length - 1]!;
      expect(Math.hypot(first.x, first.z), idea.id).toBeLessThan(R);
      expect(Math.hypot(last.x, last.z), idea.id).toBeLessThan(R);
      const m = courseMetrics(rail, { floor: FLOOR, floorRadiusM: R, wallHeightM: 2 });
      expect(m.outsideShare, idea.id).toBeGreaterThan(0.5);
      expect(m.wallCrossings, idea.id).toBe(2);
      expect(m.wallClearanceM ?? 0, idea.id).toBeGreaterThan(0.5); // over the wall, never through it
      expect(m.lengthM, idea.id).toBeGreaterThan(100); // long routes, not short arcs
    }
  });

  it('leaves and enters radially: the first and last stretch point straight through the wall', () => {
    const idea = RAIL_COURSE_IDEAS[0]!;
    const rail = resolveRail(railCourse(idea.id, idea.name, idea.params), { floor: FLOOR, floorRadiusM: R });
    for (const [s, sign] of [[0.5, 1], [rail.path.lengthM - 0.5, -1]] as const) {
      const sample = rail.path.sampleAt(s);
      const radial = { x: sample.position.x, z: sample.position.z };
      const len = Math.hypot(radial.x, radial.z);
      const flat = Math.hypot(sample.tangent.x, sample.tangent.z); // the route also climbs: judge the horizontal heading
      const cos = ((sample.tangent.x * radial.x + sample.tangent.z * radial.z) / (len * flat)) * sign;
      expect(cos).toBeGreaterThan(0.9);
    }
  });

  it('follows the stage size: the same course on a bigger floor is proportionally longer', () => {
    const idea = RAIL_COURSE_IDEAS[1]!;
    const small = resolveRail(railCourse(idea.id, idea.name, idea.params), { floor: FLOOR, floorRadiusM: R });
    const big = resolveRail(railCourse(idea.id, idea.name, idea.params), { floor: FLOOR, floorRadiusM: R * 1.5 });
    expect(big.path.lengthM / small.path.lengthM).toBeGreaterThan(1.3);
  });

  it('is deterministic and rotates round the arena', () => {
    const idea = RAIL_COURSE_IDEAS[2]!;
    const a = railCourse('a', 'a', idea.params);
    expect(railCourse('a', 'a', idea.params)).toEqual(a);
    const turned = rotatedCourse(idea.params, 180);
    expect(turned.gateAngleDeg).toBe(idea.params.gateAngleDeg + 180);
    const p0 = a.points[0]!;
    const q0 = railCourse('b', 'b', turned).points[0]!;
    expect(q0.u).toBeCloseTo(-p0.u, 6);
    expect(q0.v).toBeCloseTo(-p0.v, 6);
  });

  it('every wall in the game is cleared by every idea', () => {
    for (const preset of ARENA_PRESETS) {
      for (const idea of RAIL_COURSE_IDEAS) {
        const rail = resolveRail(railCourse(idea.id, idea.name, idea.params), { floor: FLOOR, floorRadiusM: R });
        const m = courseMetrics(rail, { floor: FLOOR, floorRadiusM: R, wallHeightM: preset.geometry.wallHeightM });
        expect(m.wallClearanceM ?? 1, `${preset.id}/${idea.id}`).toBeGreaterThan(0.3);
      }
    }
  });
});

describe('ride time', () => {
  it('follows the rail speed law: a short rail is slower than a long one per metre', () => {
    expect(rideTimeFor(0)).toBe(0);
    const short = rideTimeFor(20);
    const long = rideTimeFor(200);
    expect(long).toBeGreaterThan(short);
    expect(200 / long).toBeGreaterThan(20 / short);
    expect(200 / long).toBeLessThanOrEqual(RAIL_TUNING.maxSpeedMps);
  });
});

describe('lab rails', () => {
  it('spreads the copies evenly round the arena and clamps the count', () => {
    const params = RAIL_COURSE_IDEAS[0]!.params;
    expect(labRails(params, 2, FLOOR, R)).toHaveLength(2);
    expect(labRails(params, 99, FLOOR, R)).toHaveLength(MAX_LAB_RAILS);
    expect(labRails(params, 0, FLOOR, R)).toHaveLength(1);
    const [a, b] = labRails(params, 2, FLOOR, R);
    const pa = a!.path.points[0]!;
    const pb = b!.path.points[0]!;
    expect(pb.x).toBeCloseTo(-pa.x, 3);
    expect(pb.z).toBeCloseTo(-pa.z, 3);
  });

  it('has a slider per parameter, with every idea inside every range', () => {
    expect(new Set(PARAM_SPECS.map((s) => s.key)).size).toBe(PARAM_SPECS.length);
    for (const idea of RAIL_COURSE_IDEAS) {
      for (const spec of PARAM_SPECS) {
        const v = idea.params[spec.key];
        expect(v, `${idea.id}.${spec.key}`).toBeGreaterThanOrEqual(spec.min);
        expect(v, `${idea.id}.${spec.key}`).toBeLessThanOrEqual(spec.max);
      }
      expect(idea.suggestedRails).toBeGreaterThanOrEqual(1);
      expect(idea.suggestedRails).toBeLessThanOrEqual(MAX_LAB_RAILS);
    }
  });
});

describe('ride preview', () => {
  const rail = () => labRails(RAIL_COURSE_IDEAS[0]!.params, 1, FLOOR, R)[0]!;

  function ride(sim: RideSim, seconds: number): void {
    for (let i = 0; i < seconds / DT; i++) sim.step(DT);
  }

  /** Steps until the Bey is off the rail (the ride restarts by itself some seconds after landing, so a fixed span would run past it). */
  function untilOffRail(sim: RideSim): void {
    for (let i = 0; i < 60 * 60 && (sim.phase === 'riding' || sim.phase === 'returning'); i++) sim.step(DT);
  }

  it('rides the whole route, accelerating toward the target speed, and leaves at the far gate', () => {
    const sim = new RideSim(rail(), FLOOR, R, () => false);
    expect(sim.speedMps).toBe(RAIL_TUNING.startSpeedMps);
    ride(sim, 1);
    expect(sim.speedMps).toBeGreaterThan(RAIL_TUNING.startSpeedMps);
    expect(sim.speedMps).toBeLessThanOrEqual(RAIL_TUNING.targetSpeedMps);
    untilOffRail(sim);
    expect(sim.lastEnd).toBe('end');
    expect(sim.progressM).toBeCloseTo(rail().path.lengthM, 6);
  });

  it('a Jump inside the wall launches the Bey back into the arena', () => {
    const sim = new RideSim(rail(), FLOOR, R, () => false);
    ride(sim, 0.05);
    expect(sim.insideWall).toBe(true);
    sim.jump();
    expect(sim.phase).toBe('flying');
    expect(sim.lastEnd).toBe('jump-inside');
  });

  it('a Jump outside the wall carries the Bey back along the same route to the gate it came in by', () => {
    const sim = new RideSim(rail(), FLOOR, R, () => false);
    for (let i = 0; i < 600 && sim.insideWall; i++) sim.step(DT); // ride out through the wall
    expect(sim.insideWall).toBe(false);
    const start = rail().path.points[0]!;
    sim.jump();
    expect(sim.phase).toBe('returning');
    expect(sim.direction).toBe(-1);
    sim.jump(); // a second press while coming back does nothing
    expect(sim.phase).toBe('returning');
    untilOffRail(sim);
    expect(sim.lastEnd).toBe('jump-outside-back');
    expect(sim.progressM).toBe(0);
    expect(sim.position.x).toBeCloseTo(start.x, 0); // it left from the first gate (then flew on)
    expect(sim.phase === 'flying' || sim.phase === 'resting').toBe(true);
  });

  it('restarts at either gate', () => {
    const sim = new RideSim(rail(), FLOOR, R, () => true);
    sim.start(1);
    expect(sim.direction).toBe(1);
    expect(sim.progressM).toBe(0);
    sim.start(-1);
    expect(sim.direction).toBe(-1);
    expect(sim.progressM).toBeCloseTo(rail().path.lengthM, 6);
  });
});
