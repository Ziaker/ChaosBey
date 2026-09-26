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
import { ClashOrchestration } from './app/simulation/ClashOrchestration';
import { ClashPresentationTracker } from './app/simulation/ClashPresentationTracker';
import { RoundState } from './combat/round-rules/RoundState';
import { ClashOutcome, ClashState } from './combat/clash/ClashController';
import { computeClashPower, computeMashPerformance, computeStaminaFactor, computeVelocityFactor } from './combat/clash/ClashFormula';
import { CLASH_PROGRESSIVE_VFX_INTERVAL_TICKS, CLASH_TARGET_DURATION_S } from './combat/clash/ClashTuning';
import { CombatCameraController, type CombatCameraOutput } from './camera/CombatCameraController';
import { ClashCameraDirector } from './camera/ClashCameraDirector';
import { buildImpactEventsForTick, type ImpactEvent, type WorldPositionM } from './camera/ImpactEvents';
import { CLASH_RESOLVED_MAGNITUDE } from './camera/ImpactMagnitude';
import { createDefaultRuntimeConfig } from './config/runtime/RuntimeConfig';
import { resolveMatchConfig } from './config/match/MatchConfig';
import { resolveAttackProfileSettings } from './config/attack-profile/AttackProfileSettings';
import { loadAttackProfileOverrides } from './config/attack-profile/AttackProfileStorage';
import { DebugOverlay, type DebugOverlayState } from './debug/overlay/DebugOverlay';
import { AttackProfileSettingsPanel } from './debug/settings/AttackProfileSettingsPanel';
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
  const attackSettingsRoot = document.querySelector<HTMLElement>('#attack-settings-root');
  if (!canvas || !debugOverlayRoot || !attackSettingsRoot) {
    throw new Error('bootstrap: required DOM mount points are missing from index.html.');
  }

  const runtimeConfig = createDefaultRuntimeConfig();
  // No pre-match UI to source overrides from yet (GDD section 152's
  // "configurable pre-match" — Milestone 10's pregame setup is where a
  // real UI would collect this); resolveMatchConfig() with no overrides
  // still routes through the single resolved-value path everything else
  // (ClashOrchestration, the debug overlay) reads from.
  const matchConfig = resolveMatchConfig();
  const telemetry = new TelemetryRecorder();
  const stateMachine = new GameStateMachine();
  const roundState = new RoundState();
  const clash = new ClashOrchestration(matchConfig);

  const seedText = generateRandomSeedText();
  const rngStreams = createRngStreams(seedText);

  const appRenderer = createRenderer(canvas);
  const physics = await PhysicsWorld.create();
  // Owner requirement (PR #8 review): per-archetype BeyAttackProfile values
  // must be editable from the game's settings, not locked in code. Resolved
  // once at boot from whatever the settings panel below last persisted —
  // the same "single resolved pre-match config" model as matchConfig above.
  const attackProfileSettings = resolveAttackProfileSettings(loadAttackProfileOverrides() ?? undefined);
  const match = createMatchScene(appRenderer.scene, physics, attackProfileSettings);

  const playerController = new KeyboardController();
  playerController.attach();
  const opponentController = new IdleController();

  const debugOverlay = new DebugOverlay(debugOverlayRoot, runtimeConfig.debugOverlayVisibleOnBoot);
  const attackProfileSettingsPanel = new AttackProfileSettingsPanel(attackSettingsRoot);

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
  const clashCameraDirector = new ClashCameraDirector();
  const vfxManager = new VfxManager(appRenderer.scene, appRenderer.camera, match.first.definition.particle, match.second.definition.particle);
  let lastMatchResult: MatchTickResult | null = null;
  let lastCameraOutput: CombatCameraOutput | null = null;
  const clashPresentationTracker = new ClashPresentationTracker();

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
      if (firstActions.pressedThisFrame.has(Action.SettingsToggle)) {
        attackProfileSettingsPanel.toggle();
      }

      let result: MatchTickResult;
      if (isFrozenByHitstop && lastMatchResult) {
        result = lastMatchResult;
      } else {
        const stepStart = performance.now();
        result = tickMatch(physics, match.first, match.second, firstActions, secondActions, fixedDeltaSeconds, roundState, clash);
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

      // Clash (Milestone 5) state-edge telemetry + GameState transitions —
      // ClashPresentationTracker (a separate, unit-tested module) owns the
      // edge detection itself; safe to call every tick, including a
      // hitstop-frozen one where nothing changed and every edge reads
      // false. clashResolvedThisTick must NOT be read directly off a
      // reused, hitstop-frozen `result` — that's the exact same cached
      // object the resolution tick itself returned, so it would otherwise
      // still read non-null on every later frozen tick, re-triggering the
      // resolution beat (and thus hitstop) forever.
      const currentClashState = clash.controller.getState();
      const clashResolvedThisTick = isFrozenByHitstop ? null : result.clashResolvedThisTick;
      const currentFirstClashMashEventCount = clash.controller.getFirstMashEventCount();
      const currentSecondClashMashEventCount = clash.controller.getSecondMashEventCount();
      const presentationEvents = clashPresentationTracker.update(
        currentClashState,
        clashResolvedThisTick,
        currentFirstClashMashEventCount,
        currentSecondClashMashEventCount,
      );

      if (presentationEvents.clashStarted) {
        telemetry.record({
          kind: TelemetryEventKind.ClashStart,
          firstStaminaFraction: result.first.staminaFraction,
          secondStaminaFraction: result.second.staminaFraction,
          firstSpeedMps: result.first.movement.speedMps,
          secondSpeedMps: result.second.movement.speedMps,
        });
        stateMachine.transitionTo(GameState.Clash);
        clashCameraDirector.reset();
      }
      if (presentationEvents.clashResult) {
        const clashResult = presentationEvents.clashResult;
        telemetry.record({
          kind: TelemetryEventKind.ClashResult,
          outcome: clashResult.outcome,
          firstClashPower: clashResult.firstClashPower,
          secondClashPower: clashResult.secondClashPower,
          firstMashEventCount: clashResult.firstMashEventCount,
          secondMashEventCount: clashResult.secondMashEventCount,
        });
      }
      if (presentationEvents.clashEnded) {
        // GDD lifecycle: resolution -> knockback -> normal game state
        // resumes immediately. GameState.Clash covers only the Active
        // presentation itself — the 10s Cooldown that follows is purely
        // an internal restriction against starting a new Clash, not a
        // presentation state; gameplay/camera/controls are already back
        // to normal from the very next tick (see the `else` camera/VFX
        // branch below, which Cooldown falls into like any other normal
        // tick). ClashEnd fires here, on the same tick as ClashResult —
        // never delayed until a later Cooldown -> Idle transition.
        telemetry.record({ kind: TelemetryEventKind.ClashEnd });
        // The round may have ended this same tick via the resolution's own
        // KO — don't clobber that with Combat.
        if (stateMachine.getCurrentState() === GameState.Clash) stateMachine.transitionTo(GameState.Combat);
      }
      for (const mashEvent of presentationEvents.mashInputEvents) {
        telemetry.record({ kind: TelemetryEventKind.ClashMashInput, isFirst: mashEvent.isFirst, mashEventCount: mashEvent.mashEventCount });
      }

      lastFirstVisual = { spin: result.first.spin.visualSpinAngleRad, wobble: result.first.spin.wobbleOffsetRad };
      lastSecondVisual = { spin: result.second.spin.visualSpinAngleRad, wobble: result.second.spin.wobbleOffsetRad };

      // Camera/VFX — always ticks, even on a hitstop-frozen tick (with an
      // empty impact-events list, since nothing new happened that tick),
      // so shake/FOV-punch/hitstop-remaining keep decaying in real time
      // and the freeze doesn't become permanent.
      const firstPositionM = match.first.body.translation();
      const secondPositionM = match.second.body.translation();
      const midpointM: WorldPositionM = {
        x: (firstPositionM.x + secondPositionM.x) / 2,
        y: (firstPositionM.y + secondPositionM.y) / 2,
        z: (firstPositionM.z + secondPositionM.z) / 2,
      };

      if (clashResolvedThisTick) {
        // Resolution beat (owner decision): a strong, dedicated impact
        // event at the clash point drives Milestone 4's existing
        // hitstop/shake/FOV-punch pipeline exactly like any other big
        // moment — the freeze holds the already-applied knockback impulse
        // in place for a beat, then physics.step() (resuming next tick,
        // no longer frozen) plays out the real physical result. The normal
        // CombatCameraController resumes driving the camera from here —
        // follow biases toward whichever side actually got launched
        // (FirstWins -> second was the loser; SecondWins -> first was)
        // via followTargetIsFirst, not the generic `isFirst` field (which
        // KNOCKBACK_FOLLOW_EVENT_KINDS' default reading would otherwise
        // get backwards for exactly one of the two win outcomes). A Tie
        // has no loser at all — null means no unilateral follow bias, so
        // the framing stays central/symmetric as approved. Only fires
        // once, the instant resolution happens — see
        // clashResolvedThisTick's own definition above for why it must
        // not be read off a hitstop-reused `result`.
        const loserIsFirst =
          clashResolvedThisTick.outcome === ClashOutcome.FirstWins
            ? false
            : clashResolvedThisTick.outcome === ClashOutcome.SecondWins
              ? true
              : null;
        const resolutionEvent: ImpactEvent = {
          kind: 'clashResolved',
          magnitude: CLASH_RESOLVED_MAGNITUDE,
          worldPositionM: midpointM,
          isFirst: loserIsFirst ?? true,
          followTargetIsFirst: loserIsFirst,
        };
        vfxManager.onImpactEvents([resolutionEvent]);
        lastCameraOutput = cameraDirector.tick({
          firstPositionM,
          secondPositionM,
          firstSpeedMps: result.first.movement.speedMps,
          secondSpeedMps: result.second.movement.speedMps,
          firstVelocityXZ: result.first.movement.actualVelocityVector,
          impactEvents: [resolutionEvent],
          fixedDeltaSeconds,
        });
      } else if (currentClashState === ClashState.Active) {
        // Dedicated Clash camera (owner decision, profile C): a controlled
        // cinematic orbit near the confrontation point, intensity growing
        // progressively over the ~4s contest, while keeping the normal
        // CombatCameraController's own smoothing state settling toward the
        // (frozen) midpoint too — with no fresh impact events, since
        // nothing new happened — so resuming it after resolution isn't a
        // snap. Small progressive sparks land at a fixed cadence so the
        // escalation is actually felt building, not just flashing once at
        // the end.
        cameraDirector.tick({
          firstPositionM,
          secondPositionM,
          firstSpeedMps: 0,
          secondSpeedMps: 0,
          firstVelocityXZ: { x: 0, z: 0 },
          impactEvents: [],
          fixedDeltaSeconds,
        });
        const progressFraction = clash.controller.getElapsedS() / CLASH_TARGET_DURATION_S;
        const clashCameraOutput = clashCameraDirector.tick({ midpointM, progressFraction, fixedDeltaSeconds });
        lastCameraOutput = {
          cameraPositionM: clashCameraOutput.cameraPositionM,
          focusPositionM: clashCameraOutput.focusPositionM,
          shakeOffsetM: clashCameraOutput.shakeOffsetM,
          fovDeg: clashCameraOutput.fovDeg,
          isHitstopActive: false,
          hitstopRemainingS: 0,
          highSpeedBlend: 0,
          speedLinesScreenDirection: { x: 0, y: 0 },
        };
        if (tickIndex % CLASH_PROGRESSIVE_VFX_INTERVAL_TICKS === 0) {
          vfxManager.onImpactEvents([{ kind: 'hit', magnitude: 0.1 + progressFraction * 0.3, worldPositionM: midpointM, isFirst: true }]);
        }
      } else {
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
        clashState: currentClashState,
        clashElapsedS: clash.controller.getElapsedS(),
        clashCooldownRemainingS: clash.controller.getCooldownRemainingS(),
        clashOutcome: clash.controller.getLastResult()?.outcome ?? '-',
        firstClashMashEventCount: currentFirstClashMashEventCount,
        secondClashMashEventCount: currentSecondClashMashEventCount,
        // Stamina/Velocity read the values actually captured at tryStart()
        // (frozen for this Clash's whole Active + Cooldown lifetime), not
        // a live recomputation from the current simulation state — for a
        // cross-tick compatible pair, each side's own hit can be captured
        // on a different tick, so its live current value may have already
        // drifted from what the real formula used by the time both sides
        // are known. This is what actually decided (or is deciding) the
        // outcome (GDD section 152's Debug Lab requirement: mash score,
        // Stamina factor, Velocity factor and final score visible).
        firstClashMashPerformance: computeMashPerformance(currentFirstClashMashEventCount),
        firstClashStaminaFactor: computeStaminaFactor(clash.controller.getFirstStaminaFractionAtStart()),
        firstClashVelocityFactor: computeVelocityFactor(clash.controller.getFirstSpeedMpsAtStart()),
        firstClashPower: computeClashPower(currentFirstClashMashEventCount, clash.controller.getFirstStaminaFractionAtStart(), clash.controller.getFirstSpeedMpsAtStart()),
        secondClashMashPerformance: computeMashPerformance(currentSecondClashMashEventCount),
        secondClashStaminaFactor: computeStaminaFactor(clash.controller.getSecondStaminaFractionAtStart()),
        secondClashVelocityFactor: computeVelocityFactor(clash.controller.getSecondSpeedMpsAtStart()),
        secondClashPower: computeClashPower(currentSecondClashMashEventCount, clash.controller.getSecondStaminaFractionAtStart(), clash.controller.getSecondSpeedMpsAtStart()),
        clashImpactMultiplier: matchConfig.clashImpactMultiplier,
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
