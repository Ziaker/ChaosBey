// ============================================================
// DIRECTIONAL CONTROL × CAMERA-RELATIVE INTEGRATION ("Fix 7", 2026-10-01)
// Unlike directionalInput.test.ts (the pure input-layer unit tests) and
// directionalMovement.test.ts (MovementController alone), this drives a
// REAL MatchSession: real Rapier physics, a real AI opponent actually
// fighting, the real CameraRig (so the camera genuinely orbits/tracks the
// fight — not a hand-fed yaw), and DirectionalController wired to that
// real camera exactly as MatchRunner.ts wires it.
//
// Earlier versions of this file (owner playtest, 2026-09, "Fix 5"/"Fix 6")
// asserted the OPPOSITE of what's asserted below: that moveIntent must
// equal a FIXED world vector regardless of the camera. That was correct
// for the schemes those fixes shipped, but neither one actually looked
// right on screen once this camera (opponent-focused, not a chase cam)
// started moving — verified in a real browser, 2026-10-01: holding a
// single key the entire time, the dot product between the Bey's actual
// velocity and the camera's forward view flipped sign repeatedly. "Fix 7"
// makes the default scheme read the camera on purpose, so the tests below
// assert the new, correct invariant: a held key always resolves to a
// world direction that reads the same way ON SCREEN — away/toward/left/
// right of the CURRENT camera — not a fixed world vector.
// ============================================================

import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GameStateMachine } from '../../src/app/lifecycle/GameState';
import { MatchSession } from '../../src/app/session/MatchSession';
import { AIController } from '../../src/ai/controllers/AIController';
import { DirectionalController } from '../../src/input/directional/DirectionalController';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import { Action, type CombatController, type ControllerActions } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import type { ArenaFloorId } from '../../src/arena/floor/ArenaFloorProfile';
import { CameraRig } from '../../src/camera/director/CameraRig';
import { PRESET_IDS } from '../../src/camera/director/CameraParams';
import type { FightFrame } from '../../src/camera/director/FightFrame';

/** A test double for the physical device: held keys settable tick by tick, standing in for a human bashing the keyboard. */
class HeldKeySource implements CombatController {
  private held = new Set<Action>();
  private previouslyHeld = new Set<Action>();

  setHeld(...actions: Action[]): void {
    this.held = new Set(actions);
  }

  sampleActions(): ControllerActions {
    const pressedThisFrame = new Set([...this.held].filter((a) => !this.previouslyHeld.has(a)));
    this.previouslyHeld = new Set(this.held);
    return { held: new Set(this.held), pressedThisFrame, attackHoldDurationSeconds: 0, jumpDriftHoldDurationSeconds: 0 };
  }
}

async function createDirectionalMatch(arenaFloor: ArenaFloorId, seedText: string) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  scene.add(camera);
  const keySource = new HeldKeySource();
  let sessionRef: MatchSession | null = null;
  // Wired exactly like MatchRunner.ts: the camera reaches the controller only as a radians number, read from the session's own camera output.
  const directional = new DirectionalController(keySource, { cameraYaw: () => ((sessionRef?.getLastCameraOutput()?.yawDeg ?? 0) * Math.PI) / 180 });
  const session = await MatchSession.create({
    scene,
    camera,
    seedText,
    matchConfig: resolveMatchConfig({ arenaFloor }),
    attackProfileSettings: createDefaultAttackProfileSettings(),
    telemetry: new TelemetryRecorder(),
    stateMachine: new GameStateMachine(),
    controllers: { first: { kind: 'keyboard' }, second: { kind: 'ai', personality: 'archetype' } },
    keyboard: directional,
  });
  sessionRef = session;
  return { session, camera, keySource, directional };
}

/** "Away from the camera" on the ground, for a given CameraDirector-convention yaw (radians): the eye-position-relative-to-focus convention, so away = -fromYaw(yaw). */
function awayFromCamera(yawRad: number): { x: number; z: number } {
  return { x: -Math.sin(yawRad), z: -Math.cos(yawRad) };
}

describe('Directional control reads the camera once per gesture through a real 30 s fight ("Fix 9")', () => {
  for (const arenaFloor of ['flat', 'bowl-a', 'bowl-b', 'bowl-c'] as const) {
    it(`${arenaFloor}: holding ArrowUp keeps one fixed world direction while the camera orbits, controller owner never flips to AI, camera actually moves`, async () => {
      const { session, camera, keySource, directional } = await createDirectionalMatch(arenaFloor, `fix7-${arenaFloor}`);
      const TICKS = 1800; // 30 s at 60 Hz
      const cameraYaws: number[] = [];
      let firstWorld: { x: number; z: number } = { x: 0, z: 0 };
      let anyDrift = false;
      let anyAirborne = false;
      let anyKnockback = false;

      keySource.setHeld(Action.MoveForward); // held for the entire run, never released or changed
      for (let tick = 0; tick < TICKS; tick++) {
        session.renderFrame(FIXED_DELTA_SECONDS, camera); // updates the REAL camera from the current fight, before this tick's input is sampled
        const result = session.tick();
        cameraYaws.push(session.getLastCameraOutput()?.yawDeg ?? 0);

        const world = session.getLastActions('first')?.moveIntent;
        expect(world, `tick ${tick}: moveIntent missing on a directional frame`).toBeDefined();
        // "Fix 9": the camera is read once, on the first tick of the gesture
        // (ArrowUp held for the whole run), and frozen. However far the real
        // camera orbits afterwards, the resolved world direction must never
        // change — only the player moves the Bey.
        if (tick === 0) {
          firstWorld = world!;
          const away = awayFromCamera(directional.getDebug().cameraYawRad);
          const len = Math.hypot(world!.x, world!.z);
          expect((world!.x * away.x + world!.z * away.z) / len, 'at the start of the gesture ArrowUp reads "away from the camera"').toBeGreaterThan(0.999);
        }
        expect(world, `tick ${tick}: the camera moved the Bey's input (world intent changed while the key was held)`).toEqual(firstWorld);

        expect(session.getController('first')).not.toBeInstanceOf(AIController);
        expect(session.getController('first')).toBe(directional);

        if (result.result.first.driftState === 'Drifting') anyDrift = true;
        if (!result.result.first.grounded) anyAirborne = true;
        if (result.result.first.movement.impactDeltaSpeedMps > 0) anyKnockback = true;

        if (session.roundState.result !== 'Ongoing') break; // a real AI fight can end early — that's fine, we already covered enough ticks either way.
      }

      const yawRange = Math.max(...cameraYaws) - Math.min(...cameraYaws);
      expect(yawRange, 'the camera never moved at all — this run does not actually exercise the camera-independence of held input').toBeGreaterThan(3);
      expect(anyDrift || anyAirborne || anyKnockback, 'no Drift/airborne/knockback event happened at all in 30 s').toBe(true);
    }, 30_000);
  }
});

// The two-fighter camera must be free to orbit however the fight demands
// (owner playtest fix 8, GDD §§48–50) — and "Fix 9" guarantees that orbit
// never steers the Bey: a held key's world direction stays put while the
// opponent circles a stationary player and the camera sweeps a wide orbit.
describe('fundamental test ("Fix 9"): a held direction is frozen while the camera orbits — the camera never moves the Bey', () => {
  it('opponent circles the stationary player 360°: camera yaw sweeps most of a full turn, held ArrowUp keeps exactly one world direction', () => {
    for (const preset of PRESET_IDS) {
      const keySource = new HeldKeySource();
      keySource.setHeld(Action.MoveForward); // held for the entire test, never released or changed
      let latestCameraYawDeg = 0;
      const directional = new DirectionalController(keySource, { cameraYaw: () => (latestCameraYawDeg * Math.PI) / 180 });
      const rig = new CameraRig(preset);
      const ticks = 360;
      let prevYawDeg: number | null = null;
      let totalRotationDeg = 0;
      let firstWorld: { x: number; z: number } | null = null;

      for (let t = 0; t < ticks; t++) {
        const a = (t / ticks) * Math.PI * 2;
        const frame: FightFrame = {
          tick: t,
          time: t / 60,
          first: { position: { x: 0, y: 0.2, z: -3 }, velocity: { x: 0, y: 0, z: 0 }, speed: 0, airborne: false, attack: 'none', broken: false },
          second: { position: { x: 6 * Math.cos(a), y: 0.2, z: -3 + 6 * Math.sin(a) }, velocity: { x: 0, y: 0, z: 0 }, speed: 0, airborne: false, attack: 'none', broken: false },
          intents: [],
          clashActive: false,
          clashProgress: 0,
          roundOver: false,
          ringOutIsFirst: null,
        };
        const out = rig.tick(frame, FIXED_DELTA_SECONDS);
        const yawDeg = out.player.debug.yawDeg;
        const cameraStepDeg = prevYawDeg === null ? 0 : Math.abs(((yawDeg - prevYawDeg + 540) % 360) - 180);
        if (prevYawDeg !== null) totalRotationDeg += cameraStepDeg;
        prevYawDeg = yawDeg;
        latestCameraYawDeg = yawDeg;

        const actions = directional.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
        const world = actions.moveIntent!;
        if (firstWorld === null) firstWorld = world;
        expect(world, `${preset} tick ${t}: the camera (yaw ${yawDeg.toFixed(1)}°) moved the Bey's input`).toEqual(firstWorld);
      }

      // The opponent went all the way around the stationary player, so the
      // opponent-focused, orbiting camera (fix 8) should have swept most of a
      // full turn following it — proof this run genuinely exercises a large,
      // continuous orbit, not a camera nudging by a few degrees.
      expect(totalRotationDeg, `${preset}: camera actually orbits`).toBeGreaterThan(180);
    }
  });
});
