// ============================================================
// CAMERA / GAMEPLAY CAUSAL SEPARATION — runtime proof
// (owner requirement, 2026-10-01: "A CÂMERA NUNCA MOVE O BEY")
//
//   Camera is downstream presentation. It may observe gameplay; it may
//   never mutate or causally influence gameplay.
//
// Permanent regression suite, NO retries. Every test here runs the SAME
// fight (same seed, Beys, arena, AI, inputs, tick count) several times with
// a different camera and diffs, tick by tick, the entire gameplay surface:
// the player's actions and moveIntent, the full per-Bey tick snapshot
// (movement, spin, grounded, drift, dodge, attack, stamina, stability,
// broken, attack energy), hit/combat events, impulses (knockback),
// acceleration, position, linear/angular velocity, rotation, heading and
// the canonical state hash. They must be identical to the byte.
//
// The player's controller is built by createPlayerControl() — the very
// factory MatchRunner (PLAY) and the Debug Lab use — so the Directional
// scheme (the one that used to read the camera) is exercised for real, not
// swapped for a Classic stand-in.
//
// The camera variants:
//   none     no camera at all (render disabled; MatchSession cameraRig: null)
//   static   a real CameraRig frozen at its first pose
//   real     the real Camera Director, with presets A/B/C switched mid-run,
//            effects toggled, aspect ratio changing and renderFrame() called
//   hostile  an adversarial camera: eye/focus teleporting around the arena,
//            FOV 5°–145°, huge shake, spinning yaw/side every tick, and it
//            even tries to MUTATE the frame it is shown
// ============================================================

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { CameraRig, type CameraObserver, type CameraRigOutput } from '../../src/camera/director/CameraRig';
import { PRESET_IDS, type PresetId } from '../../src/camera/director/CameraParams';
import type { FightFrame } from '../../src/camera/director/FightFrame';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';
import { createPlayerControl } from '../../src/input/directional/createPlayerControl';
import { controlSetupFor } from '../../src/app/frontend/controlReferences';
import type { ControlScheme } from '../../src/config/settings/PlayerSettings';
import { WORLD_CONTROL_REFERENCE } from '../../src/input/directional/ControlReference';
import { screenToWorld, screenVectorFromDigital } from '../../src/input/directional/screenDirection';
import type { ArenaFloorId } from '../../src/arena/floor/ArenaFloorProfile';

// ---------------------------------------------------------------- devices

/** A busy, fully deterministic human input script (tick-index only): throttle, steering, diagonals, drift/jump, dodge, attack. */
class ScriptedPlayer implements CombatController {
  private tick = 0;
  sampleActions(): ControllerActions {
    const t = this.tick++;
    const phase = Math.floor(t / 37) % 10;
    const held = new Set<Action>(
      [
        [Action.MoveForward],
        [Action.MoveForward, Action.SteerRight],
        [Action.SteerRight],
        [Action.MoveForward, Action.JumpDrift],
        [Action.MoveBackward, Action.SteerLeft],
        [Action.SteerLeft, Action.JumpDrift],
        [Action.MoveForward, Action.Attack],
        [Action.Dodge, Action.MoveForward],
        [Action.MoveBackward],
        [Action.MoveForward, Action.SteerLeft, Action.Attack],
      ][phase],
    );
    return {
      held,
      pressedThisFrame: t % 37 === 0 ? new Set(held) : new Set(),
      attackHoldDurationSeconds: held.has(Action.Attack) ? ((t % 37) + 1) / 60 : 0,
      jumpDriftHoldDurationSeconds: held.has(Action.JumpDrift) ? ((t % 37) + 1) / 60 : 0,
    };
  }
}

/** The player does nothing at all. */
class IdlePlayer implements CombatController {
  sampleActions(): ControllerActions {
    return { held: new Set(), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
  }
}

/** One key held for the whole run (a held ArrowUp while the camera does anything it likes). */
class HeldKey implements CombatController {
  private first = true;
  constructor(private readonly action: Action) {}
  sampleActions(): ControllerActions {
    const pressed = this.first ? new Set([this.action]) : new Set<Action>();
    this.first = false;
    return { held: new Set([this.action]), pressedThisFrame: pressed, attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
  }
}

type DeviceKind = 'idle' | 'script' | 'held-up' | 'taps';
/** Presses ↑ for 30 ticks, lets go for 10, repeatedly: a fresh gesture every 40 ticks. */
class TapUp implements CombatController {
  private tick = 0;
  private prev = false;
  sampleActions(): ControllerActions {
    const down = this.tick++ % 40 < 30;
    const held = new Set<Action>(down ? [Action.MoveForward] : []);
    const pressed = new Set<Action>(down && !this.prev ? [Action.MoveForward] : []);
    this.prev = down;
    return { held, pressedThisFrame: pressed, attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
  }
}

function makeDevice(kind: DeviceKind): CombatController {
  return kind === 'idle' ? new IdlePlayer() : kind === 'script' ? new ScriptedPlayer() : kind === 'taps' ? new TapUp() : new HeldKey(Action.MoveForward);
}

// ---------------------------------------------------------------- cameras

type CameraVariant = 'none' | 'static' | 'real' | 'hostile';

function makeStaticRig(): CameraObserver {
  const real = new CameraRig('B');
  let frozen: CameraRigOutput | null = null;
  return {
    tick: (frame, dt) => (frozen ??= real.tick(frame, dt)),
    setPreset: (p) => real.setPreset(p),
    getPreset: () => real.getPreset(),
    setAspect: (a) => real.setAspect(a),
  };
}

/** Attempts to corrupt everything the camera is shown. Gameplay must not notice. */
function tryToMutate(frame: FightFrame): void {
  try {
    const f = frame as unknown as { first: { position: { x: number }; velocity: { x: number } }; second: { position: { x: number }; velocity: { x: number } }; impactEvents: { magnitude: number }[]; tick: number };
    for (const bey of [f.first, f.second]) {
      bey.position.x += 1e3;
      bey.velocity.x += 1e3;
    }
    for (const event of f.impactEvents) event.magnitude = 99;
    f.tick = -1;
  } catch {
    // a frozen frame throws in strict mode — also fine
  }
}

function makeHostileRig(): CameraObserver {
  const real = new CameraRig('C');
  let n = 0;
  return {
    tick(frame, dt) {
      const base = real.tick(frame, dt);
      n++;
      tryToMutate(frame);
      const a = n * 0.37; // ~21° per tick
      const wild = {
        ...base,
        eye: { x: 30 * Math.sin(a), y: 2 + 25 * Math.abs(Math.sin(a * 0.31)), z: 30 * Math.cos(a) },
        focus: { x: 12 * Math.sin(a * 1.7), y: 0, z: 12 * Math.cos(a * 2.3) },
        fov: 5 + 140 * Math.abs(Math.sin(a * 0.13)),
        fovPunch: 30,
        shake: { x: 5 * Math.sin(a * 9), y: 5 * Math.cos(a * 7), z: 5 * Math.sin(a * 5) },
        mode: n % 2 === 0 ? base.mode : ('Clash' as unknown as typeof base.mode),
        clashBlend: Math.abs(Math.sin(a)),
        player: { ...base.player, debug: { ...base.player.debug, yawDeg: ((n * 37) % 360) - 180, side: n % 2 === 0 ? 1 : -1, distance: 1 + (n % 40) } },
      };
      return wild as CameraRigOutput;
    },
    setPreset: (p) => real.setPreset(p),
    getPreset: () => real.getPreset(),
    setAspect: (a) => real.setAspect(a),
  };
}

// ---------------------------------------------------------------- runner

interface RunSpec {
  readonly floor: ArenaFloorId;
  readonly seed: string;
  readonly device: DeviceKind;
  readonly scheme: ControlScheme;
  readonly variant: CameraVariant;
  readonly ticks: number;
  /** Identical, test-induced gameplay perturbations (teleports) — applied after the given tick in EVERY variant. */
  readonly perturb?: Readonly<Record<number, (session: MatchSession) => void>>;
  /** Presentation-side churn on top of rendering: effects toggles, preset switches, aspect changes, overview view. Default: on for real/hostile. */
  readonly churn?: boolean;
  /** Fixed render options (used by the settings-invariance test). */
  readonly fixed?: { preset?: PresetId; effects?: boolean; aspect?: number; view?: 'game' | 'overview' };
  readonly renders?: boolean;
}

interface TickRecord {
  readonly key: string;
  readonly hash: string;
}

interface CameraTrace {
  yawsDeg: number[];
  fovs: number[];
  sides: Set<number>;
  modifiers: Set<string>;
  eyeDistances: number[];
  readsDuringTick: number;
}

interface RunResult {
  readonly records: TickRecord[];
  readonly camera: CameraTrace;
  readonly coverage: { moves: boolean; drift: Set<string>; attack: Set<string>; dodge: Set<string>; knockback: boolean; airborne: boolean; hits: number; intents: { x: number; z: number }[] };
  readonly ticksRun: number;
}

async function runMatch(spec: RunSpec): Promise<RunResult> {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, spec.fixed?.aspect ?? 16 / 9, 0.1, 1000);
  scene.add(camera);
  const rig = spec.variant === 'none' ? null : spec.variant === 'static' ? makeStaticRig() : spec.variant === 'hostile' ? makeHostileRig() : undefined;
  // The player's control chain, built exactly like PLAY builds it (controlSetupFor + createPlayerControl).
  let sessionRef: MatchSession | null = null;
  const setup = controlSetupFor(spec.scheme, { session: () => sessionRef });
  const player = createPlayerControl(makeDevice(spec.device), { directional: setup.directional, reference: setup.reference });
  const session = await MatchSession.create({
    scene,
    camera,
    seedText: spec.seed,
    matchConfig: resolveMatchConfig({ arenaFloor: spec.floor }),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers: { first: { kind: 'keyboard' }, second: { kind: 'ai', personality: 'archetype' } },
    keyboard: player,
    cameraPreset: spec.fixed?.preset,
    cameraRig: rig,
  });
  sessionRef = session;

  // Tripwire: nothing that runs inside tick() may read the camera's output through the session API.
  const trace: CameraTrace = { yawsDeg: [], fovs: [], sides: new Set(), modifiers: new Set(), eyeDistances: [], readsDuringTick: 0 };
  let inTick = false;
  const originalGetter = session.getLastCameraOutput.bind(session);
  session.getLastCameraOutput = () => {
    if (inTick) trace.readsDuringTick++;
    return originalGetter();
  };

  const render = spec.renders ?? spec.variant !== 'none';
  const churn = spec.churn ?? (spec.variant === 'real' || spec.variant === 'hostile');
  const records: TickRecord[] = [];
  const coverage: RunResult['coverage'] = { moves: false, drift: new Set(), attack: new Set(), dodge: new Set(), knockback: false, airborne: false, hits: 0, intents: [] };
  let effects = spec.fixed?.effects ?? true;
  let ticksRun = 0;

  for (let tick = 0; tick < spec.ticks; tick++) {
    inTick = true;
    const out = session.tick();
    inTick = false;
    ticksRun++;

    const first = session.getBey('first');
    const second = session.getBey('second');
    const snap = (bey: typeof first) => ({
      p: bey.body.translation(),
      v: bey.body.linvel(),
      w: bey.body.angvel(),
      q: bey.body.rotation(),
      h: bey.movement.getHeadingRad(),
    });
    const impulses = { first: session.getLastImpulses('first'), second: session.getLastImpulses('second') };
    const accel = { first: session.getLastAcceleration('first'), second: session.getLastAcceleration('second') };
    const actions = session.getLastActions('first');
    const hash = String(session.getStateHash());
    const key = JSON.stringify({
      tick,
      advanced: out.simulationAdvanced,
      held: [...(actions?.held ?? [])].sort(),
      pressed: [...(actions?.pressedThisFrame ?? [])].sort(),
      moveIntent: actions?.moveIntent ?? null,
      result: out.result,
      first: snap(first),
      second: snap(second),
      impulses,
      accel,
      hash,
    });
    records.push({ key, hash });

    // Coverage: make sure the fight actually exercises the systems under test.
    const intent = actions?.moveIntent;
    if ((intent && Math.hypot(intent.x, intent.z) > 0.5) || out.result.first.movement.speedMps > 2) coverage.moves = true; // Classic has no moveIntent: judge by speed
    if (intent) coverage.intents.push({ x: intent.x, z: intent.z });
    coverage.drift.add(String(out.result.first.driftState));
    coverage.attack.add(String(out.result.first.attackState));
    coverage.dodge.add(String(out.result.first.dodgeState));
    if (impulses.first.knockbackForce > 0 || impulses.second.knockbackForce > 0) coverage.knockback = true;
    if (!out.result.first.grounded) coverage.airborne = true;
    coverage.hits += out.result.hitEvents.length;

    spec.perturb?.[tick]?.(session);

    // Presentation side: render, churn the camera settings, record what the camera did.
    if (render) {
      if (churn) {
        if (tick % 61 === 30) effects = !effects;
        if (tick % 97 === 50) session.setCameraPreset(PRESET_IDS[(tick / 97) % PRESET_IDS.length | 0]!);
        if (tick % 53 === 20) {
          camera.aspect = [0.5, 16 / 9, 3, 1][(tick / 53) % 4 | 0]!;
          camera.updateProjectionMatrix();
        }
      }
      session.renderFrame(1 / 60, camera, { cameraView: spec.fixed?.view ?? (churn && tick % 211 > 190 ? 'overview' : 'game'), cameraEffects: effects });
    }
    const cam = originalGetter();
    if (cam) {
      trace.yawsDeg.push(cam.yawDeg);
      trace.fovs.push(cam.fovDeg);
      trace.sides.add(cam.side);
      for (const m of cam.modifiers) trace.modifiers.add(m);
      trace.eyeDistances.push(cam.distanceM);
    }
    if (session.roundState.result !== 'Ongoing') break;
  }
  session.dispose();
  return { records, camera: trace, coverage, ticksRun };
}

function firstDivergence(a: RunResult, b: RunResult): string | null {
  if (a.records.length !== b.records.length) return `different tick counts: ${a.records.length} vs ${b.records.length}`;
  for (let i = 0; i < a.records.length; i++) {
    if (a.records[i]!.key !== b.records[i]!.key) {
      const x = JSON.parse(a.records[i]!.key) as Record<string, unknown>;
      const y = JSON.parse(b.records[i]!.key) as Record<string, unknown>;
      const fields = Object.keys(x).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k]));
      return `tick ${i}: ${fields.join(', ')} differ`;
    }
  }
  return null;
}

const range = (xs: number[]): number => (xs.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs));

/** Sequential, never Promise.all: each run owns a physics world and a scene. */
async function runAll(base: Omit<RunSpec, 'variant'>, variants: CameraVariant[]): Promise<Record<CameraVariant, RunResult>> {
  const out = {} as Record<CameraVariant, RunResult>;
  for (const variant of variants) out[variant] = await runMatch({ ...base, variant });
  return out;
}

function expectIdentical(runs: Record<string, RunResult>, baseline: string): void {
  for (const [name, run] of Object.entries(runs)) {
    if (name === baseline) continue;
    expect(firstDivergence(runs[baseline]!, run), `gameplay with camera "${name}" diverged from camera "${baseline}"`).toBeNull();
    expect(run.camera.readsDuringTick, `camera "${name}": something inside tick() read the camera output`).toBe(0);
  }
}

const TICKS = 900; // 15 s at 60 Hz

// renderFrame() builds a small decal texture from a canvas; node has no DOM, so give it an inert one (pure presentation, never read by gameplay).
beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => null }) });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------- tests

describe('A. zero input: nothing the camera does may move, steer or touch a Bey', () => {
  for (const floor of ['flat', 'bowl-b'] as const) {
    it(`${floor}: no player input, camera none / static / real / hostile ⇒ identical gameplay every tick`, async () => {
      const runs = await runAll({ floor, seed: `sep-zero-${floor}`, device: 'idle', scheme: 'opponent', ticks: TICKS }, ['none', 'static', 'real', 'hostile']);
      // The setup is real: the cameras genuinely differ, and the player really produced no input.
      expect(range(runs.static.camera.yawsDeg)).toBeLessThan(0.001);
      expect(range(runs.real.camera.yawsDeg), 'the real camera never moved').toBeGreaterThan(10);
      expect(range(runs.hostile.camera.fovs)).toBeGreaterThan(100);
      expect(runs.none.camera.yawsDeg).toEqual([]); // render disabled: no camera output at all
      expect(runs.none.coverage.intents.every((i) => i.x === 0 && i.z === 0)).toBe(true);
      expectIdentical(runs, 'none');
    }, 120_000);
  }
});

describe('B. real player input through the real control chain (every camera-free control scheme): static vs extremely dynamic camera', () => {
  // opponent (default) / arena / classic never read the camera. The opt-in 'screen' scheme is the owner's explicit exception and is covered by its own test below.
  for (const scheme of ['opponent', 'arena', 'classic'] as const) {
    for (const floor of ['flat', 'bowl-a', 'bowl-c'] as const) {
      it(`${scheme} / ${floor}: scripted throttle/steer/diagonals/drift/jump/dodge/attack ⇒ identical gameplay every tick`, async () => {
        const runs = await runAll({ floor, seed: `sep-input-${scheme}-${floor}`, device: 'script', scheme, ticks: TICKS }, ['none', 'static', 'real', 'hostile']);
        expect(range(runs.static.camera.yawsDeg)).toBeLessThan(0.001);
        expect(range(runs.real.camera.yawsDeg), 'the real camera never moved').toBeGreaterThan(10);
        expect(runs.hostile.camera.sides.size).toBe(2);
        // The script really drove the Bey through the systems under test.
        const c = runs.none.coverage;
        expect(c.moves, 'the player never moved').toBe(true);
        expect(c.drift.size + c.attack.size + c.dodge.size, 'drift/attack/dodge were never exercised').toBeGreaterThan(3);
        expectIdentical(runs, 'none');
      }, 120_000);
    }
  }

  it('arena scheme: a held ArrowUp resolves to ONE constant world direction for the whole fight while the camera orbits wildly — the camera is not in the chain', async () => {
    const intentsByVariant: Record<string, { x: number; z: number }[]> = {};
    for (const variant of ['none', 'real', 'hostile'] as const) {
      const run = await runMatch({ floor: 'flat', seed: 'sep-held-up', device: 'held-up', scheme: 'arena', variant, ticks: 600 });
      intentsByVariant[variant] = run.coverage.intents;
      expect(run.camera.readsDuringTick).toBe(0);
      if (variant === 'real') expect(range(run.camera.yawsDeg), 'the camera must really move for this to prove anything').toBeGreaterThan(10);
    }
    const expected = screenToWorld(screenVectorFromDigital(true, false, false, false), WORLD_CONTROL_REFERENCE.yawRad(true));
    for (const [variant, intents] of Object.entries(intentsByVariant)) {
      expect(intents.length, variant).toBeGreaterThan(100);
      expect(
        intents.every((i) => i.x === expected.x && i.z === expected.z),
        `${variant}: moveIntent changed while the key was held`,
      ).toBe(true);
    }
  }, 120_000);

  it('opponent scheme: ↑ always points at the opponent (a function of the Beys\' positions) and a held key keeps tracking them while the camera orbits wildly', async () => {
    for (const variant of ['none', 'hostile'] as const) {
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
      scene.add(camera);
      let sessionRef: MatchSession | null = null;
      const setup = controlSetupFor('opponent', { session: () => sessionRef });
      const player = createPlayerControl(new HeldKey(Action.MoveForward), { directional: setup.directional, reference: setup.reference });
      const session = await MatchSession.create({
        scene,
        camera,
        seedText: 'sep-opponent-bearing',
        matchConfig: resolveMatchConfig({ arenaFloor: 'flat' }),
        attackProfileSettings: createDefaultAttackProfileSettings(),
        telemetry: new TelemetryRecorder(),
        stateMachine: new GameStateMachine(),
        controllers: { first: { kind: 'keyboard' }, second: { kind: 'ai', personality: 'archetype' } },
        keyboard: player,
        cameraRig: variant === 'none' ? null : makeHostileRig(),
      });
      sessionRef = session;
      let checked = 0;
      for (let t = 0; t < 300; t++) {
        const a = session.getBey('first').body.translation(); // positions BEFORE this tick's input is sampled
        const b = session.getBey('second').body.translation();
        session.tick();
        if (variant !== 'none') session.renderFrame(1 / 60, camera);
        const intent = session.getLastActions('first')?.moveIntent;
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        if (!intent || d < 0.5) continue;
        expect(intent.x, `${variant} tick ${t}`).toBeCloseTo((b.x - a.x) / d, 2);
        expect(intent.z, `${variant} tick ${t}`).toBeCloseTo((b.z - a.z) / d, 2);
        checked++;
      }
      session.dispose();
      expect(checked, variant).toBeGreaterThan(200);
    }
  }, 120_000);

  it("screen scheme (the owner's opt-in exception) is the ONLY scheme where the camera matters: with fresh gestures its path follows the camera, the other schemes' paths do not", async () => {
    const base = { floor: 'flat' as const, seed: 'sep-screen-exception', device: 'taps' as const, ticks: 600 };
    const screenNone = await runMatch({ ...base, scheme: 'screen', variant: 'none' });
    const screenReal = await runMatch({ ...base, scheme: 'screen', variant: 'real' });
    expect(range(screenReal.camera.yawsDeg)).toBeGreaterThan(10);
    expect(firstDivergence(screenNone, screenReal), 'the screen scheme is supposed to follow the camera; if it no longer does, update this test and the docs').not.toBeNull();
    for (const scheme of ['opponent', 'arena', 'classic'] as const) {
      const none = await runMatch({ ...base, scheme, variant: 'none' });
      const real = await runMatch({ ...base, scheme, variant: 'real' });
      expect(firstDivergence(none, real), scheme).toBeNull();
    }
  }, 180_000);
});

describe('C. offscreen rescue: the camera reframes itself, never the Bey', () => {
  const RESCUE_PERTURB: RunSpec['perturb'] = {
    // Test-induced gameplay change (identical in every run): fling the opponent to the arena rim and leave it there.
    120: (s) => {
      const body = s.getBey('second').body;
      body.setTranslation({ x: 8.5, y: body.translation().y, z: 8.5 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    },
    330: (s) => {
      const body = s.getBey('second').body;
      body.setTranslation({ x: -8.5, y: body.translation().y, z: 8.5 }, true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    },
  };

  it('a Bey ends up (nearly) out of frame: the real camera rescues the framing (eye/focus/FOV/distance/mode), gameplay is identical to having no camera', async () => {
    const runs = await runAll({ floor: 'flat', seed: 'sep-rescue', device: 'script', scheme: 'opponent', ticks: 600, perturb: RESCUE_PERTURB }, ['none', 'real', 'hostile']);
    const rescues = [...runs.real.camera.modifiers].filter((m) => m.startsWith('resgate'));
    expect(rescues, `the director never ran an offscreen rescue (modifiers seen: ${[...runs.real.camera.modifiers].join(' | ')})`).not.toEqual([]);
    expect(range(runs.real.camera.eyeDistances), 'rescue did not change the camera distance').toBeGreaterThan(0.5);
    expectIdentical(runs, 'none');
  }, 120_000);

  it('rig level: rescue changes eye/focus/FOV/distance and cannot touch the frame it observes', () => {
    const frame = (opponentX: number, tick: number): FightFrame => ({
      tick,
      time: tick / 60,
      first: { position: { x: 0, y: 0.2, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, speed: 0, airborne: false, attack: 'none', broken: false },
      second: { position: { x: opponentX, y: 0.2, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, speed: 0, airborne: false, attack: 'none', broken: false },
      intents: [],
      clashActive: false,
      clashProgress: 0,
      roundOver: false,
      ringOutIsFirst: null,
    } as unknown as FightFrame);
    const settled = new CameraRig('B');
    const rescued = new CameraRig('B');
    let calm = settled.tick(frame(3, 0), 1 / 60);
    let far = rescued.tick(frame(3, 0), 1 / 60);
    const deepFreeze = <T>(o: T): T => {
      Object.freeze(o);
      for (const v of Object.values(o as object)) if (typeof v === 'object' && v !== null) deepFreeze(v);
      return o;
    };
    const snapshotBefore: string[] = [];
    for (let t = 1; t < 240; t++) {
      calm = settled.tick(deepFreeze(frame(3, t)), 1 / 60);
      const f = deepFreeze(frame(14, t)); // far outside the calm framing; frozen so any write by the camera would throw
      snapshotBefore.push(JSON.stringify(f));
      far = rescued.tick(f, 1 / 60);
      expect(JSON.stringify(f), 'the rig mutated the frame it observed').toBe(snapshotBefore[snapshotBefore.length - 1]);
    }
    const moved = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    expect(moved(calm.eye, far.eye) + moved(calm.focus, far.focus) + Math.abs(calm.fov - far.fov) + Math.abs(calm.player.debug.distance - far.player.debug.distance), 'the far framing should differ from the calm one').toBeGreaterThan(1);
  });
});

describe('D. knockback follow: the camera follows the knocked Bey; the Bey follows physics only', () => {
  it('real knockback in a fight: identical knockback, velocities and positions with the camera on, off, frozen or hostile', async () => {
    // 'sep-knockback-3' since the owner audit (2026-10-04): 'sep-knockback' now lands one slow hit (speed scales an
    // attack's force since 0.26.0) too small for the follow context; '-3' lands two the camera follows. '-4' since 0.56.0 (the AI
    // rides the rails through gates, so every AI fight changed): '-3' no longer lands a hit the camera follows.
    const runs = await runAll({ floor: 'flat', seed: 'sep-knockback-4', device: 'script', scheme: 'opponent', ticks: 1200 }, ['none', 'static', 'real', 'hostile']);
    expect(runs.none.coverage.knockback, 'no knockback happened in this fight — the test would prove nothing').toBe(true);
    expect([...runs.real.camera.modifiers].some((m) => m.startsWith('knockback follow')), `KnockbackFollow never engaged (modifiers: ${[...runs.real.camera.modifiers].join(' | ')})`).toBe(true);
    expectIdentical(runs, 'none');
  }, 180_000);
});

describe('E. crossing / side switching: the Beys are never adjusted', () => {
  it('the Beys swap sides repeatedly (identical teleports in every run): the camera may switch side / rescue; gameplay is identical', async () => {
    const swap = (s: MatchSession): void => {
      const a = s.getBey('first').body;
      const b = s.getBey('second').body;
      const pa = a.translation();
      const pb = b.translation();
      a.setTranslation({ x: pb.x, y: pa.y, z: pb.z }, true);
      b.setTranslation({ x: pa.x, y: pb.y, z: pa.z }, true);
    };
    const perturb: Record<number, (s: MatchSession) => void> = {};
    for (let t = 90; t < 700; t += 90) perturb[t] = swap;
    const runs = await runAll({ floor: 'flat', seed: 'sep-crossing', device: 'script', scheme: 'opponent', ticks: 700, perturb }, ['none', 'real', 'hostile']);
    expect(range(runs.real.camera.yawsDeg), 'the camera never reacted to the crossings').toBeGreaterThan(10);
    expectIdentical(runs, 'none');
  }, 120_000);
});

describe('F. camera settings invariance: preset A/B/C, effects on/off, aspect ratio, overview — same input + same seed ⇒ same gameplay', () => {
  it('every preset × effects combination, plus a very wide and a very tall window, matches the no-camera baseline', async () => {
    const base = { floor: 'flat' as const, seed: 'sep-settings', device: 'script' as const, scheme: 'opponent' as const, ticks: 600 };
    const baseline = await runMatch({ ...base, variant: 'none' });
    expect(baseline.coverage.moves).toBe(true);
    for (const preset of PRESET_IDS) {
      for (const effects of [true, false]) {
        for (const aspect of [16 / 9, 0.45, 3.5]) {
          const run = await runMatch({ ...base, variant: 'real', churn: false, fixed: { preset, effects, aspect } });
          expect(firstDivergence(baseline, run), `preset ${preset}, effects ${effects}, aspect ${aspect.toFixed(2)}`).toBeNull();
          expect(run.camera.readsDuringTick).toBe(0);
        }
      }
    }
    const overview = await runMatch({ ...base, variant: 'real', churn: false, fixed: { view: 'overview' } });
    expect(firstDivergence(baseline, overview), 'debug overview view').toBeNull();
  }, 240_000);
});

describe('G. render disabled: with and without render/camera the gameplay hash is identical', () => {
  it('no camera and no renderFrame() at all vs the real camera rendering every frame: identical per-tick state hash', async () => {
    const base = { floor: 'flat' as const, seed: 'sep-render', device: 'script' as const, scheme: 'opponent' as const, ticks: TICKS };
    const headless = await runMatch({ ...base, variant: 'none', renders: false });
    const rendered = await runMatch({ ...base, variant: 'real', renders: true });
    expect(headless.camera.yawsDeg).toEqual([]);
    expect(range(rendered.camera.yawsDeg)).toBeGreaterThan(10);
    expect(rendered.records.map((r) => r.hash)).toEqual(headless.records.map((r) => r.hash));
    expect(firstDivergence(headless, rendered)).toBeNull();
  }, 120_000);
});
