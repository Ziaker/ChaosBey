// Owner, 2026-10-05 (v0.42.0): "adicione a opção no pré-jogo: Ataque giratório - ligado (base) e desligado; adicione o
// slider: Tamanho do bey in-game, recovery time … a força do ataque do bey aumente esse tempo naturalmente, o slider
// trata apenas o mínimo; … ajeite o drift para que seja mais responsivo e mais útil para build-up de velocidade; aumente
// o limite do slider do funilamento dos stages em 50%". Each through MatchConfig into the real match.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { floorHeightAt } from '../../src/arena/floor/ArenaFloorProfile';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { createDefaultMatchSetup, defaultMatchRules, loadLastSetup, matchConfigFor, saveLastSetup } from '../../src/app/frontend/matchSetup';
import { ALL_BEY_ARCHETYPES, ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { AttackController, AttackState } from '../../src/combat/attacks/AttackController';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { AIR_RECOVERY_MIN_DELAY_DEFAULT_S, ARENA_BOWL_DEPTH_RANGE, arenaFloorOf, createDefaultMatchConfig, resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { DodgeController } from '../../src/dodge/DodgeController';
import { AIR_RECOVERY_DELAY_PER_FORCE_S, AIR_RECOVERY_FORCE_DELAY_CAP_S } from '../../src/dodge/DodgeTuning';
import { DriftState } from '../../src/drift/DriftController';
import { DRIFT_GRIP_RECOVERY_DURATION_S } from '../../src/drift/DriftTuning';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { runAiMatch } from './aiMatchRunner';
import { CombatHarness } from './combatHarness';

const NONE: ControllerActions = { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
const hold = (held: Action[], pressed: Action[] = []): ControllerActions => ({ ...NONE, held: new Set(held), pressedThisFrame: new Set(pressed) });
const DT = 1 / 60;

describe('Pregame "Circular attack" on / off', () => {
  it('on by default; remembered with the setup and carried into the match config', () => {
    expect(createDefaultMatchConfig().circularAttack).toBe(true);
    expect(defaultMatchRules().circularAttack).toBe(true);
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const setup = { ...createDefaultMatchSetup(), rules: { ...defaultMatchRules(), circularAttack: false } };
    saveLastSetup(setup, storage);
    expect(matchConfigFor(loadLastSetup(storage)!).circularAttack).toBe(false);
  });

  it('off: a tap starts nothing (reported refused); a hold still charges and fires the Dash', () => {
    const attack = new AttackController(undefined, undefined, false, 1, false);
    const tick = (a: ControllerActions) => attack.tick(a, 0, { x: 0, z: 0 }, { x: 0, z: 5 }, DT);
    tick(hold([Action.Attack], [Action.Attack]));
    tick(NONE); // released inside the tap window
    expect(attack.getState()).toBe(AttackState.Neutral);
    expect(attack.wasPressRefusedThisTick()).toBe(true);
    tick(NONE);
    expect(attack.wasPressRefusedThisTick(), 'only on the tick it was refused').toBe(false);
    for (let t = 0; t < 30; t++) tick(hold([Action.Attack], t === 0 ? [Action.Attack] : []));
    expect(attack.getState()).toBe(AttackState.ChargingDash);
    tick(NONE);
    expect(attack.getState()).toBe(AttackState.DashActive);
  });

  it('off: the AI never throws a Circular (no counter either) and still attacks with the Dash', async () => {
    let circularTicks = 0;
    let dashes = 0;
    for (const [i, def] of ALL_BEY_ARCHETYPES.entries()) {
      const stats = await runAiMatch({
        seed: `no-circular-${i}`,
        firstDefinition: def,
        secondDefinition: ALL_BEY_ARCHETYPES[(i + 1) % 3]!,
        maxTicks: 1800,
        matchConfigOverrides: { circularAttack: false },
        onTick: (_t, world) => {
          if (world.first.attack.getState() === AttackState.CircularActive || world.second.attack.getState() === AttackState.CircularActive) circularTicks++;
        },
      });
      expect(stats.first.circularAttacks + stats.second.circularAttacks).toBe(0);
      dashes += stats.first.dashAttacks + stats.second.dashAttacks;
    }
    expect(circularTicks).toBe(0);
    expect(dashes).toBeGreaterThan(3);
  }, 60_000); // three AI matches of up to 1800 ticks: over the 5 s default on a loaded runner
});

describe('Pregame "Bey size"', () => {
  it('×2: both Beys\' body and attack reach double, same mass; spawned on the floor, not in it', async () => {
    const h = await CombatHarness.create(undefined, undefined, { ...createDefaultMatchConfig(), beySizeScale: 2 }, undefined, { first: ATTACK_ARCHETYPE, second: DEFENSE_ARCHETYPE });
    for (const [bey, base] of [[h.first, ATTACK_ARCHETYPE], [h.second, DEFENSE_ARCHETYPE]] as const) {
      expect(bey.definition.physical.colliderRadiusM).toBeCloseTo(base.physical.colliderRadiusM * 2, 9);
      expect(bey.definition.physical.colliderHalfHeightM).toBeCloseTo(base.physical.colliderHalfHeightM * 2, 9);
      expect(bey.definition.attack.circularHitboxRadiusM).toBeCloseTo(base.attack.circularHitboxRadiusM * 2, 9);
      expect(bey.definition.attack.dashHitboxRadiusM).toBeCloseTo(base.attack.dashHitboxRadiusM * 2, 9);
      expect(bey.body.mass()).toBeCloseTo(base.physical.massKg, 3);
    }
    const floor = arenaFloorOf(resolveMatchConfig({ ...createDefaultMatchConfig() }));
    for (let t = 0; t < 90; t++) h.tick(NONE, NONE);
    for (const bey of [h.first, h.second]) {
      const p = bey.body.translation();
      const bottom = p.y - bey.definition.physical.colliderHalfHeightM;
      expect(bottom - floorHeightAt(floor, p.x, p.z)).toBeGreaterThan(-0.1);
    }
  });

  it('the drawn model follows the size (its group scaled), the match default is ×1', async () => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    scene.add(camera);
    const s = await MatchSession.create({
      scene,
      camera,
      seedText: 'size',
      matchConfig: resolveMatchConfig({ beySizeScale: 1.5 }),
      attackProfileSettings: createDefaultAttackProfileSettings(),
      telemetry: new TelemetryRecorder(),
      stateMachine: new GameStateMachine(),
      controllers: { first: { kind: 'keyboard' }, second: { kind: 'replay', label: 'opponent', frames: [] } },
      keyboard: new ScriptedController([{ fromTick: 0, held: [] }]),
    });
    expect(s.match.visuals.first.visual.group.scale.x).toBeCloseTo(1.5, 9);
    expect(s.match.visuals.second.visual.group.scale.x).toBeCloseTo(1.5, 9);
    expect(s.getBey('first').definition.sizeScale).toBe(1.5);
    s.dispose();
    expect(createDefaultMatchConfig().beySizeScale).toBe(1);
  });

  it('AI matches at ×0.5 and ×2 still fight: hits land on both sides', async () => {
    for (const size of [0.5, 2]) {
      const stats = await runAiMatch({ seed: `size-${size}`, firstDefinition: ATTACK_ARCHETYPE, secondDefinition: DEFENSE_ARCHETYPE, maxTicks: 2400, matchConfigOverrides: { beySizeScale: size } });
      expect(stats.first.hitsLanded + stats.second.hitsLanded, `×${size}`).toBeGreaterThan(0);
    }
  });
});

describe('Pregame "Recovery time": the minimum, plus the launching hit\'s force', () => {
  const launched = (minS: number, force: number): DodgeController => {
    const dodge = new DodgeController(1.25, 0, 1, true, minS);
    const body = { linvel: () => ({ x: 0, y: 0, z: 0 }) } as never;
    dodge.tick(body, NONE, 0, false, 100, DT); // in the air (a takeoff tick re-arms from the pending launch)
    dodge.registerLaunch(true, force);
    return dodge;
  };
  const body = { linvel: () => ({ x: 0, y: 0, z: 0 }) } as never;

  it('default 0.2 s; a median hit (force 25) waits 0.2 + 0.25 s; an early C does nothing, one after works', () => {
    expect(createDefaultMatchConfig().airRecoveryMinDelayS).toBe(AIR_RECOVERY_MIN_DELAY_DEFAULT_S);
    expect(AIR_RECOVERY_MIN_DELAY_DEFAULT_S).toBe(0.2);
    const dodge = launched(0.2, 25);
    expect(dodge.getRecoveryWait().totalS).toBeCloseTo(0.2 + 25 * AIR_RECOVERY_DELAY_PER_FORCE_S, 9);
    let t = 0;
    while (t < 0.4) {
      expect(dodge.canAirRecoverNow()).toBe(false);
      const r = dodge.tick(body, hold([Action.Dodge], [Action.Dodge]), 0, false, 100, DT);
      expect(r.triggeredAirRecovery, `pressed at ${t.toFixed(2)} s`).toBe(false);
      t += DT;
    }
    while (!dodge.canAirRecoverNow() && t < 1) {
      dodge.tick(body, NONE, 0, false, 100, DT);
      t += DT;
    }
    expect(t).toBeCloseTo(0.45, 1);
    expect(dodge.tick(body, hold([Action.Dodge], [Action.Dodge]), 0, false, 100, DT).triggeredAirRecovery).toBe(true);
  });

  it('the force part is capped; the slider at 0 with a light hit is nearly at once; bare constructions never wait', () => {
    expect(launched(0.2, 500).getRecoveryWait().totalS).toBeCloseTo(0.2 + AIR_RECOVERY_FORCE_DELAY_CAP_S, 9);
    expect(launched(0, 5).getRecoveryWait().totalS).toBeCloseTo(0.05, 9);
    const bare = new DodgeController(1.25, 0, 1, true);
    bare.registerLaunch(true, 80);
    expect(bare.getRecoveryWait().totalS).toBe(0);
  });

  it('in the real match the knockback\'s force sets the wait (counted from the hit)', async () => {
    const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -2 }, { x: 0, y: BEY_SPAWN_HEIGHT_M, z: 4 }, { ...createDefaultMatchConfig(), arenaFloor: 'flat' });
    for (let i = 0; i < 40; i++) h.tick(NONE, NONE);
    let force = 0;
    for (let t = 0; t < 90 && force === 0; t++) {
      const r = h.tick(NONE, t < 20 ? hold([Action.Attack], t === 0 ? [Action.Attack] : []) : NONE);
      const kb = r.combatEvents.find((e) => e.kind === 'knockback' && e.targetIsFirst);
      if (kb && kb.kind === 'knockback') force = kb.force;
    }
    expect(force).toBeGreaterThan(0);
    const wait = h.first.dodge.getRecoveryWait();
    expect(wait.totalS).toBeCloseTo(0.2 + Math.min(AIR_RECOVERY_FORCE_DELAY_CAP_S, force * AIR_RECOVERY_DELAY_PER_FORCE_S), 6);
    expect(wait.remainingS).toBeGreaterThan(wait.totalS - 2 * DT);
  });
});

describe('drift: responsive, and a way to build speed', () => {
  // The same course for both: up to speed in a straight line, then a 180° curve (the stick turning 1.8 rad/s). Measured
  // before (0.41.0): long run-up — plain 28.7 m/s, drift 38.9; short run-up — plain 12.9, drift 10.9 (lost to the plain
  // curve); the drift started 21 ticks after the tap whenever X was pressed again. After: long 47.6, short 17.1, the
  // drift starts 6 ticks (0.1 s) after a second press made in the air.
  async function course(runUpTicks: number, drift: boolean, secondPressAt = 3) {
    const big = runUpTicks > 60;
    const h = await CombatHarness.create(
      { x: 0, y: BEY_SPAWN_HEIGHT_M, z: big ? -60 : -28 },
      { x: big ? -60 : -30, y: BEY_SPAWN_HEIGHT_M, z: big ? 40 : 25 },
      { ...createDefaultMatchConfig(), arenaFloor: 'flat', ...(big ? { arenaSizeScale: 2.5 } : {}) },
    );
    let angle = 0;
    const intent = () => ({ x: Math.sin(angle), z: Math.cos(angle) });
    for (let t = 0; t < runUpTicks; t++) h.tick({ ...NONE, moveIntent: intent() }, NONE);
    const x0 = h.first.body.translation().x;
    let width = 0;
    let firstDrift = -1;
    for (let t = 0; t < 140; t++) {
      if (t < 105) angle += 0.03;
      let a: ControllerActions = { ...NONE, moveIntent: intent() };
      if (drift && (t === 0 || t === secondPressAt)) a = { ...a, held: new Set([Action.JumpDrift]), pressedThisFrame: new Set([Action.JumpDrift]) };
      else if (drift && t > secondPressAt && t < 105) a = { ...a, held: new Set([Action.JumpDrift]) };
      const r = h.tick(a, NONE);
      if (firstDrift < 0 && r.first.driftState === DriftState.Drifting) firstDrift = t;
      width = Math.max(width, h.first.body.translation().x - x0);
    }
    const v = h.first.body.linvel();
    return { exit: Math.hypot(v.x, v.z), momentum: h.first.momentum.value, firstDrift, width };
  }

  it('X pressed again while the hop is in the air: down to the floor and drifting within 0.12 s', async () => {
    for (const press of [3, 6]) {
      const r = await course(45, true, press);
      expect(r.firstDrift - press, `second press at tick ${press}`).toBeLessThanOrEqual(7);
    }
  });

  it('a drifted curve leaves faster, with more momentum, than the same curve driven plain', async () => {
    for (const runUp of [45, 120]) {
      const plain = await course(runUp, false);
      const drift = await course(runUp, true);
      expect(drift.exit, `run-up ${runUp}`).toBeGreaterThan(plain.exit * 1.2);
      expect(drift.momentum, `run-up ${runUp}`).toBeGreaterThanOrEqual(plain.momentum);
    }
  });

  // Owner, 2026-10-05 ("PQ TÁ IMPOSSÍVEL DE DOBRAR NO DRIFT? … ERA PRA FICAR MAIS FÁCIL DE FAZER CURVAS EM ARCO"): the
  // stick pushed fully to the new direction at once. Measured (time from the tap to the velocity turned, width of the
  // turn): plain 90° 0.35–0.40 s, 2.0 / 5.6 m; drift 0.41.0 0.98–1.25 s, 5.8 / 15.8 m; drift 0.42–0.43 1.0–1.22 s,
  // 10.2 / 22.1 m and a 180° in 3.2 s. Now (DRIFT_CARVE_RATE_RAD_S): 90° 0.38 s, 1.9 / 4.1 m, leaving faster; 180° an arc
  // in 0.65 s at 15–27 m/s where the plain turn stops and reverses (0.1–0.3 m/s).
  async function fullStickTurn(runUpTicks: number, drift: boolean, targetDeg: number) {
    const h = await CombatHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: -60 }, { x: -60, y: BEY_SPAWN_HEIGHT_M, z: 50 }, { ...createDefaultMatchConfig(), arenaFloor: 'flat', arenaSizeScale: 2.5 });
    for (let t = 0; t < runUpTicks; t++) h.tick({ ...NONE, moveIntent: { x: 0, z: 1 } }, NONE);
    const x0 = h.first.body.translation().x;
    const a = (targetDeg * Math.PI) / 180;
    const intent = { x: Math.sin(a), z: Math.cos(a) };
    let width = 0;
    for (let t = 0; t < 240; t++) {
      let act: ControllerActions = { ...NONE, moveIntent: intent };
      if (drift && (t === 0 || t === 3)) act = { ...act, held: new Set([Action.JumpDrift]), pressedThisFrame: new Set([Action.JumpDrift]) };
      else if (drift && t > 3) act = { ...act, held: new Set([Action.JumpDrift]) };
      h.tick(act, NONE);
      const v = h.first.body.linvel();
      width = Math.max(width, Math.abs(h.first.body.translation().x - x0));
      const turned = (Math.acos(Math.max(-1, Math.min(1, v.z / Math.max(1e-6, Math.hypot(v.x, v.z))))) * 180) / Math.PI;
      if (turned >= targetDeg - 5) return { seconds: (t + 1) / 60, width, exit: Math.hypot(v.x, v.z) };
    }
    return { seconds: Infinity, width, exit: 0 };
  }

  it('full stick: a drift turns 90° as fast as a plain turn, no wider, and faster out; a 180° is an arc that keeps its speed', async () => {
    for (const runUp of [45, 120]) {
      const plain = await fullStickTurn(runUp, false, 90);
      const drift = await fullStickTurn(runUp, true, 90);
      expect(drift.seconds, `run-up ${runUp}: 90° time (hop included)`).toBeLessThanOrEqual(plain.seconds + 0.05);
      expect(drift.width, `run-up ${runUp}: 90° width`).toBeLessThanOrEqual(plain.width);
      expect(drift.exit, `run-up ${runUp}: 90° exit speed`).toBeGreaterThan(plain.exit);
      const plainU = await fullStickTurn(runUp, false, 180);
      const driftU = await fullStickTurn(runUp, true, 180);
      // A plain 180° at low speed is a quick stop (0.43 s, leaving at 0.3 m/s); the drift's arc keeps going: ≤ 0.7 s either way.
      expect(driftU.seconds, `run-up ${runUp}: 180° time`).toBeLessThanOrEqual(0.7);
      expect(driftU.exit, `run-up ${runUp}: 180° keeps its speed`).toBeGreaterThan(10);
      expect(plainU.exit, `run-up ${runUp}: a plain 180° stops and reverses`).toBeLessThan(1);
    }
  });

  it('the grip is back 0.25 s after the drift (was 0.5 s)', () => {
    expect(DRIFT_GRIP_RECOVERY_DURATION_S).toBe(0.25);
  });
});

describe('funnel slider: max 12 → 18 m, default unchanged', () => {
  it('range 0–18 m, default 8.5 m', () => {
    expect(ARENA_BOWL_DEPTH_RANGE.max).toBe(18);
    expect(createDefaultMatchConfig().arenaBowlDepthM).toBe(8.5);
  });

  it('at 18 m: the AI fights a full round, never below the floor', async () => {
    const config = { arenaBowlDepthM: 18 };
    const floor = arenaFloorOf(resolveMatchConfig(config));
    let below = 0;
    const stats = await runAiMatch({
      seed: 'funnel-18',
      firstDefinition: ATTACK_ARCHETYPE,
      secondDefinition: DEFENSE_ARCHETYPE,
      maxTicks: 3600,
      matchConfigOverrides: config,
      onTick: (_t, world) => {
        for (const bey of [world.first, world.second]) {
          const p = bey.body.translation();
          if (p.y - bey.definition.physical.colliderHalfHeightM < floorHeightAt(floor, p.x, p.z) - 0.15) below++;
        }
      },
    });
    expect(below).toBe(0);
    expect(stats.first.hitsLanded + stats.second.hitsLanded).toBeGreaterThan(0);
  });
});
