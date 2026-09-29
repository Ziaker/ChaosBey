// ============================================================
// MATCH RUNNER — ONE RUNNING PLAYER MATCH (M10)
// A MatchSession driven by the production fixed-timestep loop, with the
// keyboard on the player's side and the F3 overlay / F4 attack-profile
// panel fed each tick. The player flow starts one per round and stops it
// when the player leaves; quick play (?mode=play&quick) runs one directly.
// This is the match loop playMode.ts used to own, unchanged in behavior.
// ============================================================

import type { AppRenderer } from '../bootstrap/createRenderer';
import type { MatchBeys } from '../bootstrap/createMatchScene';
import { GameState, type GameStateMachine } from '../lifecycle/GameState';
import { MatchSession } from '../session/MatchSession';
import type { SideControllerSpec } from '../session/SideControllers';
import { recordError } from '../modes/appTelemetry';
import type { BeyAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import type { MatchConfig } from '../../config/match/MatchConfig';
import type { ArenaTheme } from '../../arena/presets/ArenaPresets';
import type { RoundOutcome } from '../../combat/round-rules/RoundState';
import type { DebugOverlay } from '../../debug/overlay/DebugOverlay';
import { buildCombatOverlayFields, type CombatOverlayFields } from '../../debug/overlay/buildOverlayState';
import type { AttackProfileSettingsPanel } from '../../debug/settings/AttackProfileSettingsPanel';
import { Action, type ControllerActions } from '../../input/actions/Action';
import { KeyboardController } from '../../input/devices/KeyboardController';
import { FixedTimestepLoop } from '../../physics/fixed-step/FixedTimestepLoop';
import type { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';

export interface MatchRunnerDeps {
  readonly appRenderer: AppRenderer;
  readonly telemetry: TelemetryRecorder;
  readonly stateMachine: GameStateMachine;
  readonly debugOverlay: DebugOverlay;
  readonly attackProfileSettingsPanel: AttackProfileSettingsPanel;
}

export interface MatchRunnerStart {
  readonly seedText: string;
  readonly beys: MatchBeys;
  readonly matchConfig: MatchConfig;
  readonly attackProfileSettings: BeyAttackProfileSettings;
  /** The opponent's controller (the player is always the keyboard, first side). */
  readonly opponent: SideControllerSpec;
  /** Render-only arena look; omit for the default arena's. */
  readonly arenaTheme?: ArenaTheme;
}

export interface MatchRunnerEvents {
  /** Once, on the tick the round ends. */
  readonly onRoundOver?: (outcome: RoundOutcome) => void;
  /** Every fixed tick, after the match advanced (HUD, pause key). */
  readonly onTick?: (session: MatchSession, firstActions: ControllerActions) => void;
  /** Every rendered frame, after the match drew (HUD interpolation). */
  readonly onFrame?: (session: MatchSession, frameDeltaSeconds: number) => void;
}

export class MatchRunner {
  private readonly loop: FixedTimestepLoop;
  private roundOverReported = false;
  private overlayFields: CombatOverlayFields | null = null;
  private stopped = false;

  private constructor(
    readonly session: MatchSession,
    private readonly keyboard: KeyboardController,
    private readonly deps: MatchRunnerDeps,
    private readonly events: MatchRunnerEvents,
  ) {
    const { appRenderer, debugOverlay, attackProfileSettingsPanel, stateMachine, telemetry } = deps;
    this.loop = new FixedTimestepLoop({
      onFixedTick: () => {
        const { firstActions } = session.tick();
        if (firstActions.pressedThisFrame.has(Action.DebugToggle)) debugOverlay.toggle();
        if (firstActions.pressedThisFrame.has(Action.SettingsToggle)) attackProfileSettingsPanel.toggle();
        this.overlayFields = buildCombatOverlayFields(session);
        this.events.onTick?.(session, firstActions);
        if (!this.roundOverReported && session.roundState.isOver) {
          this.roundOverReported = true;
          this.events.onRoundOver?.(session.roundState.result);
        }
      },
      onRenderFrame: (frameDeltaSeconds) => {
        session.renderFrame(frameDeltaSeconds, appRenderer.camera);
        appRenderer.render();
        this.events.onFrame?.(session, frameDeltaSeconds);
        if (this.overlayFields) {
          debugOverlay.update({
            fps: frameDeltaSeconds > 0 ? 1 / frameDeltaSeconds : 0,
            frameTimeMs: frameDeltaSeconds * 1000,
            physicsStepTimeMs: session.getLastPhysicsStepTimeMs(),
            tickIndex: session.getTickIndex(),
            seedText: session.rngStreams.rootSeedText,
            gameState: stateMachine.getCurrentState(),
            ...this.overlayFields,
          });
        }
      },
      onFatalError: (error, tickIndex) => {
        recordError(telemetry, error);
        console.error(`ChaosBey simulation halted at tick ${tickIndex}:`, error);
        debugOverlay.showFatalError(`SIMULATION HALTED at tick ${tickIndex}: ${error instanceof Error ? error.message : String(error)}`);
      },
    });
  }

  static async start(deps: MatchRunnerDeps, start: MatchRunnerStart, events: MatchRunnerEvents = {}): Promise<MatchRunner> {
    const runner = await MatchRunner.create(deps, start, events);
    runner.resume();
    return runner;
  }

  private static async create(deps: MatchRunnerDeps, start: MatchRunnerStart, events: MatchRunnerEvents): Promise<MatchRunner> {
    // Attached only while the match runs, so a key still down from a menu
    // (Enter/Z to confirm) never reaches the match as a held input.
    const keyboard = new KeyboardController();
    const session = await MatchSession.create({
      scene: deps.appRenderer.scene,
      camera: deps.appRenderer.camera,
      seedText: start.seedText,
      matchConfig: start.matchConfig,
      attackProfileSettings: start.attackProfileSettings,
      telemetry: deps.telemetry,
      stateMachine: deps.stateMachine,
      controllers: { first: { kind: 'keyboard' }, second: start.opponent },
      keyboard,
      beys: start.beys,
      arenaTheme: start.arenaTheme,
    });
    // A real two-Bey match is running from here (GDD section 9: Combat and RoundEnd are separate states).
    deps.stateMachine.transitionTo(GameState.Combat);
    return new MatchRunner(session, keyboard, deps, events);
  }

  /** Starts (or restarts after pause()) the loop and listens to the keyboard. */
  resume(): void {
    if (this.stopped) return;
    this.keyboard.attach();
    this.loop.start();
  }

  /** Freezes the match: no ticks, no frames, keyboard released. */
  pause(): void {
    this.loop.stop();
    this.keyboard.detach();
  }

  isRoundOver(): boolean {
    return this.session.roundState.isOver;
  }

  /** Stops the loop and frees the match. The runner is unusable afterwards. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.pause();
    this.session.dispose();
  }
}
