// ============================================================
// APP ENTRYPOINT
// Composes the app's foundation pieces plus the Milestone 2 basic combat
// match (two Beys: player + a temporary idle stand-in opponent — real AI
// is Milestone 7). Keep this file a thin wiring layer — real logic
// belongs in the owning component module, not here (GDD section 1.4: no
// giant GameManager).
// ============================================================

import * as THREE from 'three';
import { createMatchScene } from './app/bootstrap/createMatchScene';
import { createRenderer } from './app/bootstrap/createRenderer';
import { GameState, GameStateMachine } from './app/lifecycle/GameState';
import { tickMatch } from './app/simulation/tickMatch';
import { RoundState } from './combat/round-rules/RoundState';
import { createDefaultRuntimeConfig } from './config/runtime/RuntimeConfig';
import { DebugOverlay, type DebugOverlayState } from './debug/overlay/DebugOverlay';
import { Action } from './input/actions/Action';
import { KeyboardController } from './input/devices/KeyboardController';
import { IdleController } from './automation/scripted-scenarios/IdleController';
import { FixedTimestepLoop } from './physics/fixed-step/FixedTimestepLoop';
import { checkAngularVelocity, checkLinearVelocity } from './physics/diagnostics/physicsSafety';
import { PhysicsWorld } from './physics/world/PhysicsWorld';
import { generateRandomSeedText } from './rng/stringSeed';
import { createRngStreams } from './rng/SeededRng';
import { TelemetryEventKind } from './telemetry/events/TelemetryEvent';
import { TelemetryRecorder } from './telemetry/recording/TelemetryRecorder';

// Temporary, non-final camera follow purely so combat is testable before
// the real camera director exists (GDD section 50, Milestone 4). Not a
// design decision about final camera behavior — just enough to see both
// Beys. Frames the midpoint between the two combatants.
const CAMERA_FOLLOW_OFFSET = new THREE.Vector3(0, 7, 10);
const CAMERA_FOLLOW_SMOOTHING_PER_FRAME = 0.08;

async function bootstrap(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#app-canvas');
  const debugOverlayRoot = document.querySelector<HTMLElement>('#debug-overlay-root');
  if (!canvas || !debugOverlayRoot) {
    throw new Error('bootstrap: required DOM mount points are missing from index.html.');
  }

  const runtimeConfig = createDefaultRuntimeConfig();
  const telemetry = new TelemetryRecorder();
  const stateMachine = new GameStateMachine();
  const roundState = new RoundState();

  const seedText = generateRandomSeedText();
  const rngStreams = createRngStreams(seedText);

  const appRenderer = createRenderer(canvas);
  const physics = await PhysicsWorld.create();
  const match = createMatchScene(appRenderer.scene, physics);

  const playerController = new KeyboardController();
  playerController.attach();
  const opponentController = new IdleController();

  const debugOverlay = new DebugOverlay(debugOverlayRoot, runtimeConfig.debugOverlayVisibleOnBoot);

  telemetry.record({
    kind: TelemetryEventKind.AppBoot,
    buildVersion: __APP_BUILD_VERSION__,
    commitHash: __APP_COMMIT_HASH__,
  });

  let lastPhysicsStepTimeMs = 0;
  let lastFps = 0;
  let lastFirstVisual = { spin: 0, wobble: 0 };
  let lastSecondVisual = { spin: 0, wobble: 0 };
  type CombatOverlayFields = Omit<DebugOverlayState, 'fps' | 'frameTimeMs' | 'physicsStepTimeMs' | 'tickIndex' | 'seedText' | 'gameState'>;
  let lastOverlayFields: CombatOverlayFields | null = null;

  const cameraCurrentTarget = new THREE.Vector3();

  const loop = new FixedTimestepLoop({
    onFixedTick: (tickIndex, fixedDeltaSeconds) => {
      telemetry.setCurrentTick(tickIndex);

      const firstActions = playerController.sampleActions({ fixedDeltaSeconds });
      const secondActions = opponentController.sampleActions({ fixedDeltaSeconds });
      if (firstActions.pressedThisFrame.has(Action.DebugToggle)) {
        debugOverlay.toggle();
      }

      const stepStart = performance.now();
      const result = tickMatch(physics, match.first, match.second, firstActions, secondActions, fixedDeltaSeconds, roundState);
      lastPhysicsStepTimeMs = performance.now() - stepStart;

      lastFirstVisual = { spin: result.first.spin.visualSpinAngleRad, wobble: result.first.spin.wobbleOffsetRad };
      lastSecondVisual = { spin: result.second.spin.visualSpinAngleRad, wobble: result.second.spin.wobbleOffsetRad };

      for (const event of result.hitEvents) {
        telemetry.record({ kind: TelemetryEventKind.MovementImpact, speedDeltaMps: event.hitbox.knockbackForce });
      }
      if (result.first.movement.impactDeltaSpeedMps > 0 || result.second.movement.impactDeltaSpeedMps > 0) {
        const speedDelta = Math.max(result.first.movement.impactDeltaSpeedMps, result.second.movement.impactDeltaSpeedMps);
        telemetry.record({ kind: TelemetryEventKind.MovementImpact, speedDeltaMps: speedDelta });
      }

      for (const [label, snapshot] of [
        ['first', result.first],
        ['second', result.second],
      ] as const) {
        const linvel = label === 'first' ? match.first.body.linvel() : match.second.body.linvel();
        const linearAnomaly = checkLinearVelocity(linvel.x, linvel.y, linvel.z);
        if (linearAnomaly) {
          telemetry.record({ kind: TelemetryEventKind.PhysicsAnomaly, anomalyKind: linearAnomaly.kind, detail: linearAnomaly.detail });
        }
        const angularAnomaly = checkAngularVelocity(
          snapshot.spin.angularVelocity.x,
          snapshot.spin.angularVelocity.y,
          snapshot.spin.angularVelocity.z,
        );
        if (angularAnomaly) {
          telemetry.record({ kind: TelemetryEventKind.PhysicsAnomaly, anomalyKind: angularAnomaly.kind, detail: angularAnomaly.detail });
        }
      }

      if (roundState.isOver && stateMachine.getCurrentState() !== GameState.RoundEnd) {
        stateMachine.transitionTo(GameState.RoundEnd);
      }

      lastOverlayFields = {
        intendedSteeringVector: result.first.movement.intendedSteeringVector,
        actualVelocityVector: result.first.movement.actualVelocityVector,
        speedMps: result.first.movement.speedMps,
        headingRad: result.first.movement.headingRad,
        slipAngleRad: result.first.movement.slipAngleRad,
        lateralGripPerS: result.first.movement.lateralGripPerS,
        longitudinalDragPerS: result.first.movement.longitudinalDragPerS,
        grounded: result.first.grounded,
        driftState: result.first.driftState,
        angularVelocity: result.first.spin.angularVelocity,
        spinRateRadPerSec: result.first.spin.spinRateRadPerSec,
        tiltRad: result.first.spin.tiltRad,
        wobbleEnergy: result.first.spin.wobbleEnergy,
        firstAttackState: result.first.attackState,
        firstDashChargeFraction: result.first.dashChargeFraction,
        firstStaminaFraction: result.first.staminaFraction,
        firstStabilityFraction: result.first.stabilityFraction,
        firstIsBroken: result.first.isBroken,
        firstAttackEnergyFraction: result.first.attackEnergyFraction,
        secondAttackState: result.second.attackState,
        secondStaminaFraction: result.second.staminaFraction,
        secondStabilityFraction: result.second.stabilityFraction,
        secondIsBroken: result.second.isBroken,
        roundResult: roundState.result,
      };
    },
    onRenderFrame: (frameDeltaSeconds) => {
      match.syncVisualsToPhysics(lastFirstVisual.spin, lastFirstVisual.wobble, lastSecondVisual.spin, lastSecondVisual.wobble);

      const firstPos = match.first.body.translation();
      const secondPos = match.second.body.translation();
      const midpoint = new THREE.Vector3((firstPos.x + secondPos.x) / 2, (firstPos.y + secondPos.y) / 2, (firstPos.z + secondPos.z) / 2);
      cameraCurrentTarget.copy(midpoint).add(CAMERA_FOLLOW_OFFSET);
      appRenderer.camera.position.lerp(cameraCurrentTarget, CAMERA_FOLLOW_SMOOTHING_PER_FRAME);
      appRenderer.camera.lookAt(midpoint);

      appRenderer.render();

      lastFps = frameDeltaSeconds > 0 ? 1 / frameDeltaSeconds : 0;
      if (lastOverlayFields) {
        debugOverlay.update({
          fps: lastFps,
          frameTimeMs: frameDeltaSeconds * 1000,
          physicsStepTimeMs: lastPhysicsStepTimeMs,
          tickIndex: loop.getTickIndex(),
          seedText: rngStreams.rootSeedText,
          gameState: stateMachine.getCurrentState(),
          ...lastOverlayFields,
        });
      }
    },
  });

  stateMachine.transitionTo(GameState.Sandbox);
  loop.start();

  window.addEventListener('beforeunload', () => {
    loop.stop();
    playerController.detach();
    appRenderer.dispose();
  });
}

bootstrap().catch((error: unknown) => {
  // Errors must never be swallowed silently (GDD section 117).
  console.error('ChaosBey failed to boot:', error);
});
