// ============================================================
// APP ENTRYPOINT
// Composes Milestone 0's foundation pieces. Keep this file a thin wiring
// layer — real logic belongs in the owning component module, not here
// (GDD section 1.4: no giant GameManager).
// ============================================================

import { createRenderer } from './app/bootstrap/createRenderer';
import { createSandboxScene } from './app/bootstrap/createSandboxScene';
import { GameState, GameStateMachine } from './app/lifecycle/GameState';
import { createDefaultRuntimeConfig } from './config/runtime/RuntimeConfig';
import { DebugOverlay } from './debug/overlay/DebugOverlay';
import { Action } from './input/actions/Action';
import { KeyboardController } from './input/devices/KeyboardController';
import { FixedTimestepLoop } from './physics/fixed-step/FixedTimestepLoop';
import { checkLinearVelocity } from './physics/diagnostics/physicsSafety';
import { PhysicsWorld } from './physics/world/PhysicsWorld';
import { generateRandomSeedText } from './rng/stringSeed';
import { createRngStreams } from './rng/SeededRng';
import { TelemetryEventKind } from './telemetry/events/TelemetryEvent';
import { TelemetryRecorder } from './telemetry/recording/TelemetryRecorder';

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
  const sandboxScene = createSandboxScene(appRenderer.scene, physics);

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

  const loop = new FixedTimestepLoop({
    onFixedTick: (tickIndex) => {
      telemetry.setCurrentTick(tickIndex);

      const actions = controller.sampleActions({ fixedDeltaSeconds: 1 / 60 });
      if (actions.pressedThisFrame.has(Action.DebugToggle)) {
        debugOverlay.toggle();
      }

      const stepStart = performance.now();
      physics.step();
      lastPhysicsStepTimeMs = performance.now() - stepStart;

      const velocity = sandboxScene.placeholderBody.linvel();
      const anomaly = checkLinearVelocity(velocity.x, velocity.y, velocity.z);
      if (anomaly) {
        telemetry.record({
          kind: TelemetryEventKind.PhysicsAnomaly,
          anomalyKind: anomaly.kind,
          detail: anomaly.detail,
        });
      }
    },
    onRenderFrame: (frameDeltaSeconds) => {
      sandboxScene.syncVisualsToPhysics();
      appRenderer.render();

      lastFps = frameDeltaSeconds > 0 ? 1 / frameDeltaSeconds : 0;
      debugOverlay.update({
        fps: lastFps,
        frameTimeMs: frameDeltaSeconds * 1000,
        physicsStepTimeMs: lastPhysicsStepTimeMs,
        tickIndex: loop.getTickIndex(),
        seedText: rngStreams.gameplay.getCanonicalSeedText(),
        gameState: stateMachine.getCurrentState(),
      });
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
