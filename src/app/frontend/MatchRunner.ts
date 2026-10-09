// ============================================================
// MATCH RUNNER — ONE RUNNING PLAYER MATCH (M10)
// A MatchSession driven by the production fixed-timestep loop, with the
// keyboard on the player's side and the F3 overlay / F4 attack-profile
// panel fed each tick. The player flow starts one per round and stops it
// when the player leaves; quick play (?mode=play&quick) runs one directly.
// This is the match loop playMode.ts used to own, unchanged in behavior.
// ============================================================

import type { VfxOptions } from '../../vfx/hybrid/intensityTiers';
import * as THREE from 'three';
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
import { CombinedController, GamepadController } from '../../input/devices/GamepadController';
import { createPlayerControl } from '../../input/directional/createPlayerControl';
import { controlSetupFor } from './controlReferences';
import type { DirectionalController, DirectionalDebug } from '../../input/directional/DirectionalController';
import { DEFAULT_PLAYER_SETTINGS, type CameraPresetSetting, type ConditionLayerSetting, type ControlScheme } from '../../config/settings/PlayerSettings';
import { FixedTimestepLoop } from '../../physics/fixed-step/FixedTimestepLoop';
import { AdaptiveResolution } from './adaptiveResolution';
import { FrameLimiter } from './frameLimiter';
import { DEFAULT_FRAME_LIMIT, type FrameLimitSetting } from '../../config/settings/FrameLimit';
import type { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';
import type { ImpactFeedbackOptions } from '../../vfx/ImpactFeedback';
import type { FlowFxSettings } from '../../vfx/flow/flowFxTuning';
import { FreeOrbitCamera, RealModeCamera, type ExternalCamera } from '../../camera/real/RealCameras';
import type { RealCameraMode } from '../../camera/real/RealCameraModes';

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
  /** Render-only presentation settings; omit for everything on. */
  readonly presentation?: MatchPresentation;
  /** How the player's arrows / stick drive the Bey. */
  readonly controlScheme?: ControlScheme;
  /** Bey Real: which camera the match is watched with. Omit (or `original`) for the game's combat directors. */
  readonly realCamera?: RealCameraMode;
}

/** Player settings that change how the match is drawn, never what it computes. */
export interface MatchPresentation {
  /** Camera shake and speed/impact FOV. */
  readonly cameraEffects: boolean;
  /** Speed trails (off on Low quality). */
  readonly trails: boolean;
  /** M11: the player's camera preset (A/B/C); the Clash forces B regardless. Default B. */
  readonly cameraPreset?: CameraPresetSetting;
  /** Condition languages to show when the conditionVisuals presentation flag is enabled. */
  readonly conditionLayers?: readonly ConditionLayerSetting[];
  /** Lote 9: the Pregame's visual options. */
  readonly vfx?: VfxOptions;
  /** Owner, 2026-10-05: the in-scene game-feel switches (hit flash, hit shake, counter burst). */
  readonly feel?: ImpactFeedbackOptions;
  /** Owner, 2026-10-08: the Visual effects sliders (spin blur, lean, shadow, dust, wind, impact rings, comic words). */
  readonly flowFx?: FlowFxSettings;
  /** Performance pass (0.57.0): how the picture is paced and how sharp it is. Render cost only; omit for the defaults. */
  readonly performance?: MatchPerformance;
}

/** Render pacing and resolution (never reaches the simulation). */
export interface MatchPerformance {
  /** Lower the render resolution by itself while the frame rate is poor. */
  readonly adaptiveResolution: boolean;
  readonly frameLimit: FrameLimitSetting;
  /** Where the adaptive render scale may go on this quality preset. */
  readonly renderScaleRange: { readonly min: number; readonly max: number };
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
  private presentation: MatchPresentation = { cameraEffects: true, trails: true };
  private overlayFields: CombatOverlayFields | null = null;
  private readonly frameLimiter = new FrameLimiter(DEFAULT_FRAME_LIMIT);
  private readonly adaptive: AdaptiveResolution;
  /** Frame time (scaled by the game speed) of frames the limiter skipped: handed to the next drawn one, so effects keep pace. */
  private skippedFrameS = 0;
  private lastDrawMs: number | null = null;
  private stopped = false;
  private running = false;
  /** Bey Real: the camera this match is watched with instead of the combat directors; null = the originals. */
  private externalCamera: ExternalCamera | null = null;

  private constructor(
    readonly session: MatchSession,
    private readonly keyboard: KeyboardController,
    private readonly gamepad: GamepadController,
    private readonly directional: DirectionalController,
    private readonly deps: MatchRunnerDeps,
    private readonly events: MatchRunnerEvents,
    /** MatchConfig.gameSpeed (owner, 2026-10-04): game seconds per real second. */
    gameSpeed = 1,
  ) {
    const { appRenderer, debugOverlay, attackProfileSettingsPanel, stateMachine, telemetry } = deps;
    // The resolution the last match settled on carries over (a slow machine is slow in the next round too).
    this.adaptive = new AdaptiveResolution(appRenderer.getRenderScale());
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
      onRenderFrame: (loopFrameDeltaSeconds) => {
        const nowMs = performance.now();
        const perf = this.presentation.performance;
        this.frameLimiter.setLimit(perf?.frameLimit ?? DEFAULT_FRAME_LIMIT);
        if (!this.frameLimiter.shouldDraw(nowMs)) {
          this.skippedFrameS += loopFrameDeltaSeconds;
          return;
        }
        const frameDeltaSeconds = loopFrameDeltaSeconds + this.skippedFrameS;
        this.skippedFrameS = 0;
        // Adaptive resolution: judged on the real time between DRAWN frames (not the game-speed-scaled one).
        if (this.lastDrawMs !== null) {
          if (perf?.adaptiveResolution ?? true) {
            const next = this.adaptive.update(nowMs - this.lastDrawMs, perf?.renderScaleRange);
            if (next !== null) appRenderer.setRenderScale(next);
          } else if (appRenderer.getRenderScale() !== 1) {
            this.adaptive.reset();
            appRenderer.setRenderScale(1);
          }
        }
        this.lastDrawMs = nowMs;
        session.renderFrame(frameDeltaSeconds, appRenderer.camera, { cameraView: 'game', cameraEffects: this.presentation.cameraEffects, externalCamera: this.externalCamera ?? undefined });
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
    }, gameSpeed);
  }

  static async start(deps: MatchRunnerDeps, start: MatchRunnerStart, events: MatchRunnerEvents = {}): Promise<MatchRunner> {
    const runner = await MatchRunner.create(deps, start, events);
    runner.resume();
    return runner;
  }

  private static async create(deps: MatchRunnerDeps, start: MatchRunnerStart, events: MatchRunnerEvents): Promise<MatchRunner> {
    // `session` doesn't exist yet (built below): both closures below read it
    // through this forward reference once it's assigned further down.
    let sessionForJumpBuffer: MatchSession | null = null;
    // Attached only while the match runs, so a key still down from a menu
    // (Enter/Z to confirm) never reaches the match as a held input. The
    // player drives with the keyboard and/or the first gamepad. Blur/focus
    // loss cancels a pending jump-input-buffer press the same moment
    // currentlyDown/the hold buffer are cleared (GDD 131).
    const keyboard = new KeyboardController(() => sessionForJumpBuffer?.cancelBufferedJumps());
    const gamepad = new GamepadController();
    // The player's control chain, built by the same factory the Debug Lab
    // and the camera/gameplay separation tests use. The three camera-free
    // schemes resolve from gameplay-owned references; the opt-in `screen`
    // scheme reads presentation only in controlReferences.ts.
    const setup = controlSetupFor(start.controlScheme ?? DEFAULT_PLAYER_SETTINGS.controlScheme, { session: () => sessionForJumpBuffer });
    const directional = createPlayerControl(new CombinedController([keyboard, gamepad]), {
      directional: setup.directional,
      reference: setup.reference,
      stick: () => gamepad.getStick(),
    });
    const session = await MatchSession.create({
      scene: deps.appRenderer.scene,
      camera: deps.appRenderer.camera,
      seedText: start.seedText,
      matchConfig: start.matchConfig,
      attackProfileSettings: start.attackProfileSettings,
      telemetry: deps.telemetry,
      stateMachine: deps.stateMachine,
      controllers: { first: { kind: 'keyboard' }, second: start.opponent },
      keyboard: directional,
      beys: start.beys,
      arenaTheme: start.arenaTheme,
      cameraPreset: start.presentation?.cameraPreset,
      conditionLayers: start.presentation?.conditionLayers,
      vfx: start.presentation?.vfx,
      flowFx: start.presentation?.flowFx,
      renderer: deps.appRenderer.renderer,
    });
    sessionForJumpBuffer = session;
    // A real two-Bey match is running from here (GDD section 9: Combat and RoundEnd are separate states).
    deps.stateMachine.transitionTo(GameState.Combat);
    const runner = new MatchRunner(session, keyboard, gamepad, directional, deps, events, start.matchConfig.gameSpeed ?? 1);
    // The arena's sky: the scene's clear color while this match owns the renderer (restored on stop).
    if (start.arenaTheme) {
      runner.savedBackground = deps.appRenderer.scene.background;
      deps.appRenderer.scene.background = new THREE.Color(start.arenaTheme.backgroundHex);
    }
    if (start.presentation) runner.setPresentation(start.presentation);
    if (start.realCamera === 'real') runner.externalCamera = new RealModeCamera();
    else if (start.realCamera === 'free') runner.externalCamera = new FreeOrbitCamera();
    return runner;
  }

  /** Starts (or restarts after pause()) the loop and listens to the keyboard. */
  resume(): void {
    if (this.stopped || this.running) return;
    this.running = true;
    this.gamepad.reset();
    this.directional.reset();
    this.keyboard.attach();
    this.loop.start();
  }

  /** Freezes the match: no ticks, no frames, keyboard released, held pad buttons forgotten. */
  pause(): void {
    this.running = false;
    this.loop.stop();
    this.keyboard.detach();
    this.gamepad.reset();
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Applies presentation settings live (e.g. changed from the Pause menu). */
  setPresentation(presentation: MatchPresentation): void {
    this.presentation = presentation;
    this.session.getVfxManager().setLayerVisible('trails', presentation.trails);
    if (presentation.cameraPreset) this.session.setCameraPreset(presentation.cameraPreset);
    if (presentation.conditionLayers) this.session.setConditionLayers(presentation.conditionLayers);
    if (presentation.feel) this.session.setGameFeel(presentation.feel);
    if (presentation.flowFx) this.session.setFlowFx(presentation.flowFx);
  }

  /** Switches the control scheme live (from the Pause menu's settings). */
  setControlScheme(scheme: ControlScheme): void {
    const setup = controlSetupFor(scheme, { session: () => this.session });
    this.directional.setReference(setup.reference);
    this.directional.setEnabled(setup.directional);
  }

  /** The player's directional input (screen + world), null under Classic control. Debug overlay only. */
  getDirectionalDebug(): DirectionalDebug | null {
    return this.directional.isEnabled() ? this.directional.getDebug() : null;
  }

  /** Draws one frame without ticking (behind a pause menu, after a settings change). */
  redraw(): void {
    this.session.renderFrame(0, this.deps.appRenderer.camera, { cameraView: 'game', cameraEffects: this.presentation.cameraEffects, externalCamera: this.externalCamera ?? undefined });
    this.deps.appRenderer.render();
  }

  isRoundOver(): boolean {
    return this.session.roundState.isOver;
  }

  /** Stops the loop and frees the match. The runner is unusable afterwards. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.pause();
    this.externalCamera?.dispose();
    this.externalCamera = null;
    this.session.dispose();
    if (this.savedBackground !== undefined) this.deps.appRenderer.scene.background = this.savedBackground;
  }

  /** The scene background before this match set the arena's (undefined = untouched). */
  private savedBackground: THREE.Scene['background'] | undefined = undefined;
}
