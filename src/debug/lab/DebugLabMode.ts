// ============================================================
// DEBUG LAB MODE (GDD sections 1.2, 69, 70, 144)
// A live, rendered match on the shared MatchSession pipeline, plus the
// developer controls GDD section 70 asks for: pause, resume, single-step,
// restart same seed / new seed / typed seed, simulation speed, and live
// controller switching per side. The inspector shows GDD section 69's raw
// state.
//
// Simulation rules the lab must keep (GDD sections 80, 160, 164):
// - it only ever advances whole fixed ticks through MatchSession.tick();
// - speed-up runs more fixed ticks per production step, never a bigger
//   delta;
// - pausing, stepping and inspecting never change what a tick computes;
//   the same seed + controllers replay the same fight.
//
// Reached with ?mode=debug-lab, directly or from the Main Menu's
// Developer / Debug section (app/menu/MainMenu.ts), which loads that URL.
// ============================================================

import type * as THREE from 'three';
import type { AppRenderer } from '../../app/bootstrap/createRenderer';
import { GameState, GameStateMachine } from '../../app/lifecycle/GameState';
import { MatchSession, type Side } from '../../app/session/MatchSession';
import type { SideControllerSpec } from '../../app/session/SideControllers';
import { recordAppBoot, recordError, recordUncaughtErrors } from '../../app/modes/appTelemetry';
import { resolveMatchConfig } from '../../config/match/MatchConfig';
import { resolveAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import { loadAttackProfileOverrides } from '../../config/attack-profile/AttackProfileStorage';
import { KeyboardController } from '../../input/devices/KeyboardController';
import { DirectionalController } from '../../input/directional/DirectionalController';
import { loadPlayerSettings, type CameraPresetSetting } from '../../config/settings/PlayerSettings';
import { ARENA_FLOORS, ARENA_FLOOR_IDS, isArenaFloorId, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
import { DEFAULT_MOTION_DIRECTION, isMotionDirectionId, MOTION_DIRECTION_IDS, MOTION_DIRECTIONS, type MotionDirectionId } from '../../bey/motion/MotionPresets';
import { FixedTimestepLoop } from '../../physics/fixed-step/FixedTimestepLoop';
import { generateRandomSeedText } from '../../rng/stringSeed';
import { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';
import { buildInspection } from '../inspectors/buildInspection';
import { DEBUG_LAB_MULTI_STEP_TICKS, DebugLabPanel, button, checkbox, labeled } from './DebugLabPanel';
import { DEBUG_LAYERS, DebugVisualLayers, type DebugLayerId } from '../visualization/DebugVisualLayers';
import type { VfxLayer } from '../../vfx/VfxManager';
import { createDebugLabTools } from './DebugLabTools';
import { SCENARIO_PRESETS, findScenarioPreset } from '../../self-test/scenarios/ScenarioPresets';
import type { ScenarioSideScript } from '../../self-test/scenarios/ScenarioPresets';
import { buildDebugReport } from '../report/buildDebugReport';
import type { MatchConfig } from '../../config/match/MatchConfig';
import type { BeyAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import { decodeReplay, encodeReplay } from '../../replay/format/ChaosBeyReplayV1';
import { currentRuntimeFingerprint } from '../../replay/format/runtimeFingerprint';
import { checkReplayCompatibility, framesFromReplay } from '../../replay/playback/replayPlayback';
import { LiveReplayCheck, liveLabIncompatibility } from './DebugLabReplay';

// ============================================================
// DEBUG LAB MODE — TUNING
// ============================================================

/** Inspector refresh period while running, in rendered frames (the text panel is the costliest part of the lab). */
const INSPECTOR_REFRESH_EVERY_N_FRAMES = 6;

/** Controllers a fresh lab starts with: the live game's own pairing. */
const INITIAL_CONTROLLERS: { first: SideControllerSpec; second: SideControllerSpec } = {
  first: { kind: 'keyboard' },
  second: { kind: 'ai', personality: 'archetype' },
};

/** Test/automation hook: read-only view plus the same actions the buttons trigger. */
export interface DebugLabHandle {
  getSession(): MatchSession | null;
  isPaused(): boolean;
  setPaused(paused: boolean): void;
  step(ticks: number): void;
  restart(seedText: string | null): Promise<void>;
  setController(side: Side, spec: SideControllerSpec): void;
  setSpeed(ticksPerFixedStep: number): void;
  setLayer(id: DebugLayerId, on: boolean): void;
  getLayers(): DebugVisualLayers | null;
  setVfxLayer(layer: VfxLayer, visible: boolean): void;
  setCameraEffects(on: boolean): void;
  setCameraView(view: 'game' | 'overview'): void;
  /** Restarts on the current seed and sets up a GDD 68 preset (Beys placed, both sides scripted). */
  loadPreset(id: string): Promise<void>;
  /** M9: restarts on the current seed and records the match from tick 0. */
  startRecording(): Promise<void>;
  /** M9: ends the recording; the ChaosBeyReplayV1 file text and the Debug Lab state edits made meanwhile (null if not recording). */
  stopRecording(): { readonly text: string; readonly stateEdits: readonly string[] } | null;
  /** M9: imports a replay file and plays it back live, checking every checkpoint. Resolves false (with the reason on the panel) if refused. */
  playReplay(text: string): Promise<boolean>;
  /** M9: the playback check's status line, or null when not replaying. */
  replayStatus(): string | null;
  /** M11: the camera the player looks through (read-only use: projecting to the screen in smoke tests). */
  getCamera(): THREE.PerspectiveCamera;
  /** M11 lane 4: the floor profile (flat / bowl A/B/C); restarts the match on the current seed. */
  setArenaFloor(floor: ArenaFloorId): Promise<void>;
  /** M11: the motion direction (Motion Lab A/B/C); restarts the match. */
  setMotion(motion: MotionDirectionId): Promise<void>;
  /** M11: the game camera preset (A/B/C), kept across restarts. Render only. */
  setCameraPreset(preset: CameraPresetSetting): void;
}

declare global {
  interface Window {
    __chaosBeyDebugLab?: DebugLabHandle;
  }
}

export async function startDebugLabMode(appRenderer: AppRenderer, mount: HTMLElement): Promise<DebugLabHandle> {
  const appState = new GameStateMachine();
  appState.transitionTo(GameState.DebugLab);

  // Blur/focus loss cancels a pending jump-input-buffer press the same
  // moment currentlyDown/the hold buffer are cleared (GDD 131) — `session`
  // (declared further below) is read through this closure once it exists.
  const keyboard = new KeyboardController(() => session?.cancelBufferedJumps());
  keyboard.attach();
  // M11: the player's control scheme from Settings (Directional/camera-
  // relative by default, "Fix 7" — see DirectionalController.ts's and
  // screenDirection.ts's headers; Classic/Bey-relative is a selectable
  // option). The camera reaches this only as a number (radians), read
  // from the Lab's current session below (declared further down, but this
  // closure isn't called until a real tick runs, long after `session` is
  // first assigned) — never a camera type/import.
  const playerInput = new DirectionalController(keyboard, {
    cameraYaw: () => ((session?.getLastCameraOutput()?.yawDeg ?? 0) * Math.PI) / 180,
  });
  playerInput.setEnabled(loadPlayerSettings().controlScheme === 'directional');
  // M11: the game camera preset from Settings (A/B/C; the Clash forces B).
  let cameraPreset: CameraPresetSetting = loadPlayerSettings().cameraPreset;
  // M11 lane 4: the floor profile to test (`&floor=bowl-a`, the panel, or the handle); flat by default.
  const floorParam = new URLSearchParams(window.location.search).get('floor');
  // M11: the motion direction to test (`&motion=A`, the panel, or the handle); B by default.
  const motionParam = new URLSearchParams(window.location.search).get('motion');
  let labMatchConfig = resolveMatchConfig({ arenaFloor: isArenaFloorId(floorParam) ? floorParam : 'flat', motion: isMotionDirectionId(motionParam) ? motionParam : DEFAULT_MOTION_DIRECTION });
  const labAttackProfileSettings = resolveAttackProfileSettings(loadAttackProfileOverrides() ?? undefined);
  /** M9: while a replay plays, the session is built from the replay's own config, never the Lab's (owner decision 3). */
  let replayCheck: LiveReplayCheck | null = null;

  let session: MatchSession | null = null;
  let matchState = new GameStateMachine();
  let telemetry = new TelemetryRecorder();
  let paused = false;
  let speed = 1;
  let restarting = false;
  /** Bumped on every createSession() call; lets a call whose await resolves after a newer one started detect it's stale (see createSession). */
  let restartToken = 0;
  let message: string | null = null;
  let framesSinceInspector = 0;
  let lastRenderTimeMs: number | null = null;
  const controllers = { ...INITIAL_CONTROLLERS };
  // Visualization/presentation choices outlive a restart.
  let layers: DebugVisualLayers | null = null;
  const enabledLayers = new Set<DebugLayerId>();
  const vfxLayers: Record<VfxLayer, boolean> = { impactBursts: true, trails: true, speedLines: true };
  let cameraEffects = true;
  let cameraView: 'game' | 'overview' = 'game';

  recordAppBoot(telemetry);
  recordUncaughtErrors(() => telemetry);

  const panel = new DebugLabPanel(mount, {
    onTogglePause: () => handle.setPaused(!paused),
    onStep: (ticks) => handle.step(ticks),
    onRestart: (seedText) => void handle.restart(seedText),
    onNewSeed: () => void handle.restart(generateRandomSeedText()),
    onSpeed: (ticks) => handle.setSpeed(ticks),
    onController: (side, spec) => handle.setController(side, spec),
  });

  let lastFps = 0;
  let lastFrameTimeMs = 0;
  const frameStats = (): Parameters<typeof buildInspection>[1] => {
    const info = appRenderer.renderer.info.render;
    return {
      gameState: `${appState.getCurrentState()} / ${matchState.getCurrentState()}`,
      fps: lastFps,
      frameTimeMs: lastFrameTimeMs,
      renderTimeMs: lastRenderTimeMs,
      drawCalls: info.calls,
      triangles: info.triangles,
      paused,
      ticksPerFixedStep: speed,
      ...(replayCheck && session ? { replayState: replayCheck.describe(session.getTickIndex()) } : session?.isCapturingReplay() ? { replayState: 'recording (not replaying)' } : {}),
    };
  };

  const refreshPanel = (fps: number, frameTimeMs: number): void => {
    if (!session) return;
    if (fps > 0) {
      lastFps = fps;
      lastFrameTimeMs = frameTimeMs;
    }
    tools?.refreshLog();
    panel.updateStatus({
      paused,
      speed,
      seedText: session.seedText,
      tickIndex: session.getTickIndex(),
      firstController: controllers.first,
      secondController: controllers.second,
      // A finished round is frozen by tickMatch; say so, or ticks look stuck
      // (after the latest message, which may be why, e.g. a refused replay).
      message: [message, session.roundState.isOver ? `ROUND OVER (${session.roundState.result}) — frozen, restart to continue` : null].filter((m) => m !== null).join(' · ') || null,
    });
    panel.updateInspector(buildInspection(session, frameStats()));
  };
  let tools: ReturnType<typeof createDebugLabTools> | null = null;

  const runTicks = (count: number): void => {
    if (!session || restarting) return;
    for (let i = 0; i < count; i++) {
      if (replayCheck && session.getTickIndex() >= replayCheck.length) {
        // The recording ends here: stop instead of running past it.
        paused = true;
        message = replayCheck.describe(session.getTickIndex());
        return;
      }
      session.tick();
      replayCheck?.check(session.getTickIndex(), session.getStateHash());
    }
  };

  /** Leaving a replay: its controllers can't drive a fresh match. */
  const leaveReplay = (): void => {
    if (!replayCheck) return;
    replayCheck = null;
    controllers.first = INITIAL_CONTROLLERS.first;
    controllers.second = INITIAL_CONTROLLERS.second;
  };

  const createSession = async (seedText: string, config?: { matchConfig: MatchConfig; attackProfileSettings: BeyAttackProfileSettings }): Promise<void> => {
    const myToken = ++restartToken;
    restarting = true;
    layers?.dispose();
    layers = null;
    session?.dispose();
    session = null;
    telemetry = new TelemetryRecorder();
    recordAppBoot(telemetry);
    matchState = new GameStateMachine();
    try {
      const newSession = await MatchSession.create({
        scene: appRenderer.scene,
        camera: appRenderer.camera,
        seedText,
        matchConfig: config?.matchConfig ?? labMatchConfig,
        attackProfileSettings: config?.attackProfileSettings ?? labAttackProfileSettings,
        telemetry,
        stateMachine: matchState,
        controllers: { first: controllers.first, second: controllers.second },
        keyboard: playerInput,
        cameraPreset,
        conditionLayers: loadPlayerSettings().conditionLayers,
        renderer: appRenderer.renderer,
      });
      if (myToken !== restartToken) {
        // A newer restart (Restart/New Seed/loadPreset clicked again before
        // this one's async MatchSession.create() finished) already won and
        // owns `session` — adopt nothing here, and free this call's own
        // Rapier world/scene subtree instead of leaking it.
        newSession.dispose();
        return;
      }
      session = newSession;
      matchState.transitionTo(GameState.Combat);
      layers = new DebugVisualLayers(session, enabledLayers);
      for (const layer of Object.keys(vfxLayers) as VfxLayer[]) session.getVfxManager().setLayerVisible(layer, vfxLayers[layer]);
      message = null;
    } finally {
      if (myToken === restartToken) restarting = false;
    }
  };

  const handle: DebugLabHandle = {
    getCamera: () => appRenderer.camera,
    setArenaFloor: async (floor) => {
      labMatchConfig = resolveMatchConfig({ ...labMatchConfig, arenaFloor: floor });
      floorSelect.value = floor;
      await handle.restart(null);
    },
    setMotion: async (motion) => {
      labMatchConfig = resolveMatchConfig({ ...labMatchConfig, motion });
      motionSelect.value = motion;
      await handle.restart(null);
    },
    setCameraPreset: (preset) => {
      cameraPreset = preset;
      session?.setCameraPreset(preset);
    },
    getSession: () => session,
    isPaused: () => paused,
    setPaused: (next) => {
      paused = next;
      refreshPanel(0, 0);
    },
    step: (ticks) => {
      // Stepping implies pause: a step while running would be invisible.
      paused = true;
      runTicks(ticks);
      refreshPanel(0, 0);
    },
    restart: async (seedText) => {
      // normalizeSeedText() throws on an empty/whitespace-only string
      // (SeededRng.fromSeedText -> createRngStreams), which MatchSession
      // .create() never catches — an empty string here (not just null:
      // DebugLabHandle.restart is a public window.__chaosBeyDebugLab API,
      // not only the panel's own "typed seed" button, which already guards
      // this at the DOM layer) used to throw out of createSession(), leaving
      // `session` stuck at null with no round running. Treat blank the same
      // as null/undefined.
      const trimmed = seedText?.trim();
      leaveReplay();
      await createSession(trimmed || session?.seedText || generateRandomSeedText());
      refreshPanel(0, 0);
    },
    setController: (side, spec) => {
      if (replayCheck) message = 'controller changed: the replay no longer drives this side';
      replayCheck = null;
      controllers[side] = spec;
      session?.setController(side, spec);
      // setController() may have moved the OTHER side off Keyboard too (only
      // one side may ever hold the shared device) — re-read both sides from
      // the session, the source of truth, so the panel's dropdowns don't
      // drift out of sync with it.
      if (session) {
        controllers.first = session.getControllerSpec('first');
        controllers.second = session.getControllerSpec('second');
      }
      message = `${side} → ${session?.describeController(side) ?? spec.kind}`;
      refreshPanel(0, 0);
    },
    setSpeed: (ticksPerFixedStep) => {
      speed = Math.max(1, Math.floor(ticksPerFixedStep));
      refreshPanel(0, 0);
    },
    setLayer: (id, on) => {
      if (on) enabledLayers.add(id);
      else enabledLayers.delete(id);
      layers?.setEnabled(id, on);
    },
    getLayers: () => layers,
    setVfxLayer: (layer, visible) => {
      vfxLayers[layer] = visible;
      session?.getVfxManager().setLayerVisible(layer, visible);
    },
    setCameraEffects: (on) => {
      cameraEffects = on;
    },
    setCameraView: (view) => {
      cameraView = view;
    },
    loadPreset: async (id) => {
      const preset = findScenarioPreset(id);
      if (!preset || !preset.supported || preset.run) {
        message = !preset ? `unknown preset ${id}` : preset.run ? `${preset.label} runs headless: use the Self Test` : `${preset.label}: ${preset.unsupportedReason ?? 'unsupported'}`;
        refreshPanel(0, 0);
        return;
      }
      leaveReplay();
      const toSpec = (side: ScenarioSideScript): SideControllerSpec => (side.kind === 'script' ? { kind: 'scripted', label: preset.id, frames: side.frames } : { kind: 'idle' });
      controllers.first = toSpec(preset.first);
      controllers.second = toSpec(preset.second);
      await createSession(session?.seedText ?? generateRandomSeedText());
      if (!session) return;
      preset.setup?.({ first: session.getBey('first'), second: session.getBey('second') });
      session.recordDebugMutation(`loaded scenario preset "${preset.label}" (${preset.durationTicks} ticks)`);
      message = `preset: ${preset.label}`;
      refreshPanel(0, 0);
    },
    startRecording: async () => {
      leaveReplay();
      await createSession(session?.seedText ?? generateRandomSeedText());
      if (!session) return;
      session.startReplayCapture({ fingerprint: await currentRuntimeFingerprint() });
      message = 'recording from tick 0 (Stop & download to save the replay)';
      refreshPanel(0, 0);
    },
    stopRecording: () => {
      if (!session?.isCapturingReplay()) return null;
      const { replay, debugMutations } = session.finishReplayCapture();
      const stateEdits = debugMutations.map((m) => `tick ${m.tickIndex}: ${m.description}`);
      message = `recorded ${replay.frames.length} ticks${stateEdits.length > 0 ? ` — WARNING: ${stateEdits.length} state edit(s) while recording, this replay will diverge` : ''}`;
      refreshPanel(0, 0);
      return { text: encodeReplay(replay), stateEdits };
    },
    playReplay: async (text) => {
      const decoded = decodeReplay(text);
      if (!decoded.ok) {
        message = `replay refused: ${decoded.errors.slice(0, 3).map((e) => `${e.path}: ${e.code}`).join('; ')}`;
        refreshPanel(0, 0);
        return false;
      }
      const replay = decoded.replay;
      const compatibility = checkReplayCompatibility(replay, await currentRuntimeFingerprint());
      const refusal = compatibility.ok ? liveLabIncompatibility(replay, compatibility) : compatibility.refusals.map((r) => r.code).join(', ');
      if (refusal) {
        message = `replay refused: ${refusal}`;
        refreshPanel(0, 0);
        return false;
      }
      const frames = framesFromReplay(replay);
      controllers.first = { kind: 'replay', label: 'replay', frames: frames.first };
      controllers.second = { kind: 'replay', label: 'replay', frames: frames.second };
      await createSession(replay.config.seedText, { matchConfig: resolveMatchConfig(replay.config.matchConfig), attackProfileSettings: replay.config.attackProfileSettings });
      if (!session) return false;
      replayCheck = new LiveReplayCheck(replay);
      replayCheck.check(0, session.getStateHash());
      message = replayCheck.describe(0);
      refreshPanel(0, 0);
      return true;
    },
    replayStatus: () => (replayCheck && session ? replayCheck.describe(session.getTickIndex()) : null),
  };

  panel.addGroup(
    'Visualization (GDD 70/71)',
    DEBUG_LAYERS.map((layer) => checkbox(layer.label, `debug-lab-layer-${layer.id}`, false, (on) => handle.setLayer(layer.id, on))),
  );
  const viewSelect = document.createElement('select');
  viewSelect.setAttribute('data-testid', 'debug-lab-camera-view');
  for (const [value, text] of [
    ['game', 'Game camera'],
    ['overview', 'Overview (fixed, whole arena)'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    viewSelect.append(option);
  }
  viewSelect.addEventListener('change', () => {
    handle.setCameraView(viewSelect.value === 'overview' ? 'overview' : 'game');
    viewSelect.blur();
  });
  const floorSelect = document.createElement('select');
  floorSelect.setAttribute('data-testid', 'debug-lab-arena-floor');
  for (const id of ARENA_FLOOR_IDS) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = ARENA_FLOORS[id].label;
    floorSelect.append(option);
  }
  floorSelect.value = labMatchConfig.arenaFloor;
  floorSelect.addEventListener('change', () => {
    if (isArenaFloorId(floorSelect.value)) void handle.setArenaFloor(floorSelect.value);
    floorSelect.blur();
  });
  panel.addGroup('Arena floor (M11 playtest — restarts the match)', [labeled('Floor', floorSelect)]);
  const motionSelect = document.createElement('select');
  motionSelect.setAttribute('data-testid', 'debug-lab-motion');
  for (const id of MOTION_DIRECTION_IDS) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = MOTION_DIRECTIONS[id].name;
    motionSelect.append(option);
  }
  motionSelect.value = labMatchConfig.motion;
  motionSelect.addEventListener('change', () => {
    if (isMotionDirectionId(motionSelect.value)) void handle.setMotion(motionSelect.value);
    motionSelect.blur();
  });
  panel.addGroup('Movement (Motion Lab A/B/C — restarts the match)', [labeled('Direction', motionSelect)]);
  panel.addGroup('Presentation (render-only)', [
    labeled('Camera', viewSelect),
    checkbox('Camera effects (shake, FOV)', 'debug-lab-camera-effects', true, (on) => handle.setCameraEffects(on)),
    checkbox('VFX: impact sparks / landing', 'debug-lab-vfx-impactBursts', true, (on) => handle.setVfxLayer('impactBursts', on)),
    checkbox('VFX: speed trails', 'debug-lab-vfx-trails', true, (on) => handle.setVfxLayer('trails', on)),
    checkbox('VFX: speed lines', 'debug-lab-vfx-speedLines', true, (on) => handle.setVfxLayer('speedLines', on)),
  ]);
  tools = createDebugLabTools({
    getSession: () => (restarting ? null : session),
    onMutated: () => refreshPanel(0, 0),
    buildReport: () => (session && !restarting ? buildDebugReport(session, frameStats()) : null),
  });
  const presetSelect = document.createElement('select');
  presetSelect.setAttribute('data-testid', 'debug-lab-preset');
  for (const preset of SCENARIO_PRESETS) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.run ? `${preset.label} (Self Test only)` : preset.supported ? preset.label : `${preset.label} (unsupported)`;
    option.disabled = !preset.supported || preset.run !== undefined;
    presetSelect.append(option);
  }
  presetSelect.addEventListener('change', () => presetSelect.blur());
  panel.addGroup('Scenario presets (GDD 68)', [
    labeled('Preset', presetSelect),
    button('Load preset (restart + set up, both sides scripted)', 'debug-lab-preset-load', () => void handle.loadPreset(presetSelect.value)),
  ]);
  const replayFile = document.createElement('input');
  replayFile.type = 'file';
  replayFile.accept = '.json,application/json';
  replayFile.setAttribute('data-testid', 'debug-lab-replay-file');
  replayFile.addEventListener('change', () => {
    const file = replayFile.files?.[0];
    if (file) void file.text().then((text) => handle.playReplay(text));
    replayFile.value = '';
    replayFile.blur();
  });
  panel.addGroup('Replay (M9)', [
    button('Record from start (restart + record)', 'debug-lab-replay-record', () => void handle.startRecording()),
    button('Stop & download replay (.json)', 'debug-lab-replay-stop', () => {
      const recorded = handle.stopRecording();
      if (!recorded) return;
      const url = URL.createObjectURL(new Blob([recorded.text], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `chaosbey-replay-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }),
    labeled('Import & play', replayFile),
  ]);
  panel.addGroup('Mutations — change the simulation (GDD 70)', tools.mutationControls);
  panel.addGroup('Debug report', tools.reportControls);

  await createSession(generateRandomSeedText());

  const loop = new FixedTimestepLoop({
    onFixedTick: () => {
      if (!paused) runTicks(speed);
    },
    onRenderFrame: (frameDeltaSeconds) => {
      if (session && !restarting) {
        session.renderFrame(frameDeltaSeconds, appRenderer.camera, { cameraView, cameraEffects });
        layers?.update();
      }
      const renderStart = performance.now();
      appRenderer.render();
      lastRenderTimeMs = performance.now() - renderStart;
      framesSinceInspector++;
      if (framesSinceInspector >= INSPECTOR_REFRESH_EVERY_N_FRAMES) {
        framesSinceInspector = 0;
        refreshPanel(frameDeltaSeconds > 0 ? 1 / frameDeltaSeconds : 0, frameDeltaSeconds * 1000);
      }
    },
    onFatalError: (error, tickIndex) => {
      recordError(telemetry, error);
      console.error(`ChaosBey Debug Lab simulation halted at tick ${tickIndex}:`, error);
      message = `SIMULATION HALTED: ${error instanceof Error ? error.message : String(error)}`;
      refreshPanel(0, 0);
    },
  });

  window.addEventListener('keydown', (event) => {
    if (panel.isTypingInField() || event.repeat) return;
    switch (event.code) {
      case 'KeyP':
        handle.setPaused(!paused);
        break;
      case 'KeyN':
        handle.step(1);
        break;
      case 'KeyM':
        handle.step(DEBUG_LAB_MULTI_STEP_TICKS);
        break;
      case 'KeyR':
        void handle.restart(null);
        break;
      case 'KeyT':
        void handle.restart(generateRandomSeedText());
        break;
      default:
        return;
    }
    event.preventDefault();
  });

  window.addEventListener('beforeunload', () => {
    loop.stop();
    keyboard.detach();
    layers?.dispose();
    session?.dispose();
    appRenderer.dispose();
  });

  loop.start();
  refreshPanel(0, 0);
  window.__chaosBeyDebugLab = handle;
  return handle;
}
