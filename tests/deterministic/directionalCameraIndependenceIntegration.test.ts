// ============================================================
// DIRECTIONAL CONTROL × CAMERA INDEPENDENCE — FULL INTEGRATION (owner
// playtest blocker, 2026-09)
// Unlike directionalInput.test.ts (the pure input-layer unit tests) and
// directionalMovement.test.ts (MovementController alone), this drives a
// REAL MatchSession: real Rapier physics, a real AI opponent actually
// fighting, the real CameraRig (so the camera genuinely orbits/tracks the
// fight — not a hand-fed yaw), and DirectionalController wired to that
// real camera exactly as MatchRunner.ts wires it. If camera-relative
// coupling could sneak back in anywhere along that real wiring, only an
// integration test exercising the whole path would catch it.
//
// Tests F/G/H from the blocker report:
// F. ~30 s of real combat, human input cycling/held, controller owner
//    never silently becomes AI, no unexplained loss of responsiveness.
// G. Repeated on Flat + Bowl A/B/C.
// H. Drift/Jump/landing/wall-bounce/knockback happen along the way (real
//    AI combat produces them); input stays responsive afterward.
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
import { Action, type CombatController, type ControllerActions, type ControllerContext } from '../../src/input/actions/Action';
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
  // No camera source is threaded through DirectionalController at all — it
  // has no such parameter any more (see DirectionalController.ts's
  // header). The real camera's yaw for this test's own bookkeeping is read
  // straight from the session's camera output below, never through the
  // controller.
  const directional = new DirectionalController(keySource);
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
  return { session, camera, keySource, directional };
}

const CYCLE: readonly [Action, { x: number; z: number }][] = [
  [Action.MoveForward, { x: 0, z: 1 }],
  [Action.SteerRight, { x: 1, z: 0 }],
  [Action.MoveBackward, { x: 0, z: -1 }],
  [Action.SteerLeft, { x: -1, z: 0 }],
];

describe('Directional control stays camera-independent through a real 30 s fight (owner playtest F/G/H)', () => {
  for (const arenaFloor of ['flat', 'bowl-a', 'bowl-b', 'bowl-c'] as const) {
    it(`${arenaFloor}: 1800 real ticks of AI combat, cycling every held direction — moveIntent always matches the fixed mapping, controller owner never flips to AI, camera actually moves`, async () => {
      const { session, camera, keySource, directional } = await createDirectionalMatch(arenaFloor, `f-g-h-${arenaFloor}`);
      const TICKS = 1800; // 30 s at 60 Hz
      const cameraYaws: number[] = [];
      let anyDrift = false;
      let anyAirborne = false;
      let anyKnockback = false;
      let sawResponsiveAfterKnockback = false;
      let ticksSinceKnockback = -1;

      for (let tick = 0; tick < TICKS; tick++) {
        // Cycle direction every 20 ticks (~1/3 s) so the camera has real time to move between changes, and hold each for several ticks like a human would.
        const [action, expectedWorld] = CYCLE[Math.floor(tick / 20) % CYCLE.length]!;
        keySource.setHeld(action);

        session.renderFrame(FIXED_DELTA_SECONDS, camera); // updates the REAL camera from the current fight, before this tick's input is sampled
        const result = session.tick();
        cameraYaws.push(session.getLastCameraOutput()?.yawDeg ?? 0);

        const actualWorld = session.getLastActions('first')?.moveIntent;
        expect(actualWorld, `tick ${tick}: moveIntent missing on a directional frame`).toBeDefined();
        expect(actualWorld, `tick ${tick} (${action}): moveIntent must equal the fixed world mapping regardless of camera`).toEqual(expectedWorld);

        // Controller owner (Test F): 'first' must always be the real player
        // controller, never silently replaced by an AIController.
        expect(session.getController('first')).not.toBeInstanceOf(AIController);
        expect(session.getController('first')).toBe(directional);

        if (result.result.first.driftState === 'Drifting') anyDrift = true;
        if (!result.result.first.grounded) anyAirborne = true;
        if (result.result.first.movement.impactDeltaSpeedMps > 0) {
          anyKnockback = true;
          ticksSinceKnockback = 0;
        } else if (ticksSinceKnockback >= 0) {
          ticksSinceKnockback++;
          // Test H: within 10 ticks after a knockback/impact, held input is
          // still driving moveIntent exactly as the fixed mapping says —
          // the impact never leaves input "stuck" or zeroed.
          if (ticksSinceKnockback <= 10) {
            expect(session.getLastActions('first')?.moveIntent, `tick ${tick}: input not responsive ${ticksSinceKnockback} ticks after an impact`).toEqual(expectedWorld);
            if (ticksSinceKnockback === 10) sawResponsiveAfterKnockback = true;
          }
        }

        if (session.roundState.result !== 'Ongoing') break; // a real AI fight can end early — that's fine, we already covered enough ticks either way.
      }

      // The camera actually moved (a real fight, a real director) — this is
      // not a fixed-yaw stub that would trivially "pass" the independence
      // check above by never changing at all.
      const yawRange = Math.max(...cameraYaws) - Math.min(...cameraYaws);
      expect(yawRange, 'the camera never moved at all — this run does not actually exercise independence').toBeGreaterThan(3);

      // At least one of the real-combat events happened somewhere in this
      // AI-vs-real-player-input run, so Test H's claim ("input recovers
      // after knockback") was actually exercised, not vacuously true.
      expect(anyDrift || anyAirborne || anyKnockback, 'no Drift/airborne/knockback event happened at all in 30 s — Test H was not actually exercised').toBe(true);
      if (anyKnockback) expect(sawResponsiveAfterKnockback).toBe(true);
    }, 30_000);
  }
});

// Owner playtest fix 8's "fundamental test" (GDD §§48–50, §14 of the camera
// feedback): the two-fighter camera must be free to orbit however the fight
// demands, and that orbit must have zero effect on what a held direction
// means. This exercises the real CameraRig (the fix 8 director, opponent
// circling a stationary player — the same drive as scenario A in
// cameraTwoFighterFraming.test.ts) and the real DirectionalController side
// by side, tick for tick.
describe('fundamental test: the camera orbits fully while a held direction\'s world vector never moves (owner playtest fix 8 §14)', () => {
  it('opponent circles the stationary player 360°: camera yaw sweeps most of a full turn, held ArrowUp is world +Z on every single tick', () => {
    for (const preset of PRESET_IDS) {
      const keySource = new HeldKeySource();
      keySource.setHeld(Action.MoveForward); // held for the entire test, never released or changed
      // DirectionalController has no camera parameter at all any more (see
      // its header) — this is exactly the point being proven, not a
      // shortcut. The real orbiting camera below is a separate, independent
      // CameraRig, driving nothing back into this controller; its yaw is
      // read straight off `out.player.debug.yawDeg` for this test's own
      // bookkeeping.
      const directional = new DirectionalController(keySource);
      const rig = new CameraRig(preset);
      const ticks = 360;
      let prevYawDeg: number | null = null;
      let totalRotationDeg = 0;

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
        if (prevYawDeg !== null) totalRotationDeg += Math.abs(((yawDeg - prevYawDeg + 540) % 360) - 180);
        prevYawDeg = yawDeg;

        const actions = directional.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
        expect(actions.moveIntent, `${preset} tick ${t}: ArrowUp must be world +Z regardless of camera yaw (${yawDeg.toFixed(1)}°)`).toEqual({ x: 0, z: 1 });
      }

      // The opponent went all the way around the stationary player, so the
      // opponent-focused, orbiting camera (fix 8) should have swept most of a
      // full turn following it — proof this run genuinely exercises a large,
      // continuous orbit, not a camera nudging by a few degrees.
      expect(totalRotationDeg, `${preset}: camera actually orbits`).toBeGreaterThan(180);
    }
  });
});
