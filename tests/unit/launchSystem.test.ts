// Launch System A — Timing Snap (owner-approved 2026-10-07, docs/design-decisions/launch-system-approval.md): the pure core.
// What these tests pin is the approved flow, not balance: no post-landing phase, one press, a valid entry point, both Beys
// arriving, the same result from the same inputs, and every number coming from one tuning file.

import { describe, expect, it } from 'vitest';
import { MATCH_BOWL_DEPTH_DEFAULT_M, type ArenaFloor } from '../../src/arena/floor/ArenaFloorProfile';
import { ARENA_FLOOR_RADIUS } from '../../src/arena/colliders/ArenaTuning';
import { ATTACK_AI_PERSONALITY, DEFENSE_AI_PERSONALITY } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ACE_TIER, ROOKIE_TIER } from '../../src/ai/difficulty/AiDifficultyTiers';
import { INTENDED_MAX_SPEED_MPS } from '../../src/bey/movement/MovementTuning';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { SeededRng } from '../../src/rng/SeededRng';
import { planAiLaunch } from '../../src/launch/LaunchAiPolicy';
import { clampLaunchTarget, defaultLaunchTarget, flightPlan, flightPose, launcherBase, launcherForward, launcherRight, separateTargets, socketPosition } from '../../src/launch/LaunchGeometry';
import { launchArrivals, parseLaunchResult, validTargets, type LaunchResult } from '../../src/launch/LaunchResult';
import { LaunchSequence, type LaunchDriver } from '../../src/launch/LaunchSequence';
import { LAUNCH_TUNING, launchGrade, launchOutcomeFor, markerAt, timingQuality } from '../../src/launch/LaunchTuning';

const FLOOR: ArenaFloor = { id: 'bowl-b', depthM: MATCH_BOWL_DEPTH_DEFAULT_M };
const ARENA = { floor: FLOOR, floorRadiusM: ARENA_FLOOR_RADIUS };
const SHAPE = { colliderHalfHeightM: 0.4, colliderRadiusM: 0.65 };
const SHAPES = { first: SHAPE, second: SHAPE };
const TICK = FIXED_DELTA_SECONDS;
const PERSON: LaunchDriver = { kind: 'person' };

function sequence(first: LaunchDriver = PERSON, second: LaunchDriver = { kind: 'plan', target: { x: -3, z: 9 }, quality: 0.8 }): LaunchSequence {
  return new LaunchSequence({ arena: ARENA, sides: { first: { driver: first, shape: SHAPE }, second: { driver: second, shape: SHAPE } } });
}

/** Steps until `phase`, optionally pressing LAUNCH on the first tick the marker is at least at `markerAtLeast`. */
function runToArmed(seq: LaunchSequence): void {
  for (let i = 0; i < 600 && seq.currentPhase !== 'armed'; i++) seq.step();
}

describe('timing', () => {
  it('the marker is a triangle wave that sweeps 0 → 1 → 0 and the sweet spot scores 1', () => {
    expect(markerAt(0)).toBe(0);
    expect(markerAt(1 / LAUNCH_TUNING.markerSpeedPerS)).toBeCloseTo(1, 9);
    expect(markerAt(2 / LAUNCH_TUNING.markerSpeedPerS)).toBeCloseTo(0, 9);
    for (let s = 0; s < 20; s += 0.037) {
      const m = markerAt(s);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
    expect(timingQuality(LAUNCH_TUNING.markerSweetSpot)).toBe(1);
    expect(timingQuality(0)).toBe(0);
    expect(timingQuality(LAUNCH_TUNING.markerSweetSpot + LAUNCH_TUNING.markerWindowHalfWidth / 2)).toBeCloseTo(0.5, 9);
  });

  it('grades by quality, and every grade-to-gameplay number comes from the one mapping', () => {
    expect(launchGrade(1)).toBe('PERFECT');
    expect(launchGrade(0.8)).toBe('STRONG');
    expect(launchGrade(0.6)).toBe('CLEAN');
    expect(launchGrade(0.1)).toBe('WEAK');
    const weak = launchOutcomeFor(0);
    const best = launchOutcomeFor(1);
    expect(best.entrySpeedMps).toBeCloseTo(INTENDED_MAX_SPEED_MPS, 9); // a perfect launch enters at the intended top speed, never above
    expect(weak.entrySpeedMps).toBeLessThan(best.entrySpeedMps);
    expect(weak.flightS).toBeGreaterThan(best.flightS);
    expect(launchOutcomeFor(Number.NaN).quality).toBe(0);
    expect(launchOutcomeFor(7).quality).toBe(1);
  });
});

describe('geometry', () => {
  it('stands a launcher on each side of the arena on the real floor, facing the centre', () => {
    const first = launcherBase('first', ARENA);
    const second = launcherBase('second', ARENA);
    expect(first.z).toBeLessThan(0);
    expect(second.z).toBeGreaterThan(0);
    expect(Math.abs(first.z)).toBeCloseTo(ARENA.floorRadiusM * LAUNCH_TUNING.launcherRadiusShare, 9);
    expect(first.y).toBeGreaterThan(0); // on the funnel's slope, above the middle of the floor
    expect(launcherForward('first').z).toBe(1);
    expect(launcherForward('second').z).toBe(-1);
    // Right is the clockwise quarter turn of forward, as on a screen.
    expect(launcherRight('first')).toEqual({ x: -1, z: 0 });
    expect(launcherRight('second')).toEqual({ x: 1, z: 0 });
  });

  it('holds the Bey in the socket above its launcher, turned toward the entry point', () => {
    const a = socketPosition('first', ARENA, { x: 0, z: 0 });
    const b = socketPosition('first', ARENA, { x: 20, z: 0 });
    const base = launcherBase('first', ARENA);
    expect(a.y).toBeCloseTo(base.y + LAUNCH_TUNING.socketLocalM.y, 9);
    expect(Math.hypot(a.x - base.x, a.z - base.z)).toBeCloseTo(Math.abs(LAUNCH_TUNING.socketLocalM.z), 9);
    expect(b.x).not.toBeCloseTo(a.x, 3); // the launcher follows the point it aims at
  });

  it('clamps an entry point into the valid area and falls back to the default for nonsense', () => {
    const max = ARENA.floorRadiusM * LAUNCH_TUNING.targetMaxRadiusShare;
    const far = clampLaunchTarget({ x: 1000, z: -1000 }, ARENA, 'first');
    expect(Math.hypot(far.x, far.z)).toBeCloseTo(max, 9);
    expect(far.x).toBeGreaterThan(0);
    expect(clampLaunchTarget({ x: 3, z: 4 }, ARENA, 'first')).toEqual({ x: 3, z: 4 });
    expect(clampLaunchTarget({ x: Number.NaN, z: 1 }, ARENA, 'first')).toEqual(defaultLaunchTarget('first', ARENA));
    expect(defaultLaunchTarget('first', ARENA).z).toBeLessThan(0); // on its own half
    expect(defaultLaunchTarget('second', ARENA).z).toBeGreaterThan(0);
  });

  it('never lets two landings fall on the same spot, and keeps the moved one inside the area', () => {
    const min = 4;
    const apart = separateTargets({ x: 0, z: 0 }, { x: 10, z: 0 }, min, ARENA, 'second');
    expect(apart).toEqual({ x: 10, z: 0 });
    const onTop = separateTargets({ x: 5, z: 5 }, { x: 5, z: 5 }, min, ARENA, 'second');
    expect(Math.hypot(onTop.x - 5, onTop.z - 5)).toBeGreaterThanOrEqual(min - 1e-6);
    const edge = ARENA.floorRadiusM * LAUNCH_TUNING.targetMaxRadiusShare;
    const nearEdge = separateTargets({ x: edge - 0.5, z: 0 }, { x: edge - 0.4, z: 0 }, min, ARENA, 'second');
    expect(Math.hypot(nearEdge.x, nearEdge.z)).toBeLessThanOrEqual(edge + 1e-6);
    expect(Math.hypot(nearEdge.x - (edge - 0.5), nearEdge.z)).toBeGreaterThanOrEqual(min - 1e-6);
  });

  it('flies from the socket to the landing along a smooth arc that starts and ends on the ground line', () => {
    const start = { x: 0, y: 6, z: -30 };
    const end = { x: 4, y: 1, z: -8 };
    const plan = flightPlan('first', start, end, 1);
    expect(flightPose(plan, 0).position).toEqual(start);
    const landed = flightPose(plan, plan.durationS).position;
    expect(landed.x).toBeCloseTo(end.x, 9);
    expect(landed.y).toBeCloseTo(end.y, 9);
    expect(landed.z).toBeCloseTo(end.z, 9);
    const mid = flightPose(plan, plan.durationS / 2).position;
    expect(mid.y).toBeGreaterThan((start.y + end.y) / 2 + plan.arcM * 0.9); // the arc peaks over the line
    expect(flightPose(plan, plan.durationS * 10).progress).toBe(1);
    expect(flightPose(plan, -1).progress).toBe(0);
  });
});

describe('result and arrival', () => {
  const result: LaunchResult = { first: { target: { x: 4, z: -10 }, quality: 0.9 }, second: { target: { x: -4, z: 10 }, quality: 0.4 } };

  it('arrives exactly on the floor at the chosen point, rolling toward the centre at the grade-given speed', () => {
    const arrivals = launchArrivals(result, ARENA, SHAPES);
    for (const side of ['first', 'second'] as const) {
      const a = arrivals[side];
      expect(a.position.y).toBeGreaterThan(SHAPE.colliderHalfHeightM); // the funnel is higher than the centre there
      const horizontal = Math.hypot(a.velocity.x, a.velocity.z);
      expect(horizontal).toBeCloseTo(launchOutcomeFor(result[side].quality).entrySpeedMps, 9);
      // toward the centre: the velocity points against the position
      expect(a.velocity.x * a.position.x + a.velocity.z * a.position.z).toBeLessThan(0);
      expect(a.velocity.y).toBeCloseTo(LAUNCH_TUNING.arrivalBounceMps, 9); // the first contact is a small bounce
      expect(Math.sin(a.headingRad) * horizontal).toBeCloseTo(a.velocity.x, 6);
    }
    expect(arrivals.first.outcome.entrySpeedMps).toBeGreaterThan(arrivals.second.outcome.entrySpeedMps);
  });

  it('is a pure function of the result: the same result gives the same arrival, and a replay can rebuild it', () => {
    const again = launchArrivals(JSON.parse(JSON.stringify(result)) as LaunchResult, ARENA, SHAPES);
    expect(again).toEqual(launchArrivals(result, ARENA, SHAPES));
  });

  it('rejects an impossible target instead of landing outside the arena, and separates two on the same point', () => {
    const wild: LaunchResult = { first: { target: { x: 500, z: 500 }, quality: 1 }, second: { target: { x: 500, z: 500 }, quality: 1 } };
    const targets = validTargets(wild, ARENA, SHAPES);
    const max = ARENA.floorRadiusM * LAUNCH_TUNING.targetMaxRadiusShare;
    expect(Math.hypot(targets.first.x, targets.first.z)).toBeLessThanOrEqual(max + 1e-6);
    expect(Math.hypot(targets.second.x, targets.second.z)).toBeLessThanOrEqual(max + 1e-6);
    expect(Math.hypot(targets.first.x - targets.second.x, targets.first.z - targets.second.z)).toBeGreaterThan(2 * SHAPE.colliderRadiusM);
  });

  it('lands in the centre without a direction by leaving along its launcher axis', () => {
    const centre: LaunchResult = { first: { target: { x: 0, z: 0 }, quality: 1 }, second: { target: { x: 0, z: 30 }, quality: 1 } };
    const a = launchArrivals(centre, ARENA, SHAPES).first;
    expect(Math.hypot(a.velocity.x, a.velocity.z)).toBeGreaterThan(0);
    expect(a.velocity.z).toBeGreaterThan(0); // first's launcher is at −z, so it rolls toward +z
  });

  it('parses what a replay holds and refuses everything else', () => {
    expect(parseLaunchResult(JSON.parse(JSON.stringify(result)))).toEqual(result);
    expect(parseLaunchResult(null)).toBeNull();
    expect(parseLaunchResult({ first: result.first })).toBeNull();
    expect(parseLaunchResult({ first: { target: { x: 1, z: Number.NaN }, quality: 0.5 }, second: result.second })).toBeNull();
    expect(parseLaunchResult({ ...result, first: { ...result.first, quality: 9 } })?.first.quality).toBe(1);
  });
});

describe('the sequence', () => {
  it('starts mounted, arms after the intro and does not release until a person presses', () => {
    const seq = sequence();
    expect(seq.currentPhase).toBe('mounted');
    expect(seq.getPose('first').state).toBe('mounted');
    const introTicks = Math.ceil(LAUNCH_TUNING.introHoldS / TICK);
    for (let i = 0; i < introTicks - 1; i++) seq.step();
    expect(seq.currentPhase).toBe('mounted');
    seq.step();
    expect(seq.currentPhase).toBe('armed');
    for (let i = 0; i < 120; i++) seq.step();
    expect(seq.currentPhase).toBe('armed'); // waits as long as it takes (within the timeout)
    expect(seq.getView().waitingForPerson).toBe(true);
    expect(seq.done).toBe(false);
  });

  it('presses once: the launchers release at once and both Beys travel, then it is done on the tick the last one lands', () => {
    const seq = sequence();
    runToArmed(seq);
    const events = seq.step({ first: { aim: { x: 0, y: 0 }, press: true } });
    expect(events.released).toBe(true);
    expect(seq.currentPhase).toBe('release');
    let landedOrder: string[] = [];
    let sawFlying = { first: false, second: false };
    let guard = 0;
    while (!seq.done && guard++ < 600) {
      const e = seq.step();
      landedOrder = landedOrder.concat(e.landed);
      for (const side of ['first', 'second'] as const) if (seq.getPose(side).state === 'flying') sawFlying[side] = true;
    }
    expect(seq.done).toBe(true);
    expect(sawFlying).toEqual({ first: true, second: true }); // both really travel: no teleport, no Bey already waiting in the arena
    expect(landedOrder.sort()).toEqual(['first', 'second']);
    expect(seq.getPose('first').state).toBe('landed');
    expect(seq.getPose('second').state).toBe('landed');
    // No tick after landing: stepping a finished sequence changes nothing and reports nothing.
    const ticks = seq.ticks;
    expect(seq.step()).toEqual({ released: false, landed: [] });
    expect(seq.ticks).toBe(ticks);
    // The whole travel is under two seconds: the arrival is one continuous event with the combat that follows.
    expect((seq.ticks - Math.ceil(LAUNCH_TUNING.introHoldS / TICK)) * TICK).toBeLessThan(LAUNCH_TUNING.introHoldS + 2);
  });

  it('the person who presses a second time changes nothing, and a press before the marker starts is ignored', () => {
    const seq = sequence();
    seq.step({ first: { aim: { x: 0, y: 0 }, press: true } }); // still mounted
    expect(seq.currentPhase).toBe('mounted');
    runToArmed(seq);
    for (let i = 0; i < 30; i++) seq.step();
    seq.step({ first: { aim: { x: 0, y: 0 }, press: true } });
    const first = seq.getResult()!.first.quality;
    seq.step({ first: { aim: { x: 0, y: 0 }, press: true } });
    expect(seq.getResult()!.first.quality).toBe(first);
  });

  it('the quality of a press is the marker as the player saw it: the sweet spot scores 1, the edge 0', () => {
    const at = (targetMarker: number): number => {
      const seq = sequence();
      runToArmed(seq);
      for (let i = 0; i < 6000; i++) {
        const marker = seq.getView().marker;
        if (Math.abs(marker - targetMarker) < 0.004 && seq.getView().armedS > 0.2) {
          seq.step({ first: { aim: { x: 0, y: 0 }, press: true } });
          return seq.getResult()!.first.quality;
        }
        seq.step();
      }
      throw new Error('marker never reached');
    };
    expect(at(LAUNCH_TUNING.markerSweetSpot)).toBeGreaterThan(0.98);
    expect(at(0.05)).toBe(0);
  });

  it('moves the entry point with the aim input, inside the valid area, and the launcher turns with it', () => {
    const seq = sequence();
    runToArmed(seq);
    const before = { ...seq.getTarget('first') };
    const poseBefore = seq.getPose('first').position;
    for (let i = 0; i < 40; i++) seq.step({ first: { aim: { x: 1, y: 0 }, press: false } });
    const after = seq.getTarget('first');
    expect(after.x).toBeLessThan(before.x); // screen-right of the first launcher is −x
    for (let i = 0; i < 40; i++) seq.step({ first: { aim: { x: 0, y: 1 }, press: false } });
    expect(seq.getTarget('first').z).toBeGreaterThan(after.z); // up = toward the centre
    for (let i = 0; i < 400; i++) seq.step({ first: { aim: { x: 1, y: 1 }, press: false } });
    const t = seq.getTarget('first');
    expect(Math.hypot(t.x, t.z)).toBeLessThanOrEqual(ARENA.floorRadiusM * LAUNCH_TUNING.targetMaxRadiusShare + 1e-6);
    expect(seq.getPose('first').position).not.toEqual(poseBefore);
    expect(seq.currentPhase).toBe('armed'); // aiming never releases
    // A plan-driven side's point is not the person's to move.
    expect(seq.getTarget('second')).toEqual(clampLaunchTarget({ x: -3, z: 9 }, ARENA, 'second'));
  });

  it('setTarget (a click on the arena) obeys the same limits and only before the release', () => {
    const seq = sequence();
    runToArmed(seq);
    seq.setTarget('first', { x: 9999, z: 0 });
    expect(Math.hypot(seq.getTarget('first').x, seq.getTarget('first').z)).toBeLessThanOrEqual(ARENA.floorRadiusM * LAUNCH_TUNING.targetMaxRadiusShare + 1e-6);
    seq.setTarget('second', { x: 0, z: 0 }); // not a person's side
    expect(seq.getTarget('second')).not.toEqual({ x: 0, z: 0 });
    seq.press('first');
    seq.step();
    const locked = { ...seq.getTarget('first') };
    seq.setTarget('first', { x: 1, z: -1 });
    expect(seq.getTarget('first')).toEqual(locked);
  });

  it('releases by itself when nobody drives it, and when a person lets the window run out (no free perfect launch)', () => {
    const auto = sequence({ kind: 'plan', target: { x: 2, z: -9 }, quality: 0.7 });
    let ticks = 0;
    while (!auto.done && ticks++ < 1000) auto.step();
    expect(auto.done).toBe(true);
    expect(auto.getResult()!.first.quality).toBeCloseTo(0.7, 9);

    const idle = sequence();
    let n = 0;
    while (!idle.done && n++ < 2000) idle.step();
    expect(idle.done).toBe(true);
    expect(n * TICK).toBeGreaterThan(LAUNCH_TUNING.armedTimeoutS);
    expect(idle.getResult()!.first.quality).toBeLessThan(1);
  });

  it('is deterministic: the same inputs give the same result and the same poses every tick', () => {
    const play = (): { result: LaunchResult; poses: string[] } => {
      const seq = sequence();
      const poses: string[] = [];
      runToArmed(seq);
      for (let i = 0; i < 90; i++) seq.step({ first: { aim: { x: i % 7 < 3 ? 1 : -0.5, y: 0.25 }, press: false } });
      seq.step({ first: { aim: { x: 0, y: 0 }, press: true } });
      while (!seq.done) {
        seq.step();
        poses.push(JSON.stringify([seq.getPose('first'), seq.getPose('second')]));
      }
      return { result: seq.getResult()!, poses };
    };
    expect(play()).toEqual(play());
  });

  it('the result it hands over rebuilds the same arrival as the flight ended on', () => {
    const seq = sequence();
    runToArmed(seq);
    for (let i = 0; i < 20; i++) seq.step({ first: { aim: { x: 0.5, y: 0.5 }, press: false } });
    seq.step({ first: { aim: { x: 0, y: 0 }, press: true } });
    while (!seq.done) seq.step();
    const arrivals = launchArrivals(seq.getResult()!, ARENA, SHAPES);
    for (const side of ['first', 'second'] as const) {
      const pose = seq.getPose(side).position;
      expect(pose.x).toBeCloseTo(arrivals[side].position.x, 9);
      expect(pose.y).toBeCloseTo(arrivals[side].position.y, 9);
      expect(pose.z).toBeCloseTo(arrivals[side].position.z, 9);
    }
  });

  it('has no countdown or post-landing phase at all', () => {
    const seq = sequence();
    const phases = new Set<string>();
    runToArmed(seq);
    seq.step({ first: { aim: { x: 0, y: 0 }, press: true } });
    while (!seq.done) {
      phases.add(seq.currentPhase);
      seq.step();
    }
    phases.add(seq.currentPhase);
    expect([...phases].sort()).toEqual(['flight', 'landed', 'release']);
  });
});

describe('the AI launch policy', () => {
  const plan = (seed: string, personality = ATTACK_AI_PERSONALITY, tier = ACE_TIER) => planAiLaunch('second', ARENA, SeededRng.fromSeedText(seed), personality, tier.profile);

  it('is deterministic per seed and draws the same number of values whatever it decides', () => {
    expect(plan('a')).toEqual(plan('a'));
    expect(plan('a')).not.toEqual(plan('b'));
    const rng = SeededRng.fromSeedText('x');
    planAiLaunch('second', ARENA, rng, ATTACK_AI_PERSONALITY, ACE_TIER.profile);
    const after1 = rng.getState();
    const rng2 = SeededRng.fromSeedText('x');
    planAiLaunch('second', ARENA, rng2, DEFENSE_AI_PERSONALITY, ROOKIE_TIER.profile);
    expect(rng2.getState()).toBe(after1);
  });

  it('always picks a valid point on its own half, and an aggressive personality goes nearer the centre', () => {
    let attackR = 0;
    let defenseR = 0;
    for (let i = 0; i < 60; i++) {
      const a = plan(`s${i}`, ATTACK_AI_PERSONALITY);
      const d = plan(`s${i}`, DEFENSE_AI_PERSONALITY);
      for (const p of [a, d]) {
        expect(Math.hypot(p.target.x, p.target.z)).toBeLessThanOrEqual(ARENA.floorRadiusM * LAUNCH_TUNING.targetMaxRadiusShare + 1e-6);
        expect(p.target.z).toBeGreaterThan(0); // `second` launches from +z
        expect(p.quality).toBeGreaterThanOrEqual(0);
        expect(p.quality).toBeLessThanOrEqual(1);
      }
      attackR += Math.hypot(a.target.x, a.target.z);
      defenseR += Math.hypot(d.target.x, d.target.z);
    }
    expect(attackR).toBeLessThan(defenseR);
  });

  it('varies a lot from round to round: targets spread over the half, qualities over the whole range, and the release lags', () => {
    const plans = Array.from({ length: 200 }, (_, i) => plan(`v${i}`, ATTACK_AI_PERSONALITY, ACE_TIER));
    const xs = plans.map((p) => p.target.x);
    const radii = plans.map((p) => Math.hypot(p.target.x, p.target.z));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(ARENA.floorRadiusM * 0.6); // well out to both sides
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(ARENA.floorRadiusM * 0.3); // close and far
    expect(plans.some((p) => p.quality < 0.5)).toBe(true); // a weak launch happens even for an Ace
    expect(plans.some((p) => p.quality >= 0.93)).toBe(true);
    const lags = plans.map((p) => p.releaseLagS);
    expect(Math.min(...lags)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...lags)).toBeGreaterThan(0.15);
    expect(Math.max(...lags)).toBeLessThanOrEqual(0.3);
  });

  it('a Rookie times its release worse than an Ace on average, and nobody is perfect every time', () => {
    let rookie = 0;
    let ace = 0;
    let perfect = 0;
    const n = 200;
    for (let i = 0; i < n; i++) {
      rookie += plan(`q${i}`, ATTACK_AI_PERSONALITY, ROOKIE_TIER).quality;
      const q = plan(`q${i}`, ATTACK_AI_PERSONALITY, ACE_TIER).quality;
      ace += q;
      if (q > 0.99) perfect++;
    }
    expect(ace / n).toBeGreaterThan(rookie / n);
    expect(perfect).toBeLessThan(n);
    expect(ace / n).toBeGreaterThan(0.6);
  });
});
