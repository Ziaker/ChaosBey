// ============================================================
// ARENA FLOOR COMPARISON (M11 lane 4 — bowl A/B/C playtest support)
// Measures the flat floor and the three approved bowls the same way, so
// the owner can compare how each one plays before choosing (nothing here
// chooses). Three kinds of evidence, all on the real headless runtime
// (SelfTestMatchWorld → MatchStepper → tickMatch), all deterministic:
//
// 1. Physics probes: coasting from the slope, a slow and a fast climb
//    from the centre, pushing into the wall at the edge, and an airborne
//    drop — the behaviours a slope changes first.
// 2. The GDD 68 scenario presets (drift, dash, wall hit / ricochet,
//    knockback, jump, landing, ring-out, high-speed collision, Clash…)
//    replayed on each floor. Their checks were written for the flat
//    arena: a check that no longer holds is a difference to look at, not
//    automatically a bug. Invalid states are bugs.
// 3. AI vs AI: outcomes, duration, speed, time near the edge / at the
//    wall, time in the air and GDD 67 anomalies, per floor.
// ============================================================

import { floorHeightAt, type ArenaFloorId, ARENA_FLOORS } from '../arena/floor/ArenaFloorProfile';
import { floorRimHeight } from '../arena/floor/ArenaFloorProfile';
import { ALL_BEY_ARCHETYPES, ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../bey/archetype/BeyArchetypes';
import type { Bey } from '../bey/core/Bey';
import { BEY_SPAWN_HEIGHT_M } from '../bey/core/BeyTuning';
import { NullAiMashSource } from '../combat/clash/ClashMash';
import { RoundOutcome } from '../combat/round-rules/RoundState';
import { resolveMatchConfig } from '../config/match/MatchConfig';
import type { CombatController, ControllerActions } from '../input/actions/Action';
import { IdleController } from '../automation/scripted-scenarios/IdleController';
import { FIXED_DELTA_SECONDS } from '../physics/fixed-step/FixedTimestepLoop';
import { DEFAULT_ANOMALY_THRESHOLDS, MatchAnomalyDetector } from './anomalies/MatchAnomalyDetector';
import { simulateAiMatch } from './AiMatchSimulation';
import { runScenario } from './scenarios/ScenarioRunner';
import { findScenarioPreset } from './scenarios/ScenarioPresets';
import { SelfTestMatchWorld } from './SelfTestMatchWorld';
import { isGrounded } from '../physics/collision/GroundCheck';

const TICKS_PER_S = Math.round(1 / FIXED_DELTA_SECONDS);
/** "Near the edge" for the stats: past this radius. */
const NEAR_EDGE_RADIUS_M = 9;
/** "At the wall": the Bey's rim within ~0.6 m of the wall's inner face (11.7 m). */
const AT_WALL_RADIUS_M = 10.9;

/** The scenario presets each floor replays (GDD 68). */
export const FLOOR_SCENARIO_IDS = [
  'dash-attack',
  'dash-whiff',
  'circular-counter',
  'drift',
  'wall-hit',
  'wall-ricochet',
  'high-knockback',
  'jump-attack',
  'strong-landing',
  'air-recovery',
  'ring-out',
  'high-speed-collision',
  'clash',
] as const;

export interface FloorProbeResults {
  /** Released at rest at r = 8 m with no input: where it is after 5 s, how fast it got, how soon it reached the centre (null = never). */
  readonly coast: { readonly finalRadiusM: number; readonly peakSpeedMps: number; readonly secondsToCentre: number | null };
  /** From the centre, holding a direction at 35% stick for 4 s. */
  readonly slowClimb: { readonly maxRadiusM: number; readonly speedAt2sMps: number };
  /** From the centre, full stick for 4 s. */
  readonly fastClimb: { readonly maxRadiusM: number; readonly secondsToR10: number | null; readonly topSpeedMps: number };
  /** Parked at r = 10.5 m driving straight into the wall for 3 s. */
  readonly wallPush: { readonly maxRadiusM: number; readonly finalSpeedMps: number };
  /** Dropped 3 m above the floor at r = 5 m, moving outward at 6 m/s. */
  readonly drop: { readonly secondsToLand: number | null; readonly maxRadiusM: number };
  /** GDD 67 invalid states seen during all probes (must be 0). */
  readonly invalidStates: number;
}

export interface FloorScenarioResult {
  readonly id: string;
  readonly status: 'passed' | 'failed' | 'unsupported';
  readonly detail: string;
  readonly invalidStates: number;
  readonly crashed: boolean;
}

export interface FloorAiBatch {
  readonly matches: number;
  readonly ringOuts: number;
  readonly kos: number;
  readonly draws: number;
  readonly unresolved: number;
  readonly averageDurationS: number;
  readonly averageSpeedMps: number;
  readonly averageRadiusM: number;
  /** Share of Bey-time past NEAR_EDGE_RADIUS_M. */
  readonly nearEdgeShare: number;
  /** Share of Bey-time at the wall. */
  readonly atWallShare: number;
  /** Share of Bey-time with no floor contact (the simulation's own GroundCheck). */
  readonly airShare: number;
  readonly invalidStates: number;
  readonly warnings: number;
}

export interface FloorComparison {
  readonly floor: ArenaFloorId;
  readonly probes: FloorProbeResults;
  readonly scenarios: readonly FloorScenarioResult[];
  readonly ai: FloorAiBatch;
}

// ---------------------------------------------------------------- probes

/** A controller that holds one world direction (directional control) at a given strength. */
function holding(x: number, z: number, strength: number): CombatController {
  const len = Math.hypot(x, z) || 1;
  const actions: ControllerActions = {
    held: new Set(),
    pressedThisFrame: new Set(),
    attackHoldDurationSeconds: 0,
    jumpDriftHoldDurationSeconds: 0,
    moveIntent: { x: (x / len) * strength, z: (z / len) * strength },
  };
  return { sampleActions: () => actions };
}

function place(bey: Bey, x: number, z: number, heading: number, lift = 0): void {
  bey.body.setTranslation({ x, y: BEY_SPAWN_HEIGHT_M + floorHeightAt(bey.arenaFloor, x, z) + lift, z }, true);
  bey.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  bey.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  bey.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  bey.movement.debugSetHeading(heading);
}

const radius = (bey: Bey): number => {
  const p = bey.body.translation();
  return Math.hypot(p.x, p.z);
};
const speed = (bey: Bey): number => {
  const v = bey.body.linvel();
  return Math.hypot(v.x, v.z);
};

async function probeWorld(floor: ArenaFloorId): Promise<SelfTestMatchWorld> {
  return SelfTestMatchWorld.build({ firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, aiMashSource: new NullAiMashSource(), matchConfigOverrides: { arenaFloor: floor } });
}

/**
 * Runs `ticks` ticks with `first` driven by `controller` while the second
 * Bey is held parked out of the way (re-placed every tick), calling
 * `each` after every tick. Returns the invalid states the detector saw.
 */
async function probe(floor: ArenaFloorId, ticks: number, setup: (first: Bey) => void, controller: CombatController, each: (tick: number, first: Bey, grounded: boolean) => void): Promise<number> {
  const world = await probeWorld(floor);
  const config = resolveMatchConfig({ arenaFloor: floor });
  const detector = new MatchAnomalyDetector({ ...DEFAULT_ANOMALY_THRESHOLDS, wallHeightM: floorRimHeight(floor) + config.arenaWallHeightM });
  setup(world.first);
  const idle = new IdleController();
  let invalid = 0;
  for (let tick = 0; tick < ticks; tick++) {
    place(world.second, 0, -9.5, 0); // parked: never part of the probe
    const { firstActions, secondActions, result, advanced } = world.step({ first: controller, second: idle });
    each(tick, world.first, result.first.movement.isGrounded);
    invalid += detector
      .check({ tick, first: world.first, second: world.second, result, roundState: world.roundState, clash: world.clash.controller, firstActions, secondActions, aiSides: { first: false, second: false }, hitstopActive: !advanced })
      .filter((d) => d.severity === 'invalid-state').length;
    if (world.roundState.isOver) break;
  }
  world.dispose();
  return invalid;
}

export async function runFloorProbes(floor: ArenaFloorId): Promise<FloorProbeResults> {
  let invalid = 0;

  let coastPeak = 0;
  let coastCentre: number | null = null;
  let coastFinal = 0;
  invalid += await probe(floor, 5 * TICKS_PER_S, (b) => place(b, 8, 0, 0), new IdleController(), (t, b) => {
    coastPeak = Math.max(coastPeak, speed(b));
    if (coastCentre === null && radius(b) < 1) coastCentre = (t + 1) / TICKS_PER_S;
    coastFinal = radius(b);
  });

  let slowMax = 0;
  let slowAt2 = 0;
  invalid += await probe(floor, 4 * TICKS_PER_S, (b) => place(b, 0, 0, Math.PI / 2), holding(1, 0, 0.35), (t, b) => {
    slowMax = Math.max(slowMax, radius(b));
    if (t === 2 * TICKS_PER_S - 1) slowAt2 = speed(b);
  });

  let fastMax = 0;
  let fastR10: number | null = null;
  let fastTop = 0;
  invalid += await probe(floor, 4 * TICKS_PER_S, (b) => place(b, 0, 0, Math.PI / 2), holding(1, 0, 1), (t, b) => {
    fastMax = Math.max(fastMax, radius(b));
    fastTop = Math.max(fastTop, speed(b));
    if (fastR10 === null && radius(b) >= 10) fastR10 = (t + 1) / TICKS_PER_S;
  });

  let wallMax = 0;
  let wallFinal = 0;
  invalid += await probe(floor, 3 * TICKS_PER_S, (b) => place(b, 10.5, 0, Math.PI / 2), holding(1, 0, 1), (_t, b) => {
    wallMax = Math.max(wallMax, radius(b));
    wallFinal = speed(b);
  });

  let dropLand: number | null = null;
  let dropMax = 0;
  invalid += await probe(
    floor,
    3 * TICKS_PER_S,
    (b) => {
      place(b, 5, 0, Math.PI / 2, 3);
      b.body.setLinvel({ x: 6, y: 0, z: 0 }, true);
    },
    new IdleController(),
    (t, b, grounded) => {
      dropMax = Math.max(dropMax, radius(b));
      if (dropLand === null && grounded) dropLand = (t + 1) / TICKS_PER_S;
    },
  );

  return {
    coast: { finalRadiusM: coastFinal, peakSpeedMps: coastPeak, secondsToCentre: coastCentre },
    slowClimb: { maxRadiusM: slowMax, speedAt2sMps: slowAt2 },
    fastClimb: { maxRadiusM: fastMax, secondsToR10: fastR10, topSpeedMps: fastTop },
    wallPush: { maxRadiusM: wallMax, finalSpeedMps: wallFinal },
    drop: { secondsToLand: dropLand, maxRadiusM: dropMax },
    invalidStates: invalid,
  };
}

// ---------------------------------------------------------------- scenarios

export async function runFloorScenarios(floor: ArenaFloorId): Promise<FloorScenarioResult[]> {
  const out: FloorScenarioResult[] = [];
  for (const id of FLOOR_SCENARIO_IDS) {
    const preset = findScenarioPreset(id);
    if (!preset) continue;
    const r = await runScenario(preset, { arenaFloor: floor });
    out.push({
      id,
      status: r.status,
      detail: r.detail,
      invalidStates: r.detections.filter((d) => d.severity === 'invalid-state').length,
      crashed: r.crashMessage !== null,
    });
  }
  return out;
}

// ---------------------------------------------------------------- AI vs AI

export async function runFloorAiBatch(floor: ArenaFloorId, seedsPerPairing: number, maxTicks = 3600): Promise<FloorAiBatch> {
  let matches = 0;
  let ringOuts = 0;
  let kos = 0;
  let draws = 0;
  let unresolved = 0;
  let totalTicks = 0;
  let beyTicks = 0;
  let speedSum = 0;
  let radiusSum = 0;
  let nearEdge = 0;
  let atWall = 0;
  let air = 0;
  let invalid = 0;
  let warnings = 0;
  for (const first of ALL_BEY_ARCHETYPES) {
    for (const second of ALL_BEY_ARCHETYPES) {
      for (let s = 0; s < seedsPerPairing; s++) {
        const record = await simulateAiMatch({
          seed: `floor-${s}/${first.id}-vs-${second.id}`,
          firstDefinition: first,
          secondDefinition: second,
          maxTicks,
          matchConfigOverrides: { arenaFloor: floor },
          onTick: (_tick, world) => {
            for (const bey of [world.first, world.second]) {
              const r = radius(bey);
              beyTicks++;
              speedSum += speed(bey);
              radiusSum += r;
              if (r > NEAR_EDGE_RADIUS_M) nearEdge++;
              if (r > AT_WALL_RADIUS_M) atWall++;
              if (!isGrounded(world.physics, bey.collider)) air++;
            }
          },
        });
        matches++;
        totalTicks += record.stats.ticks;
        invalid += record.invalidDetectionCount;
        warnings += record.warningCount;
        const outcome = String(record.stats.outcome);
        if (record.stats.outcome === RoundOutcome.Ongoing) unresolved++;
        else if (outcome.includes('RingOut')) ringOuts++;
        else if (outcome.includes('Ko')) kos++;
        else draws++;
      }
    }
  }
  const per = Math.max(1, beyTicks);
  return {
    matches,
    ringOuts,
    kos,
    draws,
    unresolved,
    averageDurationS: totalTicks / Math.max(1, matches) / TICKS_PER_S,
    averageSpeedMps: speedSum / per,
    averageRadiusM: radiusSum / per,
    nearEdgeShare: nearEdge / per,
    atWallShare: atWall / per,
    airShare: air / per,
    invalidStates: invalid,
    warnings,
  };
}

export async function compareFloor(floor: ArenaFloorId, seedsPerPairing: number): Promise<FloorComparison> {
  return { floor, probes: await runFloorProbes(floor), scenarios: await runFloorScenarios(floor), ai: await runFloorAiBatch(floor, seedsPerPairing) };
}

// ---------------------------------------------------------------- report

const n = (v: number, digits = 2): string => v.toFixed(digits);
const s = (v: number | null): string => (v === null ? 'never' : `${n(v)} s`);
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** A Markdown comparison table set, one column per floor. */
export function renderFloorComparison(results: readonly FloorComparison[], seedsPerPairing: number): string {
  const head = `| | ${results.map((r) => ARENA_FLOORS[r.floor].label).join(' | ')} |\n|---|${results.map(() => '---:').join('|')}|`;
  const rowOf = (label: string, cell: (r: FloorComparison) => string): string => `| ${label} | ${results.map(cell).join(' | ')} |`;
  const lines: string[] = [];
  lines.push('### Physics probes', '', head);
  lines.push(rowOf('Coast from r = 8 m at rest: radius after 5 s', (r) => `${n(r.probes.coast.finalRadiusM)} m`));
  lines.push(rowOf('Coast: peak speed', (r) => `${n(r.probes.coast.peakSpeedMps)} m/s`));
  lines.push(rowOf('Coast: reaches the centre (r < 1 m)', (r) => s(r.probes.coast.secondsToCentre)));
  lines.push(rowOf('Slow climb (35% stick): speed at 2 s', (r) => `${n(r.probes.slowClimb.speedAt2sMps)} m/s`));
  lines.push(rowOf('Slow climb: farthest radius in 4 s', (r) => `${n(r.probes.slowClimb.maxRadiusM)} m`));
  lines.push(rowOf('Fast climb (full stick): top speed', (r) => `${n(r.probes.fastClimb.topSpeedMps)} m/s`));
  lines.push(rowOf('Fast climb: reaches r = 10 m', (r) => s(r.probes.fastClimb.secondsToR10)));
  lines.push(rowOf('Wall push at r = 10.5 m: farthest radius', (r) => `${n(r.probes.wallPush.maxRadiusM)} m`));
  lines.push(rowOf('Drop from 3 m at r = 5 m (6 m/s out): lands after', (r) => s(r.probes.drop.secondsToLand)));
  lines.push(rowOf('Drop: farthest radius', (r) => `${n(r.probes.drop.maxRadiusM)} m`));
  lines.push(rowOf('Probe invalid states', (r) => `${r.probes.invalidStates}`));
  lines.push('', '### Scenario presets (GDD 68) — the preset\'s own check, written for the flat arena', '', head);
  for (const id of FLOOR_SCENARIO_IDS) {
    lines.push(
      rowOf(id, (r) => {
        const x = r.scenarios.find((sc) => sc.id === id);
        if (!x) return '—';
        const mark = x.crashed ? 'CRASH' : x.status === 'passed' ? 'pass' : x.status === 'unsupported' ? 'n/a' : 'differs';
        return x.invalidStates > 0 ? `${mark}, ${x.invalidStates} invalid` : mark;
      }),
    );
  }
  lines.push('', `### AI vs AI (9 pairings × ${seedsPerPairing} seeds, up to 60 s)`, '', head);
  lines.push(rowOf('Ring-outs / KOs / draws / unresolved', (r) => `${r.ai.ringOuts} / ${r.ai.kos} / ${r.ai.draws} / ${r.ai.unresolved}`));
  lines.push(rowOf('Average round length', (r) => `${n(r.ai.averageDurationS, 1)} s`));
  lines.push(rowOf('Average speed', (r) => `${n(r.ai.averageSpeedMps)} m/s`));
  lines.push(rowOf('Average distance from the centre', (r) => `${n(r.ai.averageRadiusM)} m`));
  lines.push(rowOf(`Time past r = ${NEAR_EDGE_RADIUS_M} m`, (r) => pct(r.ai.nearEdgeShare)));
  lines.push(rowOf('Time at the wall', (r) => pct(r.ai.atWallShare)));
  lines.push(rowOf('Time in the air', (r) => pct(r.ai.airShare)));
  lines.push(rowOf('GDD 67 invalid states / warnings', (r) => `${r.ai.invalidStates} / ${r.ai.warnings}`));
  return lines.join('\n');
}
