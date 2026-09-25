// ============================================================
// APP ENTRYPOINT
// Composes the app's foundation pieces plus the Milestone 1 physical
// movement prototype. Keep this file a thin wiring layer — real logic
// belongs in the owning component module, not here (GDD section 1.4: no
// giant GameManager).
// ============================================================

import * as THREE from 'three';
import { createBeyPrototypeScene } from './app/bootstrap/createBeyPrototypeScene';
import { createRenderer } from './app/bootstrap/createRenderer';
import { GameState, GameStateMachine } from './app/lifecycle/GameState';
import { BEY_COLLIDER_HALF_HEIGHT_M } from './bey/core/BeyTuning';
import { createDefaultRuntimeConfig } from './config/runtime/RuntimeConfig';
import { DebugOverlay, type DebugOverlayState } from './debug/overlay/DebugOverlay';
import { Action } from './input/actions/Action';
import { KeyboardController } from './input/devices/KeyboardController';
import { FixedTimestepLoop } from './physics/fixed-step/FixedTimestepLoop';
import { isGrounded } from './physics/collision/GroundCheck';
import { checkAngularVelocity, checkLinearVelocity } from './physics/diagnostics/physicsSafety';
import { PhysicsWorld } from './physics/world/PhysicsWorld';
import { generateRandomSeedText } from './rng/stringSeed';
import { createRngStreams } from './rng/SeededRng';
import { TelemetryEventKind } from './telemetry/events/TelemetryEvent';
import { TelemetryRecorder } from './telemetry/recording/TelemetryRecorder';

// Temporary, non-final camera follow purely so movement is testable before
// the real camera director exists (GDD section 50, Milestone 4). Not a
// design decision about final camera behavior — just enough to see the
// Bey drive around.
const CAMERA_FOLLOW_OFFSET = new THREE.Vector3(0, 6, 9);
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

  const seedText = generateRandomSeedText();
  const rngStreams = createRngStreams(seedText);

  const appRenderer = createRenderer(canvas);
  const physics = await PhysicsWorld.create();
  const prototype = createBeyPrototypeScene(appRenderer.scene, physics);

  const controller = new KeyboardController();
  controller.attach();

  const debugOverlay = new DebugOverlay(debugOverlayRoot, runtimeConfig.debugOverlayVisibleOnBoot);

  telemetry.record({
    kind: TelemetryEventKind.AppBoot,
    buildVersion: __APP_BUILD_VERSION__,
    commitHash: __APP_COMMIT_HASH__,
  });

  let lastPhysicsStepTimeMs = 0;
  let lastFps = 0;
  let lastVisualSpinAngleRad = 0;
  let lastWobbleOffsetRad = 0;
  type PhysicsOverlayFields = Omit<DebugOverlayState, 'fps' | 'frameTimeMs' | 'physicsStepTimeMs' | 'tickIndex' | 'seedText' | 'gameState'>;
  let lastOverlayFields: PhysicsOverlayFields | null = null;

  const cameraCurrentTarget = new THREE.Vector3();

  const loop = new FixedTimestepLoop({
    onFixedTick: (tickIndex, fixedDeltaSeconds) => {
      telemetry.setCurrentTick(tickIndex);

      const actions = controller.sampleActions({ fixedDeltaSeconds });
      if (actions.pressedThisFrame.has(Action.DebugToggle)) {
        debugOverlay.toggle();
      }

      const grounded = isGrounded(physics, prototype.beyBody, BEY_COLLIDER_HALF_HEIGHT_M, prototype.beyCollider);

      const driftResult = prototype.drift.tick(prototype.beyBody, actions, grounded, fixedDeltaSeconds);
      prototype.movement.applyPreStep(prototype.beyBody, actions, fixedDeltaSeconds, grounded, driftResult.lateralGripOverridePerS);
      prototype.spin.tick(prototype.beyBody, fixedDeltaSeconds);

      const stepStart = performance.now();
      physics.step();
      lastPhysicsStepTimeMs = performance.now() - stepStart;

      const movementSnapshot = prototype.movement.postStep(prototype.beyBody, grounded);
      if (movementSnapshot.impactDeltaSpeedMps > 0) {
        prototype.spin.registerImpact(prototype.beyBody, movementSnapshot.impactDeltaSpeedMps, movementSnapshot.impactDirection);
        telemetry.record({
          kind: TelemetryEventKind.MovementImpact,
          speedDeltaMps: movementSnapshot.impactDeltaSpeedMps,
        });
      }

      const spinSnapshot = prototype.spin.getSnapshot(prototype.beyBody);
      lastVisualSpinAngleRad = spinSnapshot.visualSpinAngleRad;
      lastWobbleOffsetRad = spinSnapshot.wobbleOffsetRad;

      const linvel = prototype.beyBody.linvel();
      const linearAnomaly = checkLinearVelocity(linvel.x, linvel.y, linvel.z);
      if (linearAnomaly) {
        telemetry.record({ kind: TelemetryEventKind.PhysicsAnomaly, anomalyKind: linearAnomaly.kind, detail: linearAnomaly.detail });
      }
      const angularAnomaly = checkAngularVelocity(spinSnapshot.angularVelocity.x, spinSnapshot.angularVelocity.y, spinSnapshot.angularVelocity.z);
      if (angularAnomaly) {
        telemetry.record({ kind: TelemetryEventKind.PhysicsAnomaly, anomalyKind: angularAnomaly.kind, detail: angularAnomaly.detail });
      }

      lastOverlayFields = {
        intendedSteeringVector: movementSnapshot.intendedSteeringVector,
        actualVelocityVector: movementSnapshot.actualVelocityVector,
        speedMps: movementSnapshot.speedMps,
        headingRad: movementSnapshot.headingRad,
        slipAngleRad: movementSnapshot.slipAngleRad,
        lateralGripPerS: movementSnapshot.lateralGripPerS,
        longitudinalDragPerS: movementSnapshot.longitudinalDragPerS,
        grounded: movementSnapshot.isGrounded,
        driftState: driftResult.driftState,
        angularVelocity: spinSnapshot.angularVelocity,
        spinRateRadPerSec: spinSnapshot.spinRateRadPerSec,
        tiltRad: spinSnapshot.tiltRad,
        wobbleEnergy: spinSnapshot.wobbleEnergy,
      };
    },
    onRenderFrame: (frameDeltaSeconds) => {
      prototype.syncVisualsToPhysics(lastVisualSpinAngleRad, lastWobbleOffsetRad);

      const beyPosition = prototype.beyBody.translation();
      cameraCurrentTarget.set(beyPosition.x, beyPosition.y, beyPosition.z).add(CAMERA_FOLLOW_OFFSET);
      appRenderer.camera.position.lerp(cameraCurrentTarget, CAMERA_FOLLOW_SMOOTHING_PER_FRAME);
      appRenderer.camera.lookAt(beyPosition.x, beyPosition.y, beyPosition.z);

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
    controller.detach();
    appRenderer.dispose();
  });
}

bootstrap().catch((error: unknown) => {
  // Errors must never be swallowed silently (GDD section 117).
  console.error('ChaosBey failed to boot:', error);
});
