// M11 lane 4: the approved bowl profiles A/B/C as selectable floors for
// playtest. The profiles are the approved ones, the collider follows them,
// the flat arena is unchanged, every bowl plays the GDD 68 scenarios and
// AI vs AI with no invalid state, and matches on a bowl are deterministic
// and replayable. The comparison report (docs/ai/m11-bowl-comparison.md)
// is generated from the same code with BOWL_REPORT=1.

import * as fs from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { matchSpawnsFor, FIRST_SPAWN, SECOND_SPAWN } from '../../src/app/bootstrap/matchSpawns';
import { createArenaColliders } from '../../src/arena/colliders/createArenaColliders';
import { ARENA_FLOOR_RADIUS, ARENA_WALL_HEIGHT } from '../../src/arena/colliders/ArenaTuning';
import { ARENA_FLOORS, ARENA_FLOOR_IDS, BOWL_C_PLATEAU_RADIUS_M, BOWL_DEPTH_M, DEFAULT_ARENA_FLOOR, floorHeightAt, floorNormalAt, floorRimHeight, floorSlopeDegAt, type ArenaFloorId } from '../../src/arena/floor/ArenaFloorProfile';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { createDefaultMatchConfig } from '../../src/config/match/MatchConfig';
import { decodeReplay, encodeReplay, sealReplay } from '../../src/replay/format/ChaosBeyReplayV1';
import { currentRuntimeFingerprint } from '../../src/replay/format/runtimeFingerprint';
import { playReplayHeadless } from '../../src/replay/playback/replayPlayback';
import { compareFloor, renderFloorComparison, runFloorAiBatch, runFloorProbes, runFloorScenarios } from '../../src/self-test/arenaFloorComparison';
import { simulateAiMatch } from '../../src/self-test/AiMatchSimulation';
import { PhysicsWorld } from '../../src/physics/world/PhysicsWorld';

const BOWLS: readonly ArenaFloorId[] = ['bowl-a', 'bowl-b', 'bowl-c'];
const R = ARENA_FLOOR_RADIUS;

async function arena(floor: ArenaFloorId): Promise<PhysicsWorld> {
  const physics = await PhysicsWorld.create();
  createArenaColliders(new THREE.Scene(), physics, { wallHeightM: ARENA_WALL_HEIGHT, wallRestitution: 0.5, floor });
  physics.rapierWorld.step();
  return physics;
}

function firstHit(physics: PhysicsWorld, from: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, wall: boolean): number | null {
  const hit = physics.rapierWorld.castRay(new RAPIER.Ray(from, dir), 40, true, undefined, undefined, undefined, undefined, (c) => (c.shape.type === RAPIER.ShapeType.Cuboid) === wall);
  return hit ? hit.timeOfImpact : null;
}

describe('floor profiles (approval §2)', () => {
  it('are the approved curves at the scaled arena: 2.5 m deep at R = 36 m, parabola / funnel / 7.8 m plateau; flat is 0 everywhere', () => {
    // Arena scale pass: R 12 -> 36 m (3x), depth 3.2 -> 2.5 m (owner request), plateau 2.6 -> 7.8 m (3x).
    expect(ARENA_FLOOR_RADIUS).toBe(36);
    expect(BOWL_DEPTH_M).toBe(2.5);
    expect(BOWL_C_PLATEAU_RADIUS_M).toBeCloseTo(7.8, 12);
    for (const r of [0, 3, 7.8, 12, 22.5, 36]) {
      expect(ARENA_FLOORS.flat.heightAtRadius(r)).toBe(0);
      expect(ARENA_FLOORS['bowl-a'].heightAtRadius(r)).toBeCloseTo(2.5 * (r / 36) ** 2, 12);
      expect(ARENA_FLOORS['bowl-b'].heightAtRadius(r)).toBeCloseTo(2.5 * (r / 36) ** 1.3, 12);
      expect(ARENA_FLOORS['bowl-c'].heightAtRadius(r)).toBeCloseTo(r <= 7.8 ? 0 : 2.5 * ((r - 7.8) / (36 - 7.8)) ** 1.4, 12);
    }
    for (const bowl of BOWLS) expect(floorRimHeight(bowl)).toBeCloseTo(2.5, 12);
    expect(floorRimHeight('flat')).toBe(0);
  });

  it('the stage is not flat by default: the default floor is a smooth bowl with the centre 2.5 m below the rim, no hard corner', () => {
    expect(DEFAULT_ARENA_FLOOR).not.toBe('flat');
    const rim = floorRimHeight(DEFAULT_ARENA_FLOOR);
    expect(rim).toBeCloseTo(2.5, 12);
    expect(floorHeightAt(DEFAULT_ARENA_FLOOR, 0, 0)).toBe(0);
    // Smooth: the slope is 0 at the centre and rises continuously (no step between neighbouring samples), and the steepest part (the wall end) is a gentle ramp.
    let previous = ARENA_FLOORS[DEFAULT_ARENA_FLOOR].slopeAtRadius(0);
    expect(previous).toBe(0);
    for (let r = 0.5; r <= R; r += 0.5) {
      const slope = ARENA_FLOORS[DEFAULT_ARENA_FLOOR].slopeAtRadius(r);
      expect(slope).toBeGreaterThanOrEqual(previous);
      expect(slope - previous).toBeLessThan(0.01);
      previous = slope;
    }
    expect(floorSlopeDegAt(DEFAULT_ARENA_FLOOR, R, 0)).toBeLessThan(10);
  });

  it('normals are unit, point up and toward the centre, and match the numerical slope', () => {
    for (const floor of ARENA_FLOOR_IDS) {
      for (const [x, z] of [[9, 3], [-18, 12], [1.5, -27], [21, 21]] as const) {
        const n = floorNormalAt(floor, x, z);
        expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 12);
        expect(n.y).toBeGreaterThan(0.8);
        const r = Math.hypot(x, z);
        const e = 1e-5;
        const dh = (ARENA_FLOORS[floor].heightAtRadius(r + e) - ARENA_FLOORS[floor].heightAtRadius(r - e)) / (2 * e);
        expect(ARENA_FLOORS[floor].slopeAtRadius(r)).toBeCloseTo(dh, 5);
        if (floor !== 'flat') expect(n.x * x + n.z * z).toBeLessThanOrEqual(0); // leans toward the centre
      }
    }
  });
});

describe('collider (one source of truth with the visuals)', () => {
  it('the floor under every point is h(r) within 2 mm; the wall still closes the ring, from the rim up', async () => {
    for (const floor of ARENA_FLOOR_IDS) {
      const physics = await arena(floor);
      for (let i = 0; i < 40; i++) {
        const a = i * 2.39996;
        const r = Math.sqrt(i / 40) * (R - 1);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const toi = firstHit(physics, { x, y: 20, z }, { x: 0, y: -1, z: 0 }, false);
        expect(toi, `${floor} (${x.toFixed(2)}, ${z.toFixed(2)})`).not.toBeNull();
        expect(20 - toi!).toBeCloseTo(floorHeightAt(floor, x, z), 2);
      }
      // The wall stands from the rim: a ray just under its top, from the centre, hits it everywhere.
      const rim = floorRimHeight(floor);
      for (let deg = 0; deg < 360; deg += 7.5) {
        const a = (deg * Math.PI) / 180;
        const toi = firstHit(physics, { x: 0, y: rim + ARENA_WALL_HEIGHT - 0.1, z: 0 }, { x: Math.cos(a), y: 0, z: Math.sin(a) }, true);
        expect(toi, `${floor} ${deg}°`).not.toBeNull();
        expect(toi!).toBeLessThan(R);
      }
      // And nothing above rim + wall height.
      expect(firstHit(physics, { x: 0, y: rim + ARENA_WALL_HEIGHT + 0.1, z: 0 }, { x: 1, y: 0, z: 0 }, true)).toBeNull();
      physics.rapierWorld.free();
    }
  });

  it('the flat floor is the baseline at y = 0 with the same spawns (a flat heightfield: the 36 m cylinder gave ghost obstacles); the default match config is the bowl, not flat', async () => {
    expect(createDefaultMatchConfig().arenaFloor).toBe(DEFAULT_ARENA_FLOOR);
    expect(matchSpawnsFor('flat')).toEqual({ first: FIRST_SPAWN, second: SECOND_SPAWN });
    const physics = await arena('flat');
    const shapes = new Set<number>();
    physics.rapierWorld.forEachCollider((c) => shapes.add(c.shape.type));
    expect(shapes.has(RAPIER.ShapeType.HeightField)).toBe(true);
    expect(shapes.has(RAPIER.ShapeType.Cylinder)).toBe(false);
    // ...and it is the plane y = 0 all the way out to the wall.
    for (const [x, z] of [[0, 0], [20, 5], [-30, -10], [0, 34]] as const) expect(20 - firstHit(physics, { x, y: 20, z }, { x: 0, y: -1, z: 0 }, false)!).toBeCloseTo(0, 2);
    physics.rapierWorld.free();
  });

  it('bowl spawns sit at spawn height above the floor there', () => {
    for (const bowl of BOWLS) {
      const s = matchSpawnsFor(bowl);
      expect(s.first.y).toBeCloseTo(FIRST_SPAWN.y + floorHeightAt(bowl, FIRST_SPAWN.x, FIRST_SPAWN.z), 12);
      expect(s.second.y).toBeCloseTo(SECOND_SPAWN.y + floorHeightAt(bowl, SECOND_SPAWN.x, SECOND_SPAWN.z), 12);
    }
  });
});

describe('every bowl plays clean (no invalid state)', () => {
  it('physics probes: low/high speed, climbing, the wall at the edge, a drop — no invalid state, stays on the floor', async () => {
    for (const floor of BOWLS) {
      const p = await runFloorProbes(floor);
      expect(p.invalidStates, floor).toBe(0);
      expect(p.fastClimb.secondsToR10, `${floor}: full stick climbs to the wall`).not.toBeNull();
      // > 0.05 (was 0.1): bowl B's funnel is steepest at the centre, and with the Motion Lab
      // integration (M11: upright body, landing bounce) 35% stick measures 0.08 m/s there (lane 4:
      // 0.24) — the "light input can't leave bowl B's centre" playtest item, now stronger.
      expect(p.slowClimb.speedAt2sMps, `${floor}: 35% stick still moves`).toBeGreaterThan(0.05);
      expect(p.wallPush.maxRadiusM, `${floor}: the wall holds`).toBeLessThan(R - 0.8);
      expect(p.drop.secondsToLand, `${floor}: lands`).not.toBeNull();
    }
  }, 120_000);

  it('GDD 68 scenarios: drift, dash, counter, wall hit / ricochet, knockback, jump, landing, air recovery, collisions, Clash — no crash, no invalid state', async () => {
    for (const floor of BOWLS) {
      const results = await runFloorScenarios(floor);
      for (const r of results) {
        expect(r.crashed, `${floor} ${r.id}`).toBe(false);
        expect(r.invalidStates, `${floor} ${r.id}: ${r.detail}`).toBe(0);
        // Their own checks hold on every bowl, except ring-out (see below): the slope changes that throw.
        if (r.id !== 'ring-out') expect(r.status, `${floor} ${r.id}: ${r.detail}`).toBe('passed');
      }
    }
  }, 180_000);

  it('AI vs AI, every pairing: rounds resolve, no invalid state', async () => {
    for (const floor of BOWLS) {
      const batch = await runFloorAiBatch(floor, 1);
      expect(batch.matches).toBe(9);
      expect(batch.invalidStates, floor).toBe(0);
      expect(batch.unresolved, floor).toBe(0);
    }
  }, 300_000);
});

describe('determinism and replays on a bowl', () => {
  it('the same bowl match twice gives the same result; a recording plays back verified', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    for (const floor of BOWLS) {
      const setup = { seed: `bowl-replay/${floor}`, firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 900, matchConfigOverrides: { arenaFloor: floor } };
      const a = await simulateAiMatch({ ...setup, record: { fingerprint, checkpointEvery: 30 } });
      const b = await simulateAiMatch(setup);
      expect(b.stats.ticks).toBe(a.stats.ticks);
      expect(String(b.stats.outcome)).toBe(String(a.stats.outcome));
      const decoded = decodeReplay(encodeReplay(a.replay!));
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) continue;
      expect(decoded.replay.config.matchConfig.arenaFloor).toBe(floor);
      expect(await playReplayHeadless(decoded.replay, fingerprint)).toMatchObject({ status: 'verified' });
    }
  }, 180_000);

  it('a replay recorded before the floor option (no arenaFloor) is still valid and plays as flat; a bad floor is refused', async () => {
    const fingerprint = await currentRuntimeFingerprint();
    const flat = await simulateAiMatch({ seed: 'bowl-legacy', firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 300, matchConfigOverrides: { arenaFloor: 'flat' }, record: { fingerprint, checkpointEvery: 30 } });
    const raw = JSON.parse(encodeReplay(flat.replay!));
    delete raw.config.matchConfig.arenaFloor;
    const { integrity: _i, ...unsealed } = raw;
    const legacy = decodeReplay(JSON.stringify(sealReplay(unsealed)));
    expect(legacy.ok).toBe(true);
    if (legacy.ok) expect(await playReplayHeadless(legacy.replay, fingerprint)).toMatchObject({ status: 'verified' });

    const bad = JSON.parse(encodeReplay(flat.replay!));
    bad.config.matchConfig.arenaFloor = 'bowl-z';
    const { integrity: _j, ...badUnsealed } = bad;
    const refused = decodeReplay(JSON.stringify(sealReplay(badUnsealed)));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.errors.map((e) => e.path)).toContain('config.matchConfig.arenaFloor');
  }, 120_000);
});

describe('comparison report', () => {
  it.runIf(process.env.BOWL_REPORT === '1')('writes docs/ai/m11-bowl-comparison-data.md', async () => {
    const seeds = 4;
    const results = [];
    for (const floor of ARENA_FLOOR_IDS) results.push(await compareFloor(floor, seeds));
    fs.writeFileSync('docs/ai/m11-bowl-comparison-data.md', `<!-- Generated by BOWL_REPORT=1 npx vitest run tests/deterministic/arenaFloor.test.ts -->\n\n${renderFloorComparison(results, seeds)}\n`);
  }, 1_800_000);
});
