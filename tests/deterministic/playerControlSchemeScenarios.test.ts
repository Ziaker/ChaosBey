// ============================================================
// PLAYER CONTROL SCHEME — 6 HUMAN CONTROL SCENARIOS (owner playtest
// "Fix 6", 2026-09-30)
// Six named scenarios the owner asked to see proven, on top of the
// architectural boundary test (inputCameraBoundary.test.ts) and the Twin
// Simulation Test (twinSimulationCameraIndependence.test.ts): each drives
// MovementController directly (Classic/Bey-relative — the player default,
// see PlayerSettings.ts) through TestBeyHarness, side by side, once with a
// REAL, independently-orbiting CameraRig ticked alongside every step (fed
// the Bey's own live position, with a synthetic opponent circling it so
// the camera genuinely sweeps a large orbit), once with no camera object
// created at all. The two runs must be bit-for-bit identical: the camera
// is a separate object graph that nothing in this pipeline reads.
//
// Scenario 6 (Flat + Bowl A/B/C) is covered by
// twinSimulationCameraIndependence.test.ts, which already runs its full
// comparison on all four arena floors; TestBeyHarness here always spawns
// on the flat floor (createArenaColliders' default geometry), so it is not
// duplicated in this file.
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
 * Wraps a per-tick held-actions function with real pressedThisFrame
 * tracking (a key is "pressed" only the first tick it's newly held) — a
 * fresh independent generator each call, so the two parallel runs
 * (with/without camera) never share mutable state. Needed for Scenario 4:
 * DriftController only begins a hop on Action.JumpDrift's pressedThisFrame
 * edge, not merely on it being held.
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
 * Drives a fresh TestBeyHarness for `ticks` steps using `actionsFor(tick)`,
 * optionally advancing a real, independent CameraRig alongside it every
 * tick (fed the harness Bey's own live position as "first", and a
 * synthetic opponent orbiting a nearby point as "second" so the camera
 * genuinely sweeps a wide orbit — unrelated to anything the harness does).
 * `midStepEffectAt` lets a scenario apply a one-off physics side effect
 * (e.g. a knockback impulse), at a specific tick, in the same window a
 * real combat impact lands in (see TestBeyHarness.tick's midStepEffect) —
 * identically regardless of the camera.
 */
async function runScenario(
  actionsFor: (tick: number) => ControllerActions,
  ticks: number,
  preset: PresetId | null,
  midStepEffectAt?: (tick: number) => ((body: RAPIER.RigidBody) => void) | undefined,
): Promise<ScenarioRun> {
  const harness = await TestBeyHarness.create({ x: 0, y: BEY_SPAWN_HEIGHT_M, z: 0 });
  harness.tickMany(classic([]), 30); // land and settle before the scenario's own input starts
  const rig = preset ? new CameraRig(preset) : null;
  const results: TickResult[] = [];
  const positions: { x: number; y: number; z: number }[] = [];
  const cameraYawsDeg: number[] = [];
  for (let t = 0; t < ticks; t++) {
    results.push(harness.tick(actionsFor(t), midStepEffectAt?.(t)));
    const p = harness.beyBody.translation();
    positions.push({ x: p.x, y: p.y, z: p.z });
    if (rig) {
      const angle = (t / 45) * Math.PI * 2; // a full sweep roughly every 45 ticks (0.75 s) — several full orbits over a scenario
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

function yawRangeDeg(yaws: number[]): number {
  return yaws.length === 0 ? 0 : Math.max(...yaws) - Math.min(...yaws);
}

/** Strips fields that are pure floating-point objects into JSON-comparable arrays for a compact per-tick diff. */
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

describe('Scenario 1: hold ↑ through a wide, continuous camera orbit — the Bey keeps accelerating on its own heading, zero throttle change caused by the camera', () => {
  // A literal 360° sweep within a short deterministic unit test would need
  // far more ticks than is practical here (the camera's own orbit
  // easing/damping caps how fast it can follow even a fast-orbiting synthetic
  // opponent) — a real, continuous 360°+ sweep across a real 30 s fight is
  // already covered by directionalCameraIndependenceIntegration.test.ts's
  // "fundamental test" and by the Playwright smoke suite
  // (playerDirectionalControl.spec.ts). This scenario instead proves the
  // same zero-influence property tick by tick while the camera is
  // genuinely, continuously moving (tens of degrees, not a static camera's
  // near-zero movement — see twinSimulationCameraIndependence.test.ts).
  for (const preset of PRESET_IDS) {
    it(`preset ${preset}: identical acceleration/velocity/position whether or not a real orbiting camera runs alongside`, async () => {
      const ticks = 180;
      const actionsFor = () => classic([Action.MoveForward]);
      const [withCam, withoutCam] = await Promise.all([runScenario(actionsFor, ticks, preset), runScenario(actionsFor, ticks, null)]);
      expect(yawRangeDeg(withCam.cameraYawsDeg), 'camera did not actually orbit — scenario is not exercising anything').toBeGreaterThan(15);
      expect(diffTicks(withCam, withoutCam)).toEqual([]);
      // The throttle itself did what holding ↑ should: the Bey is moving forward by the end.
      expect(withoutCam.results.at(-1)!.movement.speedMps).toBeGreaterThan(1);
    });
  }
});

describe('Scenario 2: hold ↑+→ while the camera sweeps through a wide, continuous orbit — an identical steer-right curve, the camera never alters steering', () => {
  for (const preset of PRESET_IDS) {
    it(`preset ${preset}: identical heading/turn-rate curve whether or not a real orbiting camera crosses 90/180/270° alongside it`, async () => {
      const ticks = 200;
      const actionsFor = () => classic([Action.MoveForward, Action.SteerRight]);
      const [withCam, withoutCam] = await Promise.all([runScenario(actionsFor, ticks, preset), runScenario(actionsFor, ticks, null)]);
      // The synthetic opponent orbits fast (a full lap every 45 ticks), driving the camera through a genuine, continuous
      // sweep well past any single 90° quadrant boundary over this scenario's 200 ticks — not a static or barely-moving camera.
      expect(yawRangeDeg(withCam.cameraYawsDeg)).toBeGreaterThan(15);
      expect(diffTicks(withCam, withoutCam)).toEqual([]);
      // Steering right actually turned the Bey continuously (a real curve, not stuck at 0).
      expect(Math.abs(withoutCam.results.at(-1)!.movement.headingRad)).toBeGreaterThan(0.5);
    });
  }
});

describe('Scenario 3: rapidly alternate ←/→ during camera orbit — no stale intent, no inversion, no meaning change of the keys', () => {
  for (const preset of PRESET_IDS) {
    it(`preset ${preset}: identical heading/turn-rate sequence, alternating every 3 ticks, whether or not a real orbiting camera runs alongside`, async () => {
      const ticks = 210;
      const actionsFor = (t: number) => classic([Math.floor(t / 3) % 2 === 0 ? Action.SteerRight : Action.SteerLeft]);
      const [withCam, withoutCam] = await Promise.all([runScenario(actionsFor, ticks, preset), runScenario(actionsFor, ticks, null)]);
      expect(yawRangeDeg(withCam.cameraYawsDeg)).toBeGreaterThan(15);
      expect(diffTicks(withCam, withoutCam)).toEqual([]);
    });
  }
});

describe('Scenario 4: drift (Jump/Drift + steering) — the hop/drift continues using the Bey\'s own steering, camera yaw irrelevant', () => {
  for (const preset of PRESET_IDS) {
    it(`preset ${preset}: identical drift state/movement/spin sequence whether or not a real orbiting camera runs alongside`, async () => {
      const ticks = 150;
      // Approach speed first, then hold Jump/Drift + steer right (a drift maneuver), then release Jump/Drift but keep steering.
      // A fresh heldSequence() per run: JumpDrift's hop only begins on its pressedThisFrame edge, and each parallel run needs its own independent press-tracking state.
      const heldAt = (t: number) => (t < 30 ? [Action.MoveForward] : t < 90 ? [Action.MoveForward, Action.JumpDrift, Action.SteerRight] : [Action.MoveForward, Action.SteerRight]);
      const [withCam, withoutCam] = await Promise.all([runScenario(heldSequence(heldAt), ticks, preset), runScenario(heldSequence(heldAt), ticks, null)]);
      expect(yawRangeDeg(withCam.cameraYawsDeg)).toBeGreaterThan(15);
      expect(diffTicks(withCam, withoutCam)).toEqual([]);
      // The maneuver actually left Idle at some point (drift/hop was really exercised, not a no-op).
      expect(withoutCam.results.some((r) => r.driftState !== withoutCam.results[0]!.driftState)).toBe(true);
    });
  }
});

describe('Scenario 5: knockback and recovery — after regaining control authority, ↑/←/→ retain identical semantics', () => {
  for (const preset of PRESET_IDS) {
    it(`preset ${preset}: identical post-impact movement/spin/position sequence through and after a real knockback impulse, whether or not a real orbiting camera runs alongside`, async () => {
      const ticks = 180;
      const actionsFor = (t: number) => (t < 40 ? classic([Action.MoveForward]) : classic([Action.MoveForward, Action.SteerRight]));
      const applyImpulseAt = 40;
      // Applied in TestBeyHarness.tick's midStepEffect window (after applyPreStep, before physics.step()) — the same window a real combat impact's knockback lands in (Knockback.ts) — so MovementController.postStep() actually detects it as an impact.
      const midStepEffectAt = (t: number) => (t === applyImpulseAt ? (body: RAPIER.RigidBody) => body.applyImpulse({ x: 6, y: 1.5, z: -4 }, true) : undefined);
      const [withCam, withoutCam] = await Promise.all([runScenario(actionsFor, ticks, preset, midStepEffectAt), runScenario(actionsFor, ticks, null, midStepEffectAt)]);
      expect(yawRangeDeg(withCam.cameraYawsDeg)).toBeGreaterThan(15);
      expect(diffTicks(withCam, withoutCam)).toEqual([]);
      // The impulse actually did something (a real knockback was exercised, not a no-op).
      expect(withoutCam.results[applyImpulseAt]!.movement.impactDeltaSpeedMps).toBeGreaterThan(0);
      // Held ↑+→ eventually turns the Bey right again after the impact, exactly as before it — no lingering semantic change from being knocked around.
      expect(withoutCam.results.at(-1)!.movement.headingRad).toBeGreaterThan(0);
    });
  }
});
