// ============================================================
// APP ENTRYPOINT
// Composes the app's foundation pieces plus the Milestone 2 basic combat
// match (two Beys: player + a temporary idle stand-in opponent — real AI
// is Milestone 7). Keep this file a thin wiring layer — real logic
// belongs in the owning component module, not here (GDD section 1.4: no
// giant GameManager).
// ============================================================

import { createMatchScene } from './app/bootstrap/createMatchScene';
import { createRenderer } from './app/bootstrap/createRenderer';
import { GameState, GameStateMachine } from './app/lifecycle/GameState';
import { tickMatch, type MatchTickResult } from './app/simulation/tickMatch';
import { RoundState } from './combat/round-rules/RoundState';
import { CombatCameraController, type CombatCameraOutput } from './camera/CombatCameraController';
import { buildImpactEventsForTick } from './camera/ImpactEvents';
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
import { VfxManager } from './vfx/VfxManager';

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

  const cameraDirector = new CombatCameraController();
  const vfxManager = new VfxManager(appRenderer.scene, appRenderer.camera);
  let lastMatchResult: MatchTickResult | null = null;
  let lastCameraOutput: CombatCameraOutput | null = null;

  const loop = new FixedTimestepLoop({
    onFixedTick: (tickIndex, fixedDeltaSeconds) => {
      telemetry.setCurrentTick(tickIndex);

      // Hitstop (Milestone 4): a strong-enough impact freezes gameplay
      // simulation itself for a brief, magnitude-scaled real-time window —
      // tickMatch() doesn't run, so physics/resources/round state don't
      // advance. Computed before sampling so both controllers know this
      // tick is frozen: a gameplay press made during the freeze is
      // buffered (not lost) and delivered exactly once on the first
      // unfrozen sample afterward, and hold-duration/charge clocks don't
      // advance while frozen — see ActionSampleBuffer. Camera/VFX timers
      // below still tick every frame regardless, so the freeze actually
      // ends and shake/FOV-punch/trails keep animating through it.
      const isFrozenByHitstop = lastCameraOutput?.isHitstopActive ?? false;

      const firstActions = playerController.sampleActions({ fixedDeltaSeconds, simulationFrozen: isFrozenByHitstop });
      const secondActions = opponentController.sampleActions({ fixedDeltaSeconds, simulationFrozen: isFrozenByHitstop });
      if (firstActions.pressedThisFrame.has(Action.DebugToggle)) {
        debugOverlay.toggle();
      }

      let result: MatchTickResult;
      if (isFrozenByHitstop && lastMatchResult) {
        result = lastMatchResult;
      } else {
        const stepStart = performance.now();
        result = tickMatch(physics, match.first, match.second, firstActions, secondActions, fixedDeltaSeconds, roundState);
        lastPhysicsStepTimeMs = performance.now() - stepStart;
        lastMatchResult = result;

        for (const hit of result.hitEvents) {
          telemetry.record({
            kind: TelemetryEventKind.Hit,
            attackerIsFirst: hit.attackerIsFirst,
            hitboxKind: hit.hitbox.kind,
            caughtOpponentDashing: hit.caughtOpponentDashing,
          });
        }
        for (const combatEvent of result.combatEvents) {
          switch (combatEvent.kind) {
            case 'stabilityDamage':
              telemetry.record({ kind: TelemetryEventKind.StabilityDamage, targetIsFirst: combatEvent.targetIsFirst, amount: combatEvent.amount });
              break;
            case 'stabilityBreak':
              telemetry.record({ kind: TelemetryEventKind.StabilityBreak, targetIsFirst: combatEvent.targetIsFirst });
              break;
            case 'knockback':
              telemetry.record({ kind: TelemetryEventKind.Knockback, targetIsFirst: combatEvent.targetIsFirst, force: combatEvent.force });
              break;
            case 'ko':
              telemetry.record({ kind: TelemetryEventKind.Ko, targetIsFirst: combatEvent.targetIsFirst });
              break;
            case 'ringOut':
              telemetry.record({ kind: TelemetryEventKind.RingOut, targetIsFirst: combatEvent.targetIsFirst });
              break;
            case 'dodged':
              telemetry.record({ kind: TelemetryEventKind.Dodged, targetIsFirst: combatEvent.targetIsFirst });
              break;
            case 'perfectDodge':
              telemetry.record({ kind: TelemetryEventKind.PerfectDodge, targetIsFirst: combatEvent.targetIsFirst });
              break;
          }
        }
        // A genuine unmodeled physics impact (wall/floor bounce) — distinct
        // from a combat Hit/Knockback event above, which already carries its
        // own knockbackForce/force fields rather than borrowing this one.
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
          telemetry.record({ kind: TelemetryEventKind.RoundEnd, outcome: roundState.result });
          stateMachine.transitionTo(GameState.RoundEnd);
        }
      }

      lastFirstVisual = { spin: result.first.spin.visualSpinAngleRad, wobble: result.first.spin.wobbleOffsetRad };
      lastSecondVisual = { spin: result.second.spin.visualSpinAngleRad, wobble: result.second.spin.wobbleOffsetRad };

      // Camera/VFX (Milestone 4) — always ticks, even on a hitstop-frozen
      // tick (with an empty impact-events list, since nothing new happened
      // that tick), so shake/FOV-punch/hitstop-remaining keep decaying in
      // real time and the freeze doesn't become permanent.
      const firstPositionM = match.first.body.translation();
      const secondPositionM = match.second.body.translation();
      const impactEvents = isFrozenByHitstop ? [] : buildImpactEventsForTick(result, firstPositionM, secondPositionM);
      vfxManager.onImpactEvents(impactEvents);
      lastCameraOutput = cameraDirector.tick({
        firstPositionM,
        secondPositionM,
        firstSpeedMps: result.first.movement.speedMps,
        secondSpeedMps: result.second.movement.speedMps,
        firstVelocityXZ: result.first.movement.actualVelocityVector,
        impactEvents,
        fixedDeltaSeconds,
      });

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
        dodgeState: result.first.dodgeState,
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
        cameraFovDeg: lastCameraOutput.fovDeg,
        cameraShakeOffsetM: lastCameraOutput.shakeOffsetM,
        isHitstopActive: lastCameraOutput.isHitstopActive,
        hitstopRemainingS: lastCameraOutput.hitstopRemainingS,
        cameraHighSpeedBlend: lastCameraOutput.highSpeedBlend,
      };
    },
    onRenderFrame: (frameDeltaSeconds) => {
      match.syncVisualsToPhysics(lastFirstVisual.spin, lastFirstVisual.wobble, lastSecondVisual.spin, lastSecondVisual.wobble);

      if (lastCameraOutput) {
        appRenderer.camera.position.set(
          lastCameraOutput.cameraPositionM.x + lastCameraOutput.shakeOffsetM.x,
          lastCameraOutput.cameraPositionM.y + lastCameraOutput.shakeOffsetM.y,
          lastCameraOutput.cameraPositionM.z + lastCameraOutput.shakeOffsetM.z,
        );
        appRenderer.camera.lookAt(lastCameraOutput.focusPositionM.x, lastCameraOutput.focusPositionM.y, lastCameraOutput.focusPositionM.z);
        appRenderer.camera.fov = lastCameraOutput.fovDeg;
        appRenderer.camera.updateProjectionMatrix();
      }

      vfxManager.onRenderFrame(
        frameDeltaSeconds,
        match.first.body.translation(),
        lastMatchResult?.first.movement.speedMps ?? 0,
        match.second.body.translation(),
        lastMatchResult?.second.movement.speedMps ?? 0,
        lastCameraOutput?.speedLinesScreenDirection ?? { x: 0, y: 0 },
      );

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

  // A real two-Bey match is already running by this point (GDD section 9:
  // Combat and RoundEnd are separate states) — Sandbox was only ever the
  // Milestone 0 placeholder-scene state.
  stateMachine.transitionTo(GameState.Combat);
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
