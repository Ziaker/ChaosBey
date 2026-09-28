// M9 lane A: CanonicalMatchStateV1 and the state hash (owner decisions:
// explicit versioned canonical state, strict floats, one simulation for
// live and headless, per-side AI RNG).

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import type { SideControllerSpec } from '../../src/app/session/SideControllers';
import { AIController } from '../../src/ai/controllers/AIController';
import { DEFAULT_AI_DIFFICULTY_PROFILE } from '../../src/ai/difficulty/AiDifficultyProfile';
import { personalityForBeyDefinitionId } from '../../src/ai/personalities/AiArchetypePersonalities';
import { ScriptedController } from '../../src/automation/scripted-scenarios/ScriptedController';
import { ATTACK_ARCHETYPE, DEFENSE_ARCHETYPE } from '../../src/bey/archetype/BeyArchetypes';
import { NullAiMashSource } from '../../src/combat/clash/ClashMash';
import { applyAttackProfileSettings, createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { Action } from '../../src/input/actions/Action';
import { STATE_SCHEMA_VERSION } from '../../src/replay/contracts';
import { CANONICAL_STATE_EXCLUSIONS } from '../../src/replay/state/CanonicalMatchState';
import { plainData, type DeterministicStateSource } from '../../src/replay/state/CanonicalValue';
import { diffCanonical, fnv1a64Bytes, stateHash } from '../../src/replay/state/stateHash';
import { createRngStreams } from '../../src/rng/SeededRng';
import { SelfTestMatchWorld } from '../../src/self-test/SelfTestMatchWorld';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import { IdleController } from '../../src/automation/scripted-scenarios/IdleController';

const AI_BOTH: { first: SideControllerSpec; second: SideControllerSpec } = { first: { kind: 'ai', personality: 'archetype' }, second: { kind: 'ai', personality: 'archetype' } };

async function liveSession(seedText: string, controllers = AI_BOTH): Promise<MatchSession> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  return MatchSession.create({
    scene,
    camera,
    seedText,
    matchConfig: resolveMatchConfig(),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers,
    keyboard: new IdleController(),
  });
}

/** A headless world built the way a live match is (same Beys, spawns, mash source, AI construction and RNG scheme). */
async function headlessAiMatch(seedText: string): Promise<{ world: SelfTestMatchWorld; step: () => void }> {
  const profiles = createDefaultAttackProfileSettings();
  const world = await SelfTestMatchWorld.build({
    firstDefinition: applyAttackProfileSettings(ATTACK_ARCHETYPE, profiles),
    secondDefinition: applyAttackProfileSettings(DEFENSE_ARCHETYPE, profiles),
    aiMashSource: new NullAiMashSource(),
  });
  const rng = createRngStreams(seedText);
  const ai = (own: typeof world.first, opponent: typeof world.first, stream: typeof rng.aiFirst) =>
    new AIController(world.physics, own, opponent, world.clash.controller, personalityForBeyDefinitionId(own.definition.id), DEFAULT_AI_DIFFICULTY_PROFILE, stream, new TelemetryRecorder());
  const controllers = { first: ai(world.first, world.second, rng.aiFirst), second: ai(world.second, world.first, rng.aiSecond) };
  return { world, step: () => void world.step(controllers) };
}

describe('state hash encoding', () => {
  it('is FNV-1a 64 (published test vectors)', () => {
    const enc = new TextEncoder();
    expect(fnv1a64Bytes(enc.encode(''))).toBe('cbf29ce484222325');
    expect(fnv1a64Bytes(enc.encode('a'))).toBe('af63dc4c8601ec8c');
    expect(fnv1a64Bytes(enc.encode('foobar'))).toBe('85944171f73967e8');
  });

  it('ignores object key order, canonicalizes only -0 and NaN, and keeps types apart', () => {
    expect(stateHash({ a: 1, b: 2 })).toBe(stateHash({ b: 2, a: 1 }));
    expect(stateHash({ x: -0 })).toBe(stateHash({ x: 0 }));
    expect(stateHash({ x: Number.NaN })).toBe(stateHash({ x: 0 / 0 }));
    const kinds = [stateHash(1), stateHash('1'), stateHash(true), stateHash(null), stateHash([1]), stateHash({ 1: 1 })];
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it('is strict: a one-ulp float change changes the hash (no rounding)', () => {
    const x = 0.1 + 0.2;
    const nextUp = x + Number.EPSILON * x;
    expect(nextUp).not.toBe(x);
    expect(stateHash({ v: nextUp })).not.toBe(stateHash({ v: x }));
  });

  it('plainData refuses engine objects and class instances', () => {
    expect(() => plainData(new THREE.Vector3())).toThrow(/not plain data/);
    expect(() => plainData({ f: () => 1 })).toThrow(/not plain data/);
    expect(plainData(new Set(['b', 'a']))).toEqual(['a', 'b']);
  });
});

describe('CanonicalMatchStateV1 coverage', () => {
  it('every field of every system is either in the canonical state or excluded with a reason', async () => {
    const world = await SelfTestMatchWorld.build();
    const systems: Record<string, object> = {
      MovementController: world.first.movement,
      SpinController: world.first.spin,
      DriftController: world.first.drift,
      DodgeController: world.first.dodge,
      StaminaSystem: world.first.stamina,
      StabilitySystem: world.first.stability,
      AttackEnergySystem: world.first.attackEnergy,
      AttackController: world.first.attack,
      ClashController: world.clash.controller,
      ClashOrchestration: world.clash,
      RoundState: world.roundState,
      HitstopClock: world.stepper.hitstop,
    };
    for (const [name, system] of Object.entries(systems)) {
      const covered = new Set(Object.keys((system as DeterministicStateSource).getDeterministicState()));
      const excluded = CANONICAL_STATE_EXCLUSIONS[name] ?? {};
      for (const [field, value] of Object.entries(system)) {
        if (typeof value === 'function') continue;
        expect(covered.has(field) || field in excluded, `${name}.${field} is neither hashed nor excluded`).toBe(true);
      }
    }
    world.dispose();
  });

  it('the two Beys are the only dynamic bodies, so their body state is all the mutable physics', async () => {
    const world = await SelfTestMatchWorld.build();
    let dynamic = 0;
    world.physics.rapierWorld.bodies.forEach((body) => {
      if (body.isDynamic()) dynamic++;
    });
    expect(dynamic).toBe(2);
    world.dispose();
  });

  it('carries the schema version, and a changed body field shows up in the hash and in the diff path', async () => {
    const world = await SelfTestMatchWorld.build();
    const before = world.getCanonicalState(0);
    expect(before.schema).toBe(STATE_SCHEMA_VERSION);
    const t = world.first.body.translation();
    world.first.body.setTranslation({ x: t.x + 1e-9, y: t.y, z: t.z }, true);
    const after = world.getCanonicalState(0);
    expect(stateHash(after)).not.toBe(stateHash(before));
    expect(diffCanonical(before, after)).toContain('beys.first.body.translation.x');
    world.dispose();
  });

  it('a change in a gameplay system (Stability) shows up in the hash; render-only spin angle does not exist in it', async () => {
    const world = await SelfTestMatchWorld.build();
    const before = world.getCanonicalState(0);
    world.second.stability.debugSetValue(world.second.stability.resource.value - 1);
    const after = world.getCanonicalState(0);
    expect(diffCanonical(before, after)).toContain('beys.second.stability.resource');
    expect(JSON.stringify(after)).not.toContain('visualSpinAngle');
    world.dispose();
  });
});

describe('one simulation (M9-0)', () => {
  it('the same seed gives the identical hash on every tick, twice', async () => {
    const a = await liveSession('hash-determinism');
    const b = await liveSession('hash-determinism');
    for (let i = 0; i < 900; i++) {
      a.tick();
      b.tick();
      expect(b.getStateHash(), `tick ${i}`).toBe(a.getStateHash());
    }
    a.dispose();
    b.dispose();
  }, 120_000);

  it('a live AI-vs-AI match and a headless one with the same seed hash identically on every tick (hitstop and RNG included)', async () => {
    const seed = 'live-equals-headless';
    const live = await liveSession(seed);
    const headless = await headlessAiMatch(seed);
    let frozenTicks = 0;
    for (let i = 0; i < 1800 && !live.roundState.isOver; i++) {
      const out = live.tick();
      if (!out.simulationAdvanced) frozenTicks++;
      headless.step();
      const liveState = live.getCanonicalState();
      const headlessState = headless.world.getCanonicalState(i + 1);
      expect(stateHash(headlessState), `tick ${i}: ${diffCanonical(liveState, headlessState).slice(0, 5).join(', ')}`).toBe(stateHash(liveState));
    }
    // Not vacuous: the fight really hit hard enough to freeze on hitstop.
    expect(frozenTicks).toBeGreaterThan(0);
    live.dispose();
    headless.world.dispose();
  }, 180_000);

  it('camera and VFX never change the simulation (render every tick with effects on vs never render)', async () => {
    const rendered = await liveSession('render-independence');
    const bare = await liveSession('render-independence');
    const camera = new THREE.PerspectiveCamera();
    for (let i = 0; i < 600; i++) {
      rendered.tick();
      rendered.renderFrame(1 / 60, camera, { cameraView: 'overview', cameraEffects: false });
      rendered.renderFrame(1 / 144, camera);
      bare.tick();
      expect(bare.getStateHash(), `tick ${i}`).toBe(rendered.getStateHash());
    }
    rendered.dispose();
    bare.dispose();
  }, 120_000);

  it('the simulation never draws from the gameplay RNG stream (if this fails, add it to CanonicalMatchStateV1 and bump the schema)', async () => {
    const session = await liveSession('gameplay-rng-unused');
    const initial = createRngStreams('gameplay-rng-unused').gameplay.getState();
    for (let i = 0; i < 1800 && !session.roundState.isOver; i++) session.tick();
    expect(session.rngStreams.gameplay.getState()).toBe(initial);
    session.dispose();
  }, 120_000);

  it('scripted inputs drive live and headless identically too', async () => {
    const frames = [
      { fromTick: 0, held: [Action.MoveForward] },
      { fromTick: 40, held: [Action.Attack] },
      { fromTick: 90, held: [] },
    ];
    const live = await liveSession('scripted-parity', { first: { kind: 'scripted', label: 'p', frames }, second: { kind: 'scripted', label: 'p', frames } });
    const profiles = createDefaultAttackProfileSettings();
    const world = await SelfTestMatchWorld.build({
      firstDefinition: applyAttackProfileSettings(ATTACK_ARCHETYPE, profiles),
      secondDefinition: applyAttackProfileSettings(DEFENSE_ARCHETYPE, profiles),
      aiMashSource: new NullAiMashSource(),
    });
    const controllers = { first: new ScriptedController([...frames]), second: new ScriptedController([...frames]) };
    for (let i = 0; i < 400; i++) {
      live.tick();
      world.step(controllers);
      expect(stateHash(world.getCanonicalState(i + 1)), `tick ${i}`).toBe(live.getStateHash());
    }
    live.dispose();
    world.dispose();
  }, 120_000);
});
