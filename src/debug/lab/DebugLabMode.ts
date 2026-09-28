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
// Reached with ?mode=debug-lab. A Main Menu entry is not wired here: the
// menu's final visual treatment is still behind the owner's approval gate
// (GDD sections 1.6, 56, 171.10).
// ============================================================

import type { AppRenderer } from '../../app/bootstrap/createRenderer';
import { GameState, GameStateMachine } from '../../app/lifecycle/GameState';
import { MatchSession, type Side } from '../../app/session/MatchSession';
import type { SideControllerSpec } from '../../app/session/SideControllers';
import { recordAppBoot, recordError, recordUncaughtErrors } from '../../app/modes/appTelemetry';
import { resolveMatchConfig } from '../../config/match/MatchConfig';
import { resolveAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import { loadAttackProfileOverrides } from '../../config/attack-profile/AttackProfileStorage';
import { KeyboardController } from '../../input/devices/KeyboardController';
import { FixedTimestepLoop } from '../../physics/fixed-step/FixedTimestepLoop';
import { generateRandomSeedText } from '../../rng/stringSeed';
import { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';
import { buildInspection } from '../inspectors/buildInspection';
import { DEBUG_LAB_MULTI_STEP_TICKS, DebugLabPanel, checkbox, labeled } from './DebugLabPanel';
import { DEBUG_LAYERS, DebugVisualLayers, type DebugLayerId } from '../visualization/DebugVisualLayers';
import type { VfxLayer } from '../../vfx/VfxManager';

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
}

declare global {
  interface Window {
    __chaosBeyDebugLab?: DebugLabHandle;
  }
}

export async function startDebugLabMode(appRenderer: AppRenderer, mount: HTMLElement): Promise<DebugLabHandle> {
  const appState = new GameStateMachine();
  appState.transitionTo(GameState.DebugLab);

  const keyboard = new KeyboardController();
  keyboard.attach();
  const matchConfig = resolveMatchConfig();
  const attackProfileSettings = resolveAttackProfileSettings(loadAttackProfileOverrides() ?? undefined);

  let session: MatchSession | null = null;
  let matchState = new GameStateMachine();
  let telemetry = new TelemetryRecorder();
  let paused = false;
  let speed = 1;
  let restarting = false;
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

  const refreshPanel = (fps: number, frameTimeMs: number): void => {
    if (!session) return;
    panel.updateStatus({
      paused,
      speed,
      seedText: session.seedText,
      tickIndex: session.getTickIndex(),
      firstController: controllers.first,
      secondController: controllers.second,
      message,
    });
    const info = appRenderer.renderer.info.render;
    panel.updateInspector(
      buildInspection(session, {
        gameState: `${appState.getCurrentState()} / ${matchState.getCurrentState()}`,
        fps,
        frameTimeMs,
        renderTimeMs: lastRenderTimeMs,
        drawCalls: info.calls,
        triangles: info.triangles,
        paused,
        ticksPerFixedStep: speed,
      }),
    );
  };

  const runTicks = (count: number): void => {
    if (!session || restarting) return;
    for (let i = 0; i < count; i++) session.tick();
  };

  const createSession = async (seedText: string): Promise<void> => {
    restarting = true;
    layers?.dispose();
    layers = null;
    session?.dispose();
    session = null;
    telemetry = new TelemetryRecorder();
    recordAppBoot(telemetry);
    matchState = new GameStateMachine();
    try {
      session = await MatchSession.create({
        scene: appRenderer.scene,
        camera: appRenderer.camera,
        seedText,
        matchConfig,
        attackProfileSettings,
        telemetry,
        stateMachine: matchState,
        controllers: { first: controllers.first, second: controllers.second },
        keyboard,
      });
      matchState.transitionTo(GameState.Combat);
      layers = new DebugVisualLayers(session, enabledLayers);
      for (const layer of Object.keys(vfxLayers) as VfxLayer[]) session.getVfxManager().setLayerVisible(layer, vfxLayers[layer]);
      message = null;
    } finally {
      restarting = false;
    }
  };

  const handle: DebugLabHandle = {
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
      await createSession(seedText ?? session?.seedText ?? generateRandomSeedText());
      refreshPanel(0, 0);
    },
    setController: (side, spec) => {
      controllers[side] = spec;
      session?.setController(side, spec);
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
  panel.addGroup('Presentation (render-only)', [
    labeled('Camera', viewSelect),
    checkbox('Camera effects (shake, FOV)', 'debug-lab-camera-effects', true, (on) => handle.setCameraEffects(on)),
    checkbox('VFX: impact sparks / landing', 'debug-lab-vfx-impactBursts', true, (on) => handle.setVfxLayer('impactBursts', on)),
    checkbox('VFX: speed trails', 'debug-lab-vfx-trails', true, (on) => handle.setVfxLayer('trails', on)),
    checkbox('VFX: speed lines', 'debug-lab-vfx-speedLines', true, (on) => handle.setVfxLayer('speedLines', on)),
  ]);

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
