// ============================================================
// PLAYER CONTROL SCHEME — 6 HUMAN CONTROL SCENARIOS (owner playtest
// "Fix 6", 2026-09-30)
//
// These scenarios prove that a LIVE automatic CameraRig may run alongside
// Classic/Bey-relative movement without altering movement, spin, drift or
// post-knockback recovery. The previous version additionally required the
// camera yaw to sweep >15° during every synthetic scenario. That was a
// useful anti-vacuity check while the old camera intentionally chased the
// player→opponent axis; it is now the behaviour the Inertial Duel Camera is
// specifically designed to avoid. Anti-vacuity is instead: the real rig is
// instantiated and ticked every step, while the stronger hostile/static/
// null/real runtime proof remains in cameraGameplaySeparation.test.ts.
//
// Scenario 6 (Flat + Bowl A/B/C) is covered by
// cameraGameplaySeparation.test.ts, which runs its full comparison on the
// flat floor and several bowls; TestBeyHarness here always spawns on the
// flat floor, so it is not duplicated in this file.
// ============================================================

import { describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Action, type ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import { BEY_SPAWN_HEIGHT_M } from '../../src/bey/core/BeyTuning';
import { CameraRig } from '../../src/camera/director/CameraRig';
import { PRESET_IDS, type PresetId } from '../../src/camera/director/CameraParams';
import type { FightFrame } from '../../src/camera/director/FightFrame';
import { TestBeyHarness, type TickResult } from './physicsHarness';

function classic(heldActions: Action[]): ControllerActions {
  return { held: new Set(heldActions), pressedThisFrame: new Set(), attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
}

/**
 * Wraps a per-tick held-actions function with real pressedThisFrame tracking.
 * A fresh independent generator is used for each parallel run.
 */
function heldSequence(heldAt: (tick: number) => Action[]): (tick: number) => ControllerActions {
  let previous = new Set<Action>();
  return (tick: number) => {
    const held = new Set(heldAt(tick));
    const pressedThisFrame = new Set([...held].filter((a) => !previous.has(a)));
    previous = held;
    return { held, pressedThisFrame, attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
  };
}

interface ScenarioRun {
  readonly results: TickResult[];
  readonly positions: { x: number; y: number; z: number }[];
  readonly cameraYawsDeg: number[];
}

/**
 * Drives a fresh TestBeyHarness for `ticks` steps, optionally advancing the
 * real CameraRig alongside it every tick. The synthetic opponent deliberately
 * circles quickly; with the Inertial Duel Camera that motion is allowed to
 * cross the screen without obliging the world to rotate. What matters here is
 * that the rig is genuinely active and gameplay is byte-for-byte identical.
 */
async function runScenario(
  actionsFor: (tick: number) => ControllerActions,
  ticks: number,
  preset: PresetId | null,
  midStepEffectAt?: (tick: number) => ((body: RAPIER.RigidBody) => void) | undefined,
): Promise<ScenarioRun> {
  const harness = await TestBeyHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 });
  harness.tickMany(classic([]), 30);
  const rig = preset ? new CameraRig(preset) : null;
  const results: TickResult[] = [];
  const positions: { x: number; y: number; z: number }[] = [];
  const cameraYawsDeg: number[] = [];
  for (let t = 0; t < ticks; t++) {
    results.push(harness.tick(actionsFor(t), midStepEffectAt?.(t)));
    const p = harness.beyBody.translation();
    positions.push({ x: p.x, y: p.y, z: p.z });
    if (rig) {
      const angle = (t / 45) * Math.PI * 2;
      const frame: FightFrame = {
        tick: t,
        time: t / 60,
        first: { position: { x: p.x, y: p.y, z: p.z }, velocity: { x: 0, y: 0, z: 0 }, speed: 0, airborne: false, attack: 'none', broken: false },
        second: { position: { x: p.x + 6 * Math.cos(angle), y: p.y, z: p.z + 6 * Math.sin(angle) }, velocity: { x: 0, y: 0, z: 0 }, speed: 0, airborne: false, attack: 'none', broken: false },
        intents: [],
        clashActive: false,
        clashProgress: 0,
        roundOver: false,
        ringOutIsFirst: null,
      };
      cameraYawsDeg.push(rig.tick(frame, FIXED_DELTA_SECONDS).player.debug.yawDeg);
    }
  }
  return { results, positions, cameraYawsDeg };
}

function expectLiveCamera(run: ScenarioRun, ticks: number): void {
  expect(run.cameraYawsDeg).toHaveLength(ticks);
  expect(run.cameraYawsDeg.every(Number.isFinite), 'live camera produced a non-finite yaw').toBe(true);
}

/** Strips pure floating-point objects into JSON-comparable values for a compact per-tick diff. */
function diffTicks(withCam: ScenarioRun, withoutCam: ScenarioRun): { tick: number; field: string }[] {
  const mismatches: { tick: number; field: string }[] = [];
  for (let i = 0; i < withCam.results.length; i++) {
    const a = withCam.results[i]!;
    const b = withoutCam.results[i]!;
    if (JSON.stringify(a.movement) !== JSON.stringify(b.movement)) mismatches.push({ tick: i, field: 'movement' });
    if (JSON.stringify(a.spin) !== JSON.stringify(b.spin)) mismatches.push({ tick: i, field: 'spin' });
    if (a.grounded !== b.grounded) mismatches.push({ tick: i, field: 'grounded' });
    if (a.driftState !== b.driftState) mismatches.push({ tick: i, field: 'driftState' });
    if (JSON.stringify(withCam.positions[i]) !== JSON.stringify(withoutCam.positions[i])) mismatches.push({ tick: i, field: 'position' });
  }
  return mismatches;
}

describe('Scenario 1: hold ↑ while the active automatic camera observes — zero throttle change caused by presentation', () => {
  for (const preset of PRESET_IDS) {
    it(`preset ${preset}: identical acceleration/velocity/position with the live CameraRig or no camera`, async () => {
      const ticks = 180;
      const actionsFor = () => classic([Action.MoveForward]);
      const [withCam, withoutCam] = await Promise.all([runScenario(actionsFor, ticks, preset), runScenario(actionsFor, ticks, null)]);
      expectLiveCamera(withCam, ticks);
      expect(diffTicks(withCam, withoutCam)).toEqual([]);
      expect(withoutCam.results.at(-1)!.movement.speedMps).toBeGreaterThan(1);
    });
  }
});

describe('Scenario 2: hold ↑+→ while the active camera recomposes — steering remains Bey-relative', () => {
  for (const preset of PRESET_IDS) {
    it(`preset ${preset}: identical heading/turn-rate curve with the live CameraRig or no camera`, async () => {
      const ticks = 200;
      const actionsFor = () => classic([Action.MoveForward, Action.SteerRight]);
      const [withCam, withoutCam] = await Promise.all([runScenario(actionsFor, ticks, preset), runScenario(actionsFor, ticks, null)]);
      expectLiveCamera(withCam, ticks);
      expect(diffTicks(withCam, withoutCam)).toEqual([]);
      expect(Math.abs(withoutCam.results.at(-1)!.movement.headingRad)).toBeGreaterThan(0.5);
    });
  }
});

describe('Scenario 3: rapidly alternate ←/→ while the active camera observes — no stale intent or inversion', () => {
  for (const preset of PRESET_IDS) {
    it(`preset ${preset}: identical heading/turn-rate sequence, alternating every 3 ticks`, async () => {
      const ticks = 210;
      const actionsFor = (t: number) => classic([Math.floor(t / 3) % 2 === 0 ? Action.SteerRight : Action.SteerLeft]);
      const [withCam, withoutCam] = await Promise.all([runScenario(actionsFor, ticks, preset), runScenario(actionsFor, ticks, null)]);
      expectLiveCamera(withCam, ticks);
      expect(diffTicks(withCam, withoutCam)).toEqual([]);
    });
  }
});

describe('Scenario 4: drift (Jump/Drift + steering) — camera composition is irrelevant to the Bey state', () => {
  for (const preset of PRESET_IDS) {
    it(`preset ${preset}: identical drift state/movement/spin sequence with the live CameraRig or no camera`, async () => {
      const ticks = 150;
      const heldAt = (t: number) => (t < 30 ? [Action.MoveForward] : t < 90 ? [Action.MoveForward, Action.JumpDrift, Action.SteerRight] : [Action.MoveForward, Action.SteerRight]);
      const [withCam, withoutCam] = await Promise.all([runScenario(heldSequence(heldAt), ticks, preset), runScenario(heldSequence(heldAt), ticks, null)]);
      expectLiveCamera(withCam, ticks);
      expect(diffTicks(withCam, withoutCam)).toEqual([]);
      expect(withoutCam.results.some((r) => r.driftState !== withoutCam.results[0]!.driftState)).toBe(true);
    });
  }
});

describe('Scenario 5: knockback and recovery — camera observation never changes recovered control semantics', () => {
  for (const preset of PRESET_IDS) {
    it(`preset ${preset}: identical post-impact movement/spin/position with the live CameraRig or no camera`, async () => {
      const ticks = 180;
      const actionsFor = (t: number) => (t < 40 ? classic([Action.MoveForward]) : classic([Action.MoveForward, Action.SteerRight]));
      const applyImpulseAt = 40;
      const midStepEffectAt = (t: number) => (t === applyImpulseAt ? (body: RAPIER.RigidBody) => body.applyImpulse({ x: 6, y: 1.5, z: -4 }, true) : undefined);
      const [withCam, withoutCam] = await Promise.all([runScenario(actionsFor, ticks, preset, midStepEffectAt), runScenario(actionsFor, ticks, null, midStepEffectAt)]);
      expectLiveCamera(withCam, ticks);
      expect(diffTicks(withCam, withoutCam)).toEqual([]);
      expect(withoutCam.results[applyImpulseAt]!.movement.impactDeltaSpeedMps).toBeGreaterThan(0);
      expect(withoutCam.results.at(-1)!.movement.headingRad).toBeGreaterThan(0);
    });
  }
});
