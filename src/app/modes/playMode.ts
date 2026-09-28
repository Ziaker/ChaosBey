// ============================================================
// PLAY MODE — THE NORMAL PLAYER-VS-AI MATCH
// Keyboard-driven player (first) against the real M7 AIController
// (second), advanced by the production fixed-timestep loop. The match
// pipeline itself lives in MatchSession, shared with the Debug Lab.
// ============================================================

import type { AppRenderer } from '../bootstrap/createRenderer';
import { GameState, GameStateMachine } from '../lifecycle/GameState';
import { MatchSession } from '../session/MatchSession';
import { resolveMatchConfig } from '../../config/match/MatchConfig';
import { resolveAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import { loadAttackProfileOverrides } from '../../config/attack-profile/AttackProfileStorage';
import { createDefaultRuntimeConfig } from '../../config/runtime/RuntimeConfig';
import { DebugOverlay } from '../../debug/overlay/DebugOverlay';
import { buildCombatOverlayFields, type CombatOverlayFields } from '../../debug/overlay/buildOverlayState';
import { AttackProfileSettingsPanel } from '../../debug/settings/AttackProfileSettingsPanel';
import { Action } from '../../input/actions/Action';
import { KeyboardController } from '../../input/devices/KeyboardController';
import { FixedTimestepLoop } from '../../physics/fixed-step/FixedTimestepLoop';
import { generateRandomSeedText } from '../../rng/stringSeed';
import { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';
import { recordAppBoot, recordUncaughtErrors, recordError } from './appTelemetry';

export interface PlayModeMounts {
  readonly debugOverlayRoot: HTMLElement;
  readonly attackSettingsRoot: HTMLElement;
}

export async function startPlayMode(appRenderer: AppRenderer, mounts: PlayModeMounts): Promise<void> {
  const runtimeConfig = createDefaultRuntimeConfig();
  // No pre-match UI to source overrides from yet (Milestone 10's pregame
  // setup is where a real UI would collect this); resolveMatchConfig()
  // with no overrides still routes through the single resolved-value path.
  const matchConfig = resolveMatchConfig();
  const telemetry = new TelemetryRecorder();
  const stateMachine = new GameStateMachine();

  // Owner requirement (PR #8 review): per-archetype BeyAttackProfile values
  // must be editable from the game's settings, not locked in code.
  // Resolved once at boot from whatever the settings panel last persisted.
  const attackProfileSettings = resolveAttackProfileSettings(loadAttackProfileOverrides() ?? undefined);

  const keyboard = new KeyboardController();
  keyboard.attach();

  // Milestone 7: the opponent is a real AIController whose personality
  // matches its own Bey's archetype (GDD section 64), with the internal
  // default difficulty until a pre-game selection UI (Milestone 10) exists.
  const session = await MatchSession.create({
    scene: appRenderer.scene,
    camera: appRenderer.camera,
    seedText: generateRandomSeedText(),
    matchConfig,
    attackProfileSettings,
    telemetry,
    stateMachine,
    controllers: { first: { kind: 'keyboard' }, second: { kind: 'ai', personality: 'archetype' } },
    keyboard,
  });

  const debugOverlay = new DebugOverlay(mounts.debugOverlayRoot, runtimeConfig.debugOverlayVisibleOnBoot);
  const attackProfileSettingsPanel = new AttackProfileSettingsPanel(mounts.attackSettingsRoot);

  recordAppBoot(telemetry);
  recordUncaughtErrors(telemetry);

  let overlayFields: CombatOverlayFields | null = null;

  const loop = new FixedTimestepLoop({
    onFixedTick: () => {
      const { firstActions } = session.tick();
      if (firstActions.pressedThisFrame.has(Action.DebugToggle)) debugOverlay.toggle();
      if (firstActions.pressedThisFrame.has(Action.SettingsToggle)) attackProfileSettingsPanel.toggle();
      overlayFields = buildCombatOverlayFields(session);
    },
    onRenderFrame: (frameDeltaSeconds) => {
      session.renderFrame(frameDeltaSeconds, appRenderer.camera);
      appRenderer.render();
      if (overlayFields) {
        debugOverlay.update({
          fps: frameDeltaSeconds > 0 ? 1 / frameDeltaSeconds : 0,
          frameTimeMs: frameDeltaSeconds * 1000,
          physicsStepTimeMs: session.getLastPhysicsStepTimeMs(),
          tickIndex: session.getTickIndex(),
          seedText: session.rngStreams.rootSeedText,
          gameState: stateMachine.getCurrentState(),
          ...overlayFields,
        });
      }
    },
    onFatalError: (error, tickIndex) => {
      recordError(telemetry, error);
      console.error(`ChaosBey simulation halted at tick ${tickIndex}:`, error);
      debugOverlay.showFatalError(`SIMULATION HALTED at tick ${tickIndex}: ${error instanceof Error ? error.message : String(error)}`);
    },
  });

  // A real two-Bey match is already running by this point (GDD section 9:
  // Combat and RoundEnd are separate states).
  stateMachine.transitionTo(GameState.Combat);
  loop.start();

  window.addEventListener('beforeunload', () => {
    loop.stop();
    keyboard.detach();
    appRenderer.dispose();
  });
}
