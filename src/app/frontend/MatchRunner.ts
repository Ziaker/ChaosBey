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
import { MatchSession, type SessionRenderView } from '../session/MatchSession';
import type { SideControllerSpec } from '../session/SideControllers';
import { recordError } from '../modes/appTelemetry';
import type { BeyAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import type { MatchConfig } from '../../config/match/MatchConfig';
import type { ArenaTheme } from '../../arena/presets/ArenaPresets';
import type { RoundOutcome } from '../../combat/round-rules/RoundState';
import type { DebugOverlay } from '../../debug/overlay/DebugOverlay';
import { buildCombatOverlayFields } from '../../debug/overlay/buildOverlayState';
import type { AttackProfileSettingsPanel } from '../../debug/settings/AttackProfileSettingsPanel';
import { Action, type ControllerActions } from '../../input/actions/Action';
import { KeyboardController } from '../../input/devices/KeyboardController';
import { CombinedController, GamepadController } from '../../input/devices/GamepadController';
import { createPlayerControl } from '../../input/directional/createPlayerControl';
import { controlSetupFor } from './controlReferences';
import type { DirectionalController, DirectionalDebug } from '../../input/directional/DirectionalController';
import { DEFAULT_PLAYER_SETTINGS, type CameraPresetSetting, type ConditionLayerSetting, type ControlScheme } from '../../config/settings/PlayerSettings';
import { FIXED_DELTA_SECONDS, FixedTimestepLoop } from '../../physics/fixed-step/FixedTimestepLoop';
import { screenVectorFromDigital, screenVectorFromStick, screenLength } from '../../input/directional/screenDirection';
import { LaunchFlow, type LaunchInput } from './LaunchFlow';
import { warmUpRenderer } from '../bootstrap/warmUpRenderer';
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
  /**
   * Launch System A: where the launch's HUD goes. With `matchConfig.launchSequence` on and a mount given, the round starts
   * with the launch (mounted Beys, the entry point, Timing Snap, both Beys arriving) and the match's first tick follows the
   * arrival at once. Omit it and the match starts at once, as quick play and the tests do.
   */
  readonly launchMount?: HTMLElement;
  /** Each Bey's color (CSS) for the launchers. */
  readonly launchAccents?: { readonly first: string; readonly second: string };
}

/** After the arrival the launchers, the grade and the wind stay up this long (seconds); the match already runs. */
const LAUNCH_LINGER_S = 1.4;
/** The launchers sink away over the last part of that (seconds). */
const LAUNCH_RETRACT_S = 0.45;
/** The combat camera takes over from the launch's last pose over this long (seconds, presentation only). */
const CAMERA_BLEND_S = 0.7;

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
  /** Once, on the tick the launch ends and the match begins (the same tick the Beys arrive). */
  readonly onLaunchEnd?: () => void;
}

export class MatchRunner {
  private readonly loop: FixedTimestepLoop;
  private roundOverReported = false;
  private presentation: MatchPresentation = { cameraEffects: true, trails: true };
  private readonly frameLimiter = new FrameLimiter(DEFAULT_FRAME_LIMIT);
  private readonly adaptive: AdaptiveResolution;
  /** Frame time (scaled by the game speed) of frames the limiter skipped: handed to the next drawn one, so effects keep pace. */
  private skippedFrameS = 0;
  private lastDrawMs: number | null = null;
  private stopped = false;
  private running = false;
  /** Bey Real: the camera this match is watched with instead of the combat directors; null = the originals. */
  private externalCamera: ExternalCamera | null = null;
  /** Launch System A: the launch running before the first tick (null once it has ended and its rig is gone, or when the match starts at once). */
  private launch: LaunchFlow | null = null;
  /** After the arrival the launchers and the grade stay up for a moment, while the match already runs. */
  private launchLingerS = 0;
  /** After the arrival the combat camera takes over from the launch's pose over this long (presentation only). */
  private cameraBlend: { leftS: number; readonly eye: THREE.Vector3; readonly focus: THREE.Vector3; readonly fovDeg: number } | null = null;

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
        const launching = this.launch !== null && !this.launch.finished;
        const { firstActions } = launching ? { firstActions: this.tickLaunch() } : session.tick();
        if (firstActions.pressedThisFrame.has(Action.DebugToggle)) debugOverlay.toggle();
        if (firstActions.pressedThisFrame.has(Action.SettingsToggle)) attackProfileSettingsPanel.toggle();
        this.events.onTick?.(session, firstActions);
        if (launching && this.launch?.finished) this.endLaunch();
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
        this.frameLaunch(frameDeltaSeconds);
        session.renderFrame(frameDeltaSeconds, appRenderer.camera, this.renderView());
        appRenderer.render();
        this.events.onFrame?.(session, frameDeltaSeconds);
        // The overlay's ~60 fields are built only while it is up, once per drawn frame (0.62.0; they used to be built on every tick).
        const overlayFields = debugOverlay.isVisible() && !this.isLaunching() ? buildCombatOverlayFields(session) : null;
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
    const launching = start.matchConfig.launchSequence === true && start.launchMount !== undefined;
    // A real two-Bey match is running from here (GDD section 9: Combat and RoundEnd are separate states) — after the launch, when the round starts with one.
    deps.stateMachine.transitionTo(launching ? GameState.Launch : GameState.Combat);
    const runner = new MatchRunner(session, keyboard, gamepad, directional, deps, events, start.matchConfig.gameSpeed ?? 1);
    if (launching) {
      runner.launch = new LaunchFlow({
        session,
        camera: deps.appRenderer.camera,
        canvas: deps.appRenderer.renderer.domElement,
        mount: start.launchMount!,
        accentsCss: start.launchAccents ?? { first: '#6ee7ff', second: '#ff6b6b' },
        sampleInput: () => runner.sampleLaunchInput(),
      });
    }
    // The arena's sky: the scene's clear color while this match owns the renderer (restored on stop).
    if (start.arenaTheme) {
      runner.savedBackground = deps.appRenderer.scene.background;
      deps.appRenderer.scene.background = new THREE.Color(start.arenaTheme.backgroundHex);
    }
    if (start.presentation) runner.setPresentation(start.presentation);
    if (start.realCamera === 'real') runner.externalCamera = new RealModeCamera();
    else if (start.realCamera === 'free') runner.externalCamera = new FreeOrbitCamera();
    // Everything the round draws is in the scene now (arena, Beys, rails, launchers, effect pools): compile its shaders and
    // upload its textures behind the loading screen, not on the first frames of the round (0.62.0).
    await warmUpRenderer(deps.appRenderer.renderer, deps.appRenderer.scene, deps.appRenderer.camera);
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
    this.session.renderFrame(0, this.deps.appRenderer.camera, this.renderView());
    this.deps.appRenderer.render();
  }

  /** True while the round's launch is running (the match's first tick has not happened yet). */
  isLaunching(): boolean {
    return this.launch !== null && !this.launch.finished;
  }

  /** The launch in progress (or just ended, for a moment), for the HUD and the tests. */
  getLaunch(): LaunchFlow | null {
    return this.launch;
  }

  // ---- Launch System A: the round start ----

  /** The person's input for one launch tick: the same chain the match reads, and the arrows / stick as a screen vector. */
  sampleLaunchInput(): LaunchInput {
    const actions = this.directional.sampleActions({ fixedDeltaSeconds: FIXED_DELTA_SECONDS });
    const stickAxes = this.gamepad.getStick();
    const stick = screenVectorFromStick(stickAxes[0], stickAxes[1]);
    let aim = screenVectorFromDigital(
      actions.held.has(Action.MoveForward),
      actions.held.has(Action.MoveBackward),
      actions.held.has(Action.SteerLeft),
      actions.held.has(Action.SteerRight),
    );
    // Under directional control the arrows were turned into a world intent and MoveForward/Backward dropped from `held`: its own screen vector is the aim.
    if (this.directional.isEnabled()) aim = this.directional.getDebug().screen;
    if (screenLength(stick) > 0) aim = stick;
    return { actions, aim };
  }

  /** One fixed tick of the launch: no simulation runs, so no tick index advances. */
  private tickLaunch(): ControllerActions {
    const actions = this.launch!.tick();
    if (actions.pressedThisFrame.has(Action.DebugToggle)) this.deps.debugOverlay.toggle();
    if (actions.pressedThisFrame.has(Action.SettingsToggle)) this.deps.attackProfileSettingsPanel.toggle();
    return actions;
  }

  /** The tick the last Bey touches down: the result goes to the match, which runs from the next tick — no countdown, no hold. */
  private endLaunch(): void {
    const launch = this.launch!;
    this.session.applyLaunchResult(launch.getResult());
    this.deps.stateMachine.transitionTo(GameState.Combat);
    this.launchLingerS = LAUNCH_LINGER_S;
    this.cameraBlend = { leftS: CAMERA_BLEND_S, eye: launch.camera.lastEye.clone(), focus: launch.camera.lastFocus.clone(), fovDeg: launch.camera.lastFovDeg };
    this.events.onLaunchEnd?.();
  }

  /** Per rendered frame: the launch's rig, HUD and spin; once it is over, the moment it lingers and the camera hand-over. */
  private frameLaunch(frameDeltaSeconds: number): void {
    const launch = this.launch;
    if (!launch) return;
    launch.frame(frameDeltaSeconds);
    if (launch.finished) {
      this.launchLingerS -= frameDeltaSeconds;
      launch.retract(1 - this.launchLingerS / LAUNCH_RETRACT_S);
      if (this.launchLingerS <= 0) {
        launch.dispose();
        this.launch = null;
      }
    }
    if (this.cameraBlend) {
      this.cameraBlend.leftS -= frameDeltaSeconds;
      if (this.cameraBlend.leftS <= 0) this.cameraBlend = null;
    }
  }

  /** How the session is drawn this frame: the launch's camera while it runs, the combat camera (blended from the launch's) after. */
  private renderView(): SessionRenderView {
    const launch = this.launch;
    const base = { cameraView: 'game' as const, cameraEffects: this.presentation.cameraEffects };
    if (launch && !launch.finished) return { ...base, externalCamera: launch.camera, headingArrow: false };
    const blend = this.cameraBlend;
    if (blend) {
      const t = Math.max(0, Math.min(1, blend.leftS / CAMERA_BLEND_S));
      return { ...base, externalCamera: this.externalCamera ?? undefined, cameraBlend: { weight: t * t * (3 - 2 * t), eye: blend.eye, focus: blend.focus, fovDeg: blend.fovDeg } };
    }
    return { ...base, externalCamera: this.externalCamera ?? undefined };
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
    this.launch?.dispose();
    this.launch = null;
    this.session.dispose();
    if (this.savedBackground !== undefined) this.deps.appRenderer.scene.background = this.savedBackground;
  }

  /** The scene background before this match set the arena's (undefined = untouched). */
  private savedBackground: THREE.Scene['background'] | undefined = undefined;
}
