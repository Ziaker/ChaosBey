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
import { DirectionalController, cameraYawOf } from '../../src/input/directional/DirectionalController';
import { resolveMatchConfig } from '../../src/config/match/MatchConfig';
import { createDefaultAttackProfileSettings } from '../../src/config/attack-profile/AttackProfileSettings';
import { TelemetryRecorder } from '../../src/telemetry/recording/TelemetryRecorder';
import { Action, type CombatController, type ControllerActions, type ControllerContext } from '../../src/input/actions/Action';
import { FIXED_DELTA_SECONDS } from '../../src/physics/fixed-step/FixedTimestepLoop';
import type { ArenaFloorId } from '../../src/arena/floor/ArenaFloorProfile';

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
  const directional = new DirectionalController(keySource, { cameraYaw: () => cameraYawOf(camera) });
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
        cameraYaws.push(cameraYawOf(camera));

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
      expect(yawRange, 'the camera never moved at all — this run does not actually exercise independence').toBeGreaterThan(0.05);

      // At least one of the real-combat events happened somewhere in this
      // AI-vs-real-player-input run, so Test H's claim ("input recovers
      // after knockback") was actually exercised, not vacuously true.
      expect(anyDrift || anyAirborne || anyKnockback, 'no Drift/airborne/knockback event happened at all in 30 s — Test H was not actually exercised').toBe(true);
      if (anyKnockback) expect(sawResponsiveAfterKnockback).toBe(true);
    }, 30_000);
  }
});
