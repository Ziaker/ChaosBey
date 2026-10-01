// ============================================================
// TWIN SIMULATION TEST (owner playtest "Fix 6", 2026-09-30) — permanent
// regression test, more rigorous than directionalCameraIndependenceIntegration
// .test.ts's checks: those only proved moveIntent doesn't change with camera
// yaw. This proves the camera has ZERO effect on the final gameplay
// EXPERIENCE by running the exact same fight twice — identical seed, Bey,
// arena, human input script and AI opponent, identical tick count — once
// with the render camera frozen at its very first tick's pose ("static"),
// once with the real CameraRig orbiting normally ("dynamic") — and
// diffing, tick by tick, every field the player experiences: actions,
// heading, turn rate, acceleration, velocity, position, grounded state,
// drift state, and the canonical physics/state hash. The camera output
// itself is the only field allowed to differ.
//
// This is possible without touching CameraDirector/CameraRig at all: the
// render camera is ticked as a pure side effect of MatchSession.tick()
// (tickCameraAndVfx, called AFTER gameplay physics for the tick is
// final) and its output only ever populates getLastCameraOutput() — no
// gameplay code reads it back (see the architectural boundary test,
// inputCameraBoundary.test.ts). So this test freezes CameraRig.tick with
// a plain spy (real production code, unmodified) for the "static" run and
// restores it for the "dynamic" run, and expects the frozen run's actual
// camera yaw to barely move while the dynamic run's genuinely orbits — the
// two runs prove the freeze/unfreeze setup itself is doing something real,
// not just trivially passing.
// ============================================================

import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { CameraRig, type CameraRigOutput } from '../../src/camera/director/CameraRig';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';
import type { ArenaFloorId } from '../../src/arena/floor/ArenaFloorProfile';

/**
 * A busy, fully deterministic (tick-index-only, no randomness) human input
 * script: cycles through steer/throttle combinations, an attack charge, a
 * jump/drift hold and a dodge, so the run actually exercises momentum,
 * grip/slip, drift and knockback recovery — not just a single held key.
 */
class ScriptedPlayer implements CombatController {
  private tick = 0;
  sampleActions(): ControllerActions {
    const t = this.tick++;
    const phase = Math.floor(t / 37) % 8;
    const held = new Set<Action>(
      [
        [Action.MoveForward],
        [Action.MoveForward, Action.SteerRight],
        [Action.SteerRight],
        [Action.MoveForward, Action.JumpDrift],
        [Action.MoveBackward, Action.SteerLeft],
        [Action.SteerLeft],
        [Action.MoveForward, Action.Attack],
        [Action.Dodge],
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

interface TickSnapshot {
  readonly tick: number;
  readonly held: readonly string[];
  readonly moveIntent: { x: number; z: number } | null;
  readonly headingRad: number;
  readonly turnRateRadPerS: number;
  readonly acceleration: { x: number; y: number; z: number };
  readonly velocity: { x: number; y: number; z: number };
  readonly position: { x: number; y: number; z: number };
  readonly grounded: boolean;
  readonly driftState: string;
  readonly stateHash: string;
}

async function createTwinSession(arenaFloor: ArenaFloorId, seedText: string) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  scene.add(camera);
  const session = await MatchSession.create({
    scene,
    camera,
    seedText,
    matchConfig: resolveMatchConfig({ arenaFloor }),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers: { first: { kind: 'keyboard' }, second: { kind: 'ai', personality: 'archetype' } },
    keyboard: new ScriptedPlayer(), // Classic (default, no DirectionalController wrapper): the raw held actions drive MovementController's Bey-relative path directly.
  });
  return { session, camera };
}

async function runTwinSimulation(arenaFloor: ArenaFloorId, seedText: string, ticks: number, cameraMode: 'static' | 'dynamic'): Promise<{ snapshots: TickSnapshot[]; cameraYawsDeg: number[] }> {
  const restore: (() => void)[] = [];
  if (cameraMode === 'static') {
    const original = CameraRig.prototype.tick;
    let frozen: CameraRigOutput | null = null;
    const spy = vi.spyOn(CameraRig.prototype, 'tick').mockImplementation(function (this: CameraRig, frame, dt): CameraRigOutput {
      // The render camera's very first computed pose, held fixed for the
      // rest of the run — a real CameraRig output shape, just never
      // updated again, so it never orbits.
      frozen ??= original.call(this, frame, dt);
      return frozen;
    });
    restore.push(() => spy.mockRestore());
  }

  const { session, camera } = await createTwinSession(arenaFloor, seedText);
  const snapshots: TickSnapshot[] = [];
  const cameraYawsDeg: number[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    session.tick();
    session.renderFrame(1 / 60, camera);
    const bey = session.getBey('first');
    const snapshot = session.getLastResult()?.first ?? null;
    const actions = session.getLastActions('first');
    const movementDebug = bey.movement.getDebugState();
    const accel = session.getLastAcceleration('first');
    const v = bey.body.linvel();
    const p = bey.body.translation();
    snapshots.push({
      tick,
      held: [...(actions?.held ?? [])],
      moveIntent: actions?.moveIntent ?? null,
      headingRad: bey.movement.getHeadingRad(),
      turnRateRadPerS: movementDebug.turnRateRadPerS,
      acceleration: { x: accel.x, y: accel.y, z: accel.z },
      velocity: { x: v.x, y: v.y, z: v.z },
      position: { x: p.x, y: p.y, z: p.z },
      grounded: snapshot?.grounded ?? false,
      driftState: snapshot?.driftState ?? 'unknown',
      stateHash: session.getStateHash(),
    });
    cameraYawsDeg.push(session.getLastCameraOutput()?.yawDeg ?? 0);
    if (session.roundState.result !== 'Ongoing') break;
  }
  session.dispose();
  for (const r of restore) r();
  return { snapshots, cameraYawsDeg };
}

describe('Twin Simulation Test: static vs. dynamic camera never diverges the player\'s gameplay (owner playtest "Fix 6")', () => {
  for (const arenaFloor of ['flat', 'bowl-a', 'bowl-b', 'bowl-c'] as const) {
    it(`${arenaFloor}: every tick's player actions/heading/turn rate/acceleration/velocity/position/grounded/drift/state-hash are identical whether the camera is frozen or orbiting freely`, async () => {
      const seedText = `twin-sim-${arenaFloor}`;
      const TICKS = 900; // 15 s at 60 Hz — enough real combat to touch drift, knockback and jump along the way.

      // Sequential, not Promise.all: "static" mode spies on
      // CameraRig.prototype.tick (a PROTOTYPE-level mock, shared by every
      // instance) for the whole span from before its first await to its
      // own loop's end. Run concurrently, if "dynamic"'s own async setup
      // happens to resolve and run its (fully synchronous) tick loop while
      // that spy is still installed — a real race, observed under full
      // test-suite load — the "dynamic" camera gets silently frozen too,
      // reading a false 0° yaw range. One run fully finishing before the
      // next starts removes the race entirely.
      const staticRun = await runTwinSimulation(arenaFloor, seedText, TICKS, 'static');
      const dynamicRun = await runTwinSimulation(arenaFloor, seedText, TICKS, 'dynamic');

      // The setup itself must be real: the "static" run's camera barely
      // moved, the "dynamic" run's genuinely orbited. Otherwise a pass below
      // would prove nothing.
      const staticYawRange = Math.max(...staticRun.cameraYawsDeg) - Math.min(...staticRun.cameraYawsDeg);
      const dynamicYawRange = Math.max(...dynamicRun.cameraYawsDeg) - Math.min(...dynamicRun.cameraYawsDeg);
      expect(staticYawRange, 'the "static" run camera moved — the freeze did not take effect').toBeLessThan(0.001);
      expect(dynamicYawRange, 'the "dynamic" run camera never moved — this run does not actually exercise independence').toBeGreaterThan(10);

      // Same seed, same scripted input, same AI: both runs must simulate
      // for the same number of ticks (a real divergence would usually also
      // show up as an early/late round end).
      expect(dynamicRun.snapshots.length).toBe(staticRun.snapshots.length);

      const mismatches: { tick: number; field: string; static: unknown; dynamic: unknown }[] = [];
      const FIELDS: (keyof TickSnapshot)[] = ['held', 'moveIntent', 'headingRad', 'turnRateRadPerS', 'acceleration', 'velocity', 'position', 'grounded', 'driftState', 'stateHash'];
      for (let i = 0; i < staticRun.snapshots.length; i++) {
        const a = staticRun.snapshots[i]!;
        const b = dynamicRun.snapshots[i]!;
        for (const field of FIELDS) {
          const av = JSON.stringify(a[field]);
          const bv = JSON.stringify(b[field]);
          if (av !== bv) mismatches.push({ tick: i, field, static: a[field], dynamic: b[field] });
        }
      }
      expect(mismatches, `gameplay diverged between the static-camera and dynamic-camera runs: ${JSON.stringify(mismatches.slice(0, 10), null, 2)}${mismatches.length > 10 ? `\n… and ${mismatches.length - 10} more` : ''}`).toEqual([]);
    }, 60_000);
  }
});
