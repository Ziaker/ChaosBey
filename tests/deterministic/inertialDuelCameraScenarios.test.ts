// ============================================================
// INERTIAL DUEL CAMERA — A–K in-game framing matrix
//
// The historical A–K suite validates the approved base CameraDirector. This
// file runs the same kinds of spatial situations through the actual in-game
// InertialDuelDirector and adds the metrics the redesign exists to improve:
// visibility, yaw velocity, angular acceleration, accumulated yaw travel,
// reversals and hard-frame pressure.
// ============================================================

import { describe, expect, it } from 'vitest';
import { InertialDuelDirector, INERTIAL_DUEL_TUNING } from '../../src/camera/director/InertialDuelDirector';
import { arenaParamsFor, CAMERA_RINGOUT_WATCH_RADIUS_M, rigDirectorOptions } from '../../src/camera/director/CameraRig';
import { PRESET_IDS, type PresetId } from '../../src/camera/director/CameraParams';
import { floorHeightAt } from '../../src/arena/floor/ArenaFloorProfile';
import { inFrame } from '../../src/camera/director/frameMath';
import type { CameraIntent, FightFrame, FighterFrame } from '../../src/camera/director/FightFrame';

const DT = 1 / 60;
const ASPECT = 16 / 9;
const FRAME_MARGIN = 0.02;

interface FighterAt {
  readonly x: number;
  readonly z: number;
  readonly vx?: number;
  readonly vz?: number;
  readonly y?: number;
}

function fighter(f: FighterAt): FighterFrame {
  return {
    position: { x: f.x, y: f.y ?? 0.2, z: f.z },
    velocity: { x: f.vx ?? 0, y: 0, z: f.vz ?? 0 },
    speed: Math.hypot(f.vx ?? 0, f.vz ?? 0),
    airborne: false,
    attack: 'none',
    broken: false,
  };
}

interface ScenarioTick {
  readonly player: FighterAt;
  readonly opponent: FighterAt;
  readonly intents?: readonly CameraIntent[];
}

function buildFrame(tick: number, s: ScenarioTick): FightFrame {
  return {
    tick,
    time: tick * DT,
    first: fighter(s.player),
    second: fighter(s.opponent),
    intents: s.intents ?? [],
    clashActive: false,
    clashProgress: 0,
    roundOver: false,
    ringOutIsFirst: null,
  };
}

interface Metrics {
  readonly playerInFramePct: number;
  readonly opponentInFramePct: number;
  readonly longestOpponentOffscreenS: number;
  readonly maxYawRateDegS: number;
  readonly maxYawAccelDegS2: number;
  readonly totalYawTravelDeg: number;
  readonly yawReversals: number;
  readonly maxHardViolation: number;
  readonly hardViolationPct: number;
  readonly maxFovRateDegS: number;
  readonly pitchMinDeg: number;
  readonly pitchMaxDeg: number;
}

function makeDirector(preset: PresetId, floorAt?: (x: number, z: number) => number): InertialDuelDirector {
  return new InertialDuelDirector(preset, arenaParamsFor(preset), ASPECT, rigDirectorOptions(preset, floorAt), CAMERA_RINGOUT_WATCH_RADIUS_M);
}

function run(
  preset: PresetId,
  build: (t: number) => ScenarioTick,
  ticks: number,
  floorAt?: (x: number, z: number) => number,
  warmupTicks = 0,
): Metrics {
  const d = makeDirector(preset, floorAt);
  for (let t = 0; t < warmupTicks; t++) d.tick(buildFrame(t, build(t)), DT);

  let playerIn = 0;
  let opponentIn = 0;
  let currentOffscreen = 0;
  let longestOffscreen = 0;
  let maxYawRate = 0;
  let maxYawAccel = 0;
  let maxHard = 0;
  let hardTicks = 0;
  let previousFov: number | null = null;
  let maxFovRate = 0;
  let pitchMin = Infinity;
  let pitchMax = -Infinity;
  let finalTravel = 0;
  let reversals = 0;

  for (let n = 0; n < ticks; n++) {
    const t = warmupTicks + n;
    const s = build(t);
    const f = buildFrame(t, s);
    const out = d.tick(f, DT);
    const pIn = inFrame(f.first.position, out.eye, out.focus, out.fov, ASPECT, FRAME_MARGIN);
    const oIn = inFrame(f.second.position, out.eye, out.focus, out.fov, ASPECT, FRAME_MARGIN);
    if (pIn) playerIn++;
    if (oIn) {
      longestOffscreen = Math.max(longestOffscreen, currentOffscreen);
      currentOffscreen = 0;
      opponentIn++;
    } else currentOffscreen++;

    const c = out.debug.composition;
    maxYawRate = Math.max(maxYawRate, Math.abs(c.yawVelocityDegS));
    maxYawAccel = Math.max(maxYawAccel, Math.abs(c.yawAccelerationDegS2));
    maxHard = Math.max(maxHard, c.hardViolation);
    if (c.hardViolation > 0) hardTicks++;
    finalTravel = c.totalYawTravelDeg;
    reversals = c.yawReversals;

    if (previousFov !== null) maxFovRate = Math.max(maxFovRate, Math.abs(out.fov - previousFov) / DT);
    previousFov = out.fov;
    const pitch = (Math.atan2(out.eye.y - out.focus.y, Math.hypot(out.eye.x - out.focus.x, out.eye.z - out.focus.z)) * 180) / Math.PI;
    pitchMin = Math.min(pitchMin, pitch);
    pitchMax = Math.max(pitchMax, pitch);
  }

  longestOffscreen = Math.max(longestOffscreen, currentOffscreen);
  return {
    playerInFramePct: (100 * playerIn) / ticks,
    opponentInFramePct: (100 * opponentIn) / ticks,
    longestOpponentOffscreenS: longestOffscreen * DT,
    maxYawRateDegS: maxYawRate,
    maxYawAccelDegS2: maxYawAccel,
    totalYawTravelDeg: finalTravel,
    yawReversals: reversals,
    maxHardViolation: maxHard,
    hardViolationPct: (100 * hardTicks) / ticks,
    maxFovRateDegS: maxFovRate,
    pitchMinDeg: pitchMin,
    pitchMaxDeg: pitchMax,
  };
}

const orbitAngle = (t: number, ticks: number, turns = 1) => (t / ticks) * Math.PI * 2 * turns;
const ORBIT_R = 6;

const scenarioA = (ticks: number) => (t: number): ScenarioTick => {
  const a = orbitAngle(t, ticks);
  return { player: { x: 0, z: -3 }, opponent: { x: ORBIT_R * Math.cos(a), z: -3 + ORBIT_R * Math.sin(a) } };
};
const scenarioB = (ticks: number) => (t: number): ScenarioTick => {
  const a = orbitAngle(t, ticks);
  return { player: { x: ORBIT_R * Math.cos(a), z: 3 + ORBIT_R * Math.sin(a) }, opponent: { x: 0, z: 3 } };
};
const scenarioC = (ticks: number) => (t: number): ScenarioTick => {
  const a = orbitAngle(t, ticks);
  return { player: { x: 4 * Math.cos(a), z: 4 * Math.sin(a) }, opponent: { x: 4 * Math.cos(-a + Math.PI), z: 4 * Math.sin(-a + Math.PI) } };
};
const scenarioD = (ticks: number) => (t: number): ScenarioTick => {
  const u = t / ticks;
  const x = -8 + 16 * u;
  return { player: { x: 0, z: 0 }, opponent: { x, z: -3, vx: 16 / (ticks * DT) } };
};
const scenarioE = (ticks: number) => (t: number): ScenarioTick => {
  const u = t / ticks;
  const z = -9 + 18 * u;
  return { player: { x: 0.5, z, vz: 18 / (ticks * DT) }, opponent: { x: 0, z: 0 } };
};
const scenarioF = (ticks: number) => (t: number): ScenarioTick => {
  const legs = [2, 6, 12, 18];
  const perLeg = ticks / legs.length;
  const legIndex = Math.min(legs.length - 1, Math.floor(t / perLeg));
  const from = legs[Math.max(0, legIndex - 1)]!;
  const to = legs[legIndex]!;
  const u = legIndex === 0 ? 1 : Math.min(1, (t - legIndex * perLeg) / perLeg);
  const sep = from + (to - from) * u;
  return { player: { x: 0, z: -sep / 2 }, opponent: { x: 0, z: sep / 2 } };
};
const scenarioG = (ticks: number) => (t: number): ScenarioTick => {
  const a = orbitAngle(t, ticks, 2);
  const r = 5;
  const omega = (2 * Math.PI * 2) / (ticks * DT);
  return {
    player: { x: r * Math.cos(a), z: r * Math.sin(a), vx: -r * omega * Math.sin(a), vz: r * omega * Math.cos(a) },
    opponent: { x: 0, z: 0 },
  };
};
const scenarioH = (ticks: number) => (t: number): ScenarioTick => {
  const launchAt = 30;
  const u = Math.max(0, t - launchAt) / (ticks - launchAt);
  const traveled = Math.min(1, u) * 16;
  const player = { x: 0, z: -2 };
  const opponent = { x: 0, z: -2 + traveled, vz: t < launchAt ? 0 : 14 * (1 - u) };
  const intents: CameraIntent[] = t === launchAt ? [{ kind: 'hit', magnitude: 0.9, targetIsFirst: false, position: { x: opponent.x, y: 0.2, z: opponent.z } }] : [];
  return { player, opponent, intents };
};
const scenarioI = (ticks: number) => (t: number): ScenarioTick => {
  const a = orbitAngle(t, ticks);
  return { player: { x: 0, z: -30 }, opponent: { x: 8 * Math.cos(a), z: 8 * Math.sin(a) } };
};
const scenarioJ = (ticks: number) => (t: number): ScenarioTick => {
  const a = orbitAngle(t, ticks);
  return { player: { x: 8 * Math.cos(a), z: 8 * Math.sin(a) }, opponent: { x: 0, z: 30 } };
};

const SCENARIOS = {
  A: { label: 'opponent circles stationary player', ticks: 360, build: scenarioA },
  B: { label: 'player circles stationary opponent', ticks: 360, build: scenarioB },
  C: { label: 'both orbit in opposite directions', ticks: 360, build: scenarioC },
  D: { label: 'opponent lateral crossing', ticks: 90, build: scenarioD },
  E: { label: 'player dash-speed pass-through', ticks: 90, build: scenarioE },
  F: { label: 'separation sweep 2→18 m', ticks: 480, build: scenarioF },
  G: { label: 'high-speed orbit', ticks: 300, build: scenarioG },
  H: { label: 'strong knockback launch', ticks: 180, build: scenarioH },
  I: { label: 'player near 36 m arena rim', ticks: 360, build: scenarioI },
  J: { label: 'opponent near 36 m arena rim', ticks: 360, build: scenarioJ },
} as const;

function expectMechanicalBounds(preset: PresetId, m: Metrics): void {
  const tuning = INERTIAL_DUEL_TUNING[preset];
  expect(m.maxYawRateDegS, `${preset}: yaw-rate cap`).toBeLessThanOrEqual(tuning.maxYawRateDegS + 1e-6);
  expect(m.maxYawAccelDegS2, `${preset}: angular-acceleration cap`).toBeLessThanOrEqual(tuning.maxYawAccelDegS2 + 1e-5);
  expect(m.pitchMinDeg, `${preset}: pitch floor`).toBeGreaterThan(0);
  expect(m.pitchMaxDeg, `${preset}: pitch ceiling`).toBeLessThan(60);
  expect(m.yawReversals, `${preset}: no oscillatory camera ping-pong`).toBeLessThanOrEqual(4);
}

function expectOrdinaryVisibility(label: string, m: Metrics): void {
  expect(m.opponentInFramePct, `${label}: opponent visibility`).toBeGreaterThanOrEqual(97);
  expect(m.playerInFramePct, `${label}: player visibility`).toBeGreaterThanOrEqual(94);
  expect(m.longestOpponentOffscreenS, `${label}: longest opponent offscreen`).toBeLessThan(0.35);
}

describe('Inertial Duel Camera — A–J composition matrix', () => {
  for (const key of ['A', 'B', 'C', 'F', 'G', 'I', 'J'] as const) {
    const spec = SCENARIOS[key];
    it(`${key}. ${spec.label}: readable, bounded and spatially stable for every preset`, () => {
      for (const preset of PRESET_IDS) {
        const m = run(preset, spec.build(spec.ticks), spec.ticks, undefined, key === 'I' || key === 'J' ? 60 : 0);
        expectOrdinaryVisibility(`${preset} ${key}`, m);
        expectMechanicalBounds(preset, m);
        expect(m.totalYawTravelDeg, `${preset} ${key}: no unnecessary world spin`).toBeLessThan(240);
        expect(m.hardViolationPct, `${preset} ${key}: hard-frame pressure is exceptional`).toBeLessThan(20);
      }
    });
  }

  for (const key of ['D', 'E'] as const) {
    const spec = SCENARIOS[key];
    it(`${key}. ${spec.label}: crossing swaps screen sides without a camera half-turn`, () => {
      for (const preset of PRESET_IDS) {
        const m = run(preset, spec.build(spec.ticks), spec.ticks);
        expect(m.opponentInFramePct, `${preset}: opponent`).toBeGreaterThanOrEqual(95);
        expect(m.longestOpponentOffscreenS, `${preset}: gap`).toBeLessThan(0.3);
        expectMechanicalBounds(preset, m);
        expect(m.totalYawTravelDeg, `${preset}: crossing yaw travel`).toBeLessThan(60);
        expect(m.yawReversals, `${preset}: crossing reversals`).toBeLessThanOrEqual(1);
      }
    });
  }

  it('H. knockback follow stays dramatic but recovers without an orbit chase', () => {
    const spec = SCENARIOS.H;
    for (const preset of PRESET_IDS) {
      const m = run(preset, spec.build(spec.ticks), spec.ticks);
      expect(m.opponentInFramePct, `${preset}: launched target visibility`).toBeGreaterThanOrEqual(90);
      expect(m.longestOpponentOffscreenS, `${preset}: launched target gap`).toBeLessThan(0.5);
      expectMechanicalBounds(preset, m);
      expect(m.totalYawTravelDeg, `${preset}: knockback should not induce a full orbit`).toBeLessThan(120);
    }
  });
});

describe('Inertial Duel Camera — K: Flat + Bowl A/B/C', () => {
  it('opponent-circles composition remains readable and bounded on every floor', () => {
    const spec = SCENARIOS.A;
    for (const floor of [undefined, 'bowl-a', 'bowl-b', 'bowl-c'] as const) {
      const floorAt = floor ? (x: number, z: number) => floorHeightAt(floor, x, z) : undefined;
      for (const preset of PRESET_IDS) {
        const base = spec.build(spec.ticks);
        const build = (t: number): ScenarioTick => {
          const s = base(t);
          if (!floorAt) return s;
          return {
            player: { ...s.player, y: floorAt(s.player.x, s.player.z) + 0.2 },
            opponent: { ...s.opponent, y: floorAt(s.opponent.x, s.opponent.z) + 0.2 },
            intents: s.intents,
          };
        };
        const m = run(preset, build, spec.ticks, floorAt);
        expectOrdinaryVisibility(`${preset} ${floor ?? 'flat'}`, m);
        expectMechanicalBounds(preset, m);
        expect(m.totalYawTravelDeg, `${preset} ${floor ?? 'flat'}: yaw travel`).toBeLessThan(240);
      }
    }
  });
});
