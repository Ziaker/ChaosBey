// ============================================================
// COMBAT HUD LAB — LIVE MATCH MODE
// Visual-approval Lab only. It runs the real MatchSession (physics, camera,
// AI, VFX, Clash and resource systems) and swaps only the HUD presentation.
// The three directions are intentionally prototypes: none is integrated as
// the game's final HUD until the owner approves one.
// ============================================================

import * as THREE from 'three';
import type { AppRenderer } from '../../app/bootstrap/createRenderer';
import { GameState, GameStateMachine } from '../../app/lifecycle/GameState';
import { MatchSession } from '../../app/session/MatchSession';
import { resolveMatchConfig } from '../../config/match/MatchConfig';
import { resolveAttackProfileSettings } from '../../config/attack-profile/AttackProfileSettings';
import { loadAttackProfileOverrides } from '../../config/attack-profile/AttackProfileStorage';
import { KeyboardController } from '../../input/devices/KeyboardController';
import { cameraYawOf, DirectionalController } from '../../input/directional/DirectionalController';
import { loadPlayerSettings, type CameraPresetSetting } from '../../config/settings/PlayerSettings';
import { TelemetryRecorder } from '../../telemetry/recording/TelemetryRecorder';
import { FixedTimestepLoop, FIXED_TICKS_PER_SECOND } from '../../physics/fixed-step/FixedTimestepLoop';
import { ARENA_FLOORS, ARENA_FLOOR_IDS, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
import { RINGOUT_RADIUS_M } from '../../arena/ringout/RingOutTuning';
import { Action } from '../../input/actions/Action';
import { ClashState } from '../../combat/clash/ClashController';
import { computeClashPower } from '../../combat/clash/ClashFormula';
import { DODGE_COOLDOWN_S } from '../../dodge/DodgeTuning';
import { clashBarShare, followClashBar, hudSide, roundEndBanner, type HudSide } from '../../app/frontend/hudModel';
import {
  forceAction,
  prepareClash,
  setLinearVelocity,
  setResourceFraction,
  teleportBey,
} from '../cheats/DebugMutations';
import {
  COMBAT_HUD_DIRECTIONS,
  COMBAT_HUD_SCENARIOS,
  combatHudDirection,
  combatHudScenario,
  edgeDanger,
  nextDirection,
  resourceBand,
  visibleDirections,
  type CombatHudDirectionId,
  type CombatHudScenarioId,
  type CombatHudViewMode,
} from './CombatHudLabModel';

const SEQUENCE_SECONDS = 4;
const SLOW_DIVISOR = 4;
const PLAYER_ACCENT = '#6fd3ff';
const OPPONENT_ACCENT = '#ff8a4a';

interface LabMeta {
  readonly roundNumber: number;
  readonly playerWins: number;
  readonly opponentWins: number;
  readonly matchPoint: boolean;
  readonly forcedHeadline: string | null;
}

interface SideReadout extends HudSide {
  readonly dodgeCooldown: number;
  readonly speedMps: number;
}

interface HudReadout {
  readonly first: SideReadout;
  readonly second: SideReadout;
  readonly edgeDanger: number;
  readonly roundLabel: string;
  readonly scoreLabel: string;
  readonly eventLabel: string;
  readonly movementLabel: string;
  readonly clashActive: boolean;
  readonly clashShare: number;
  readonly clashPoint: { readonly x: number; readonly y: number } | null;
}

export interface CombatHudLabHandle {
  getSession(): MatchSession | null;
  getDirection(): CombatHudDirectionId;
  getViewMode(): CombatHudViewMode;
  getScenario(): CombatHudScenarioId;
  setDirection(id: CombatHudDirectionId): void;
  setViewMode(mode: CombatHudViewMode): void;
  setScenario(id: CombatHudScenarioId): Promise<void>;
  setArenaFloor(floor: ArenaFloorId): Promise<void>;
  setPaused(paused: boolean): void;
  restart(): Promise<void>;
}

declare global {
  interface Window {
    __chaosBeyCombatHudLab?: CombatHudLabHandle;
  }
}

export async function startCombatHudLabMode(appRenderer: AppRenderer, mount: HTMLElement): Promise<CombatHudLabHandle> {
  injectStyle();

  const root = div('combat-hud-lab');
  root.setAttribute('data-testid', 'combat-hud-lab');
  const panel = div('combat-hud-lab__panel');
  const viewport = div('combat-hud-lab__viewport');
  const surfacesRoot = div('combat-hud-lab__surfaces');
  const labDebug = div('combat-hud-lab__debug');
  const coreArea = div('combat-hud-lab__core-area');
  const coreReadout = div('combat-hud-lab__core-readout');
  labDebug.append(coreArea, coreReadout);
  viewport.append(surfacesRoot, labDebug);
  root.append(panel, viewport);
  mount.append(root);

  let selectedDirection: CombatHudDirectionId = 'A';
  let viewMode: CombatHudViewMode = 'single';
  let scenarioId: CombatHudScenarioId = 'balanced';
  let arenaFloor: ArenaFloorId = 'flat';
  let cameraPreset: CameraPresetSetting = loadPlayerSettings().cameraPreset;
  let paused = false;
  let slow = false;
  let slowGate = 0;
  let sequenceElapsed = 0;
  let debugVisible = false;
  let restarting = false;
  let restartToken = 0;
  let session: MatchSession | null = null;
  let telemetry = new TelemetryRecorder();
  let stateMachine = new GameStateMachine();
  let clashShare = 0.5;
  let lastEventTick = -1;
  let eventHoldS = 0;
  let eventLabel = '';

  const keyboard = new KeyboardController();
  keyboard.attach();
  const directional = new DirectionalController(keyboard, { cameraYaw: () => cameraYawOf(appRenderer.camera) });
  directional.setEnabled(loadPlayerSettings().controlScheme === 'directional');
  const attackProfile = resolveAttackProfileSettings(loadAttackProfileOverrides() ?? undefined);

  const surfaces = new Map<CombatHudDirectionId, HudSurface>();
  for (const direction of COMBAT_HUD_DIRECTIONS) {
    const surface = new HudSurface(direction.id);
    surfaces.set(direction.id, surface);
    surfacesRoot.append(surface.root);
  }

  const title = document.createElement('h1');
  title.textContent = 'Combat HUD Lab';
  const kicker = div('combat-hud-lab__kicker');
  kicker.textContent = 'ChaosBey · live visual prototype';
  const warning = document.createElement('p');
  warning.className = 'combat-hud-lab__warning';
  warning.textContent = 'Approval Lab only. Physics, camera, AI, VFX and combat come from the real MatchSession. A/B/C change presentation only.';
  panel.append(kicker, title, warning);

  const directionGroup = group('HUD DIRECTION');
  for (const direction of COMBAT_HUD_DIRECTIONS) {
    const button = controlButton(`${direction.id} · ${direction.shortName}`, `combat-hud-direction-${direction.id}`);
    button.dataset['direction'] = direction.id;
    button.addEventListener('click', () => handle.setDirection(direction.id));
    directionGroup.append(button);
  }
  panel.append(directionGroup);

  const viewGroup = group('VIEW');
  for (const [mode, label] of [
    ['single', 'Single'],
    ['compare', 'A | B | C'],
    ['sequence', 'A → B → C'],
  ] as const) {
    const button = controlButton(label, `combat-hud-view-${mode}`);
    button.dataset['view'] = mode;
    button.addEventListener('click', () => handle.setViewMode(mode));
    viewGroup.append(button);
  }
  panel.append(viewGroup);

  const scenarioGroup = group('SCENARIO');
  const scenarioSelect = document.createElement('select');
  scenarioSelect.className = 'combat-hud-lab__select';
  scenarioSelect.setAttribute('data-testid', 'combat-hud-scenario');
  for (const scenario of COMBAT_HUD_SCENARIOS) {
    const option = document.createElement('option');
    option.value = scenario.id;
    option.textContent = scenario.label;
    scenarioSelect.append(option);
  }
  const scenarioPurpose = document.createElement('p');
  scenarioPurpose.className = 'combat-hud-lab__note';
  scenarioSelect.addEventListener('change', () => void handle.setScenario(scenarioSelect.value as CombatHudScenarioId));
  scenarioGroup.append(scenarioSelect, scenarioPurpose);
  panel.append(scenarioGroup);

  const floorGroup = group('ARENA FLOOR');
  const floorSelect = document.createElement('select');
  floorSelect.className = 'combat-hud-lab__select';
  floorSelect.setAttribute('data-testid', 'combat-hud-floor');
  for (const id of ARENA_FLOOR_IDS) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = ARENA_FLOORS[id].label;
    floorSelect.append(option);
  }
  floorSelect.addEventListener('change', () => void handle.setArenaFloor(floorSelect.value as ArenaFloorId));
  floorGroup.append(floorSelect);
  panel.append(floorGroup);

  const transport = group('REPLAY / ANALYSIS');
  const pauseButton = controlButton('Pause', 'combat-hud-pause');
  const slowButton = controlButton('¼×', 'combat-hud-slow');
  const restartButton = controlButton('Restart', 'combat-hud-restart');
  const debugButton = controlButton('Obstruction overlay', 'combat-hud-obstruction');
  const panelButton = controlButton('Hide controls', 'combat-hud-panel-toggle');
  pauseButton.addEventListener('click', () => handle.setPaused(!paused));
  slowButton.addEventListener('click', () => {
    slow = !slow;
    refreshControls();
  });
  restartButton.addEventListener('click', () => void handle.restart());
  debugButton.addEventListener('click', () => {
    debugVisible = !debugVisible;
    labDebug.hidden = !debugVisible;
    refreshControls();
  });
  panelButton.addEventListener('click', () => {
    root.classList.toggle('is-panel-hidden');
    panelButton.textContent = root.classList.contains('is-panel-hidden') ? 'Show controls' : 'Hide controls';
  });
  transport.append(pauseButton, slowButton, restartButton, debugButton, panelButton);
  panel.append(transport);

  const directionInfo = document.createElement('p');
  directionInfo.className = 'combat-hud-lab__direction-info';
  panel.append(directionInfo);

  const status = document.createElement('p');
  status.className = 'combat-hud-lab__status';
  status.setAttribute('data-testid', 'combat-hud-status');
  panel.append(status);

  const metaForScenario = (): LabMeta => {
    if (scenarioId === 'match-end') return { roundNumber: 3, playerWins: 1, opponentWins: 1, matchPoint: true, forcedHeadline: 'MATCH POINT' };
    if (scenarioId === 'round-end') return { roundNumber: 2, playerWins: 1, opponentWins: 0, matchPoint: false, forcedHeadline: null };
    return { roundNumber: 1, playerWins: 0, opponentWins: 0, matchPoint: false, forcedHeadline: null };
  };

  const applyScenarioHarness = (live: MatchSession): void => {
    // These are explicit Lab mutations through the same DebugMutations API
    // as Debug Lab. Gameplay rules remain in their owning systems.
    switch (scenarioId) {
      case 'balanced':
      case 'arena-sweep':
        break;
      case 'close-combat':
        teleportBey(live, 'first', 0, -1.5, { headingRad: 0 });
        teleportBey(live, 'second', 0, 1.5, { headingRad: Math.PI });
        break;
      case 'high-speed':
        teleportBey(live, 'first', -1, -6.5, { headingRad: 0 });
        teleportBey(live, 'second', 1, 6.5, { headingRad: Math.PI });
        setLinearVelocity(live, 'first', { x: 1, y: 0, z: 14 });
        setLinearVelocity(live, 'second', { x: -1, y: 0, z: -10 });
        break;
      case 'edge-danger':
        teleportBey(live, 'first', 0, 10.8, { headingRad: Math.PI });
        teleportBey(live, 'second', 0, 7.5, { headingRad: 0 });
        break;
      case 'ring-out':
      case 'round-end':
        teleportBey(live, 'second', 0, 11.2, { headingRad: 0 });
        setLinearVelocity(live, 'second', { x: 0, y: 7.5, z: 15 });
        break;
      case 'match-end':
        teleportBey(live, 'second', 0, 11.1, { headingRad: 0 });
        setLinearVelocity(live, 'second', { x: 0, y: 7, z: 14 });
        break;
      case 'strong-knockback':
        teleportBey(live, 'first', 0, -3.8, { headingRad: 0 });
        teleportBey(live, 'second', 0, 0.8, { headingRad: Math.PI });
        setResourceFraction(live, 'first', 'attackEnergy', 1);
        forceAction(live, 'first', 'dash');
        break;
      case 'drift-recovery': {
        teleportBey(live, 'first', -3, 0, { headingRad: Math.PI / 2 });
        setLinearVelocity(live, 'first', { x: 9, y: 0, z: 0 });
        live.forceInput(
          'first',
          'HUD Lab drift + recovery',
          [
            { fromTick: 0, held: [Action.JumpDrift] },
            { fromTick: 2, held: [Action.JumpDrift, Action.SteerRight] },
            { fromTick: Math.round(0.7 * FIXED_TICKS_PER_SECOND), held: [] },
          ],
          Math.round(1.5 * FIXED_TICKS_PER_SECOND),
        );
        break;
      }
      case 'jump-landing':
        teleportBey(live, 'first', 0, -2, { headingRad: 0 });
        forceAction(live, 'first', 'jump');
        break;
      case 'perfect-dodge':
        teleportBey(live, 'first', 0, -1.5, { headingRad: 0 });
        teleportBey(live, 'second', 0, 1.2, { headingRad: Math.PI });
        setResourceFraction(live, 'second', 'attackEnergy', 1);
        forceAction(live, 'first', 'dodge');
        forceAction(live, 'second', 'circular');
        break;
      case 'clash':
        prepareClash(live);
        break;
      case 'low-stamina':
        setResourceFraction(live, 'first', 'stamina', 0.16);
        setResourceFraction(live, 'second', 'stamina', 0.28);
        break;
      case 'stability-break':
        setResourceFraction(live, 'first', 'stability', 0.06);
        setResourceFraction(live, 'second', 'stability', 0.18);
        teleportBey(live, 'first', 0, -1.8, { headingRad: 0 });
        teleportBey(live, 'second', 0, 1.4, { headingRad: Math.PI });
        forceAction(live, 'second', 'circular');
        break;
    }
  };

  const createSession = async (): Promise<void> => {
    const token = ++restartToken;
    restarting = true;
    session?.dispose();
    session = null;
    telemetry = new TelemetryRecorder();
    stateMachine = new GameStateMachine();
    clashShare = 0.5;
    lastEventTick = -1;
    eventHoldS = 0;
    eventLabel = '';
    const created = await MatchSession.create({
      scene: appRenderer.scene,
      camera: appRenderer.camera,
      seedText: `combat-hud-lab:${scenarioId}:${arenaFloor}`,
      matchConfig: resolveMatchConfig({ arenaFloor }),
      attackProfileSettings: attackProfile,
      telemetry,
      stateMachine,
      controllers: { first: { kind: 'keyboard' }, second: { kind: 'ai', personality: 'archetype' } },
      keyboard: directional,
      cameraPreset,
    });
    if (token !== restartToken) {
      created.dispose();
      return;
    }
    session = created;
    stateMachine.transitionTo(GameState.Combat);
    applyScenarioHarness(created);
    restarting = false;
    refreshControls();
  };

  const handle: CombatHudLabHandle = {
    getSession: () => session,
    getDirection: () => selectedDirection,
    getViewMode: () => viewMode,
    getScenario: () => scenarioId,
    setDirection: (id) => {
      selectedDirection = id;
      sequenceElapsed = 0;
      refreshControls();
    },
    setViewMode: (mode) => {
      viewMode = mode;
      sequenceElapsed = 0;
      refreshControls();
    },
    setScenario: async (id) => {
      scenarioId = id;
      scenarioSelect.value = id;
      await createSession();
    },
    setArenaFloor: async (floor) => {
      arenaFloor = floor;
      floorSelect.value = floor;
      await createSession();
    },
    setPaused: (value) => {
      paused = value;
      refreshControls();
    },
    restart: createSession,
  };
  window.__chaosBeyCombatHudLab = handle;

  const refreshControls = (): void => {
    root.dataset['view'] = viewMode;
    for (const button of directionGroup.querySelectorAll<HTMLButtonElement>('button[data-direction]')) {
      button.setAttribute('aria-pressed', String(button.dataset['direction'] === selectedDirection));
    }
    for (const button of viewGroup.querySelectorAll<HTMLButtonElement>('button[data-view]')) {
      button.setAttribute('aria-pressed', String(button.dataset['view'] === viewMode));
    }
    pauseButton.setAttribute('aria-pressed', String(paused));
    pauseButton.textContent = paused ? 'Resume' : 'Pause';
    slowButton.setAttribute('aria-pressed', String(slow));
    debugButton.setAttribute('aria-pressed', String(debugVisible));
    scenarioPurpose.textContent = combatHudScenario(scenarioId).purpose;
    const info = combatHudDirection(selectedDirection);
    directionInfo.textContent = `${info.name} — ${info.philosophy}`;
    const visible = new Set(visibleDirections(viewMode, selectedDirection));
    for (const [id, surface] of surfaces) surface.root.hidden = !visible.has(id);
    surfacesRoot.classList.toggle('is-compare', viewMode === 'compare');
    status.textContent = restarting
      ? 'Restarting real MatchSession…'
      : `${scenarioId} · ${ARENA_FLOORS[arenaFloor].label} · camera ${cameraPreset} · ${paused ? 'paused' : slow ? '¼×' : '1×'}`;
  };

  const projectClashPoint = (live: MatchSession): { x: number; y: number } | null => {
    const a = live.getBey('first').body.translation();
    const b = live.getBey('second').body.translation();
    const p = new THREE.Vector3((a.x + b.x) / 2, (a.y + b.y) / 2 + 1.1, (a.z + b.z) / 2).project(appRenderer.camera);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  };

  const readSide = (live: MatchSession, side: 'first' | 'second'): SideReadout => {
    const result = live.getLastResult()?.[side];
    const bey = live.getBey(side);
    const facts = result ?? {
      staminaFraction: bey.stamina.resource.fraction,
      stabilityFraction: bey.stability.resource.fraction,
      isBroken: bey.stability.isBroken,
      attackEnergyFraction: bey.attackEnergy.resource.fraction,
      dashChargeFraction: bey.attack.getChargeFraction(),
      attackState: bey.attack.getState(),
    };
    const hud = hudSide(facts);
    const dodgeRemaining = bey.dodge.getDebugTimers().cooldownRemainingS;
    const velocity = bey.body.linvel();
    return {
      ...hud,
      dodgeCooldown: DODGE_COOLDOWN_S > 0 ? Math.min(1, Math.max(0, dodgeRemaining / DODGE_COOLDOWN_S)) : 0,
      speedMps: Math.hypot(velocity.x, velocity.z),
    };
  };

  const readHud = (live: MatchSession, dt: number): HudReadout => {
    const result = live.getLastResult();
    const first = readSide(live, 'first');
    const second = readSide(live, 'second');
    const playerPosition = live.getBey('first').body.translation();
    const danger = edgeDanger(Math.hypot(playerPosition.x, playerPosition.z), RINGOUT_RADIUS_M);
    const clash = live.clash.controller;
    const clashActive = clash.getState() === ClashState.Active;
    if (clashActive) {
      const target = clashBarShare(
        computeClashPower(clash.getFirstMashEventCount(), clash.getFirstStaminaFractionAtStart(), clash.getFirstSpeedMpsAtStart()),
        computeClashPower(clash.getSecondMashEventCount(), clash.getSecondStaminaFractionAtStart(), clash.getSecondSpeedMpsAtStart()),
      );
      clashShare = followClashBar(clashShare, target, dt);
    } else if (clash.getLastResult()) {
      const last = clash.getLastResult()!;
      clashShare = clashBarShare(last.firstClashPower, last.secondClashPower);
    }

    if (result && live.getTickIndex() !== lastEventTick) {
      lastEventTick = live.getTickIndex();
      const perfect = result.combatEvents.some((event) => event.kind === 'perfectDodge' && event.targetIsFirst);
      const breakEvent = result.combatEvents.some((event) => event.kind === 'stabilityBreak');
      const ringOut = result.combatEvents.some((event) => event.kind === 'ringOut');
      if (perfect) {
        eventLabel = 'PERFECT DODGE';
        eventHoldS = 0.8;
      } else if (breakEvent) {
        eventLabel = 'STABILITY BREAK';
        eventHoldS = 0.9;
      } else if (ringOut) {
        eventLabel = 'RING OUT';
        eventHoldS = 1.2;
      }
    }
    eventHoldS = Math.max(0, eventHoldS - dt);
    const meta = metaForScenario();
    const outcome = live.roundState.isOver ? roundEndBanner(String(live.roundState.result)) : null;
    const movement = result?.first.driftState === 'Drifting' ? 'DRIFT' : result?.first.driftState === 'Recovering' ? 'GRIP RECOVERY' : result?.first.dodgeState === 'Dodging' ? 'DODGE' : '';
    return {
      first,
      second,
      edgeDanger: danger,
      roundLabel: meta.matchPoint ? `ROUND ${meta.roundNumber} · MATCH POINT` : `ROUND ${meta.roundNumber}`,
      scoreLabel: `${meta.playerWins}  —  ${meta.opponentWins}`,
      eventLabel: outcome ?? meta.forcedHeadline ?? (eventHoldS > 0 ? eventLabel : ''),
      movementLabel: movement,
      clashActive,
      clashShare,
      clashPoint: clashActive ? projectClashPoint(live) : null,
    };
  };

  const updateObstruction = (): void => {
    if (!debugVisible) return;
    const viewportRect = viewport.getBoundingClientRect();
    const core = {
      left: viewportRect.left + viewportRect.width * 0.28,
      right: viewportRect.left + viewportRect.width * 0.72,
      top: viewportRect.top + viewportRect.height * 0.22,
      bottom: viewportRect.top + viewportRect.height * 0.74,
    };
    const coreAreaPx = Math.max(1, (core.right - core.left) * (core.bottom - core.top));
    let overlap = 0;
    for (const element of viewport.querySelectorAll<HTMLElement>('.combat-hud__card, .combat-hud__event, .combat-hud__clash, .combat-hud__edge')) {
      if (element.hidden) continue;
      const rect = element.getBoundingClientRect();
      const width = Math.max(0, Math.min(rect.right, core.right) - Math.max(rect.left, core.left));
      const height = Math.max(0, Math.min(rect.bottom, core.bottom) - Math.max(rect.top, core.top));
      overlap += width * height;
    }
    const percent = Math.min(100, (overlap / coreAreaPx) * 100);
    coreReadout.textContent = `ACTION CORE OBSTRUCTION ${percent.toFixed(1)}%`;
  };

  const loop = new FixedTimestepLoop({
    onFixedTick: () => {
      if (paused || restarting || !session || session.roundState.isOver) return;
      if (slow) {
        slowGate = (slowGate + 1) % SLOW_DIVISOR;
        if (slowGate !== 0) return;
      }
      session.tick();
    },
    onRenderFrame: (frameDeltaSeconds) => {
      if (!session) {
        appRenderer.render();
        return;
      }
      session.renderFrame(frameDeltaSeconds, appRenderer.camera, { cameraView: 'game', cameraEffects: true, headingArrow: true });
      if (viewMode === 'sequence' && !paused) {
        sequenceElapsed += frameDeltaSeconds;
        if (sequenceElapsed >= SEQUENCE_SECONDS) {
          sequenceElapsed = 0;
          selectedDirection = nextDirection(selectedDirection);
          refreshControls();
        }
      }
      const readout = readHud(session, frameDeltaSeconds);
      for (const [id, surface] of surfaces) {
        if (!surface.root.hidden) surface.update(readout, metaForScenario());
        surface.root.classList.toggle('is-selected', id === selectedDirection);
      }
      updateObstruction();
      appRenderer.render();
    },
    onFatalError: (error) => {
      console.error('Combat HUD Lab loop failed:', error);
      status.textContent = `FATAL: ${error instanceof Error ? error.message : String(error)}`;
    },
  });

  labDebug.hidden = true;
  refreshControls();
  await createSession();
  loop.start();

  window.addEventListener('beforeunload', () => {
    loop.stop();
    keyboard.detach();
    session?.dispose();
    delete window.__chaosBeyCombatHudLab;
  }, { once: true });

  return handle;
}

class HudSurface {
  readonly root = div('combat-hud');
  private readonly first = this.card('first', 'YOU', 'ATTACK', PLAYER_ACCENT);
  private readonly second = this.card('second', 'CPU', 'DEFENSE', OPPONENT_ACCENT);
  private readonly round = div('combat-hud__round');
  private readonly score = div('combat-hud__score');
  private readonly event = div('combat-hud__event');
  private readonly movement = div('combat-hud__movement');
  private readonly edge = div('combat-hud__edge');
  private readonly clash = div('combat-hud__clash');
  private readonly clashFirst = div('combat-hud__clash-first');
  private readonly clashSecond = div('combat-hud__clash-second');

  constructor(readonly direction: CombatHudDirectionId) {
    this.root.dataset['direction'] = direction;
    this.root.setAttribute('data-testid', `combat-hud-surface-${direction}`);
    const centre = div('combat-hud__centre');
    centre.append(this.round, this.score);
    this.clash.append(this.clashFirst, this.clashSecond);
    this.root.append(this.first.root, this.second.root, centre, this.event, this.movement, this.edge, this.clash);
  }

  update(readout: HudReadout, meta: LabMeta): void {
    this.fill(this.first, readout.first);
    this.fill(this.second, readout.second);
    this.round.textContent = readout.roundLabel;
    this.score.textContent = readout.scoreLabel;
    this.event.textContent = readout.eventLabel;
    this.event.hidden = readout.eventLabel === '';
    this.event.classList.toggle('is-match-point', meta.matchPoint);
    this.movement.textContent = readout.movementLabel;
    this.movement.hidden = readout.movementLabel === '';
    this.edge.style.setProperty('--danger', readout.edgeDanger.toFixed(3));
    this.edge.classList.toggle('is-danger', readout.edgeDanger > 0.05);
    this.edge.textContent = readout.edgeDanger > 0.7 ? 'RING-OUT DANGER' : readout.edgeDanger > 0.05 ? 'EDGE' : '';
    this.clash.hidden = !readout.clashActive;
    if (readout.clashActive) {
      this.clashFirst.style.flexGrow = String(readout.clashShare);
      this.clashSecond.style.flexGrow = String(1 - readout.clashShare);
      if (readout.clashPoint) {
        this.clash.style.left = `${readout.clashPoint.x * 100}%`;
        this.clash.style.top = `${readout.clashPoint.y * 100}%`;
      }
    }
  }

  private card(side: 'first' | 'second', who: string, archetype: string, accent: string): FighterCard {
    const root = div(`combat-hud__card combat-hud__card--${side}`);
    root.style.setProperty('--accent', accent);
    const head = div('combat-hud__head');
    const whoEl = document.createElement('strong');
    whoEl.textContent = who;
    const archetypeEl = document.createElement('span');
    archetypeEl.textContent = archetype;
    const state = document.createElement('b');
    state.className = 'combat-hud__state';
    head.append(whoEl, archetypeEl, state);
    root.append(head);
    const stamina = meter(root, 'STA', 'stamina');
    const stability = meter(root, 'STB', 'stability');
    const energy = meter(root, 'ATK', 'energy');
    const dodge = meter(root, 'DODGE', 'dodge');
    const speed = div('combat-hud__speed');
    root.append(speed);
    return { root, state, stamina, stability, energy, dodge, speed };
  }

  private fill(card: FighterCard, side: SideReadout): void {
    setMeter(card.stamina, side.stamina, resourceBand(side.stamina));
    setMeter(card.stability, side.stability, side.broken ? 'critical' : resourceBand(side.stability));
    setMeter(card.energy, side.attackEnergy, 'ok');
    setMeter(card.dodge, 1 - side.dodgeCooldown, side.dodgeCooldown > 0 ? 'warn' : 'ok');
    card.root.classList.toggle('is-broken', side.broken);
    card.state.textContent = side.broken ? 'BROKEN' : side.tag ?? '';
    card.speed.textContent = `${side.speedMps.toFixed(1)} m/s`;
  }
}

interface MeterParts {
  readonly root: HTMLElement;
  readonly fill: HTMLElement;
  readonly value: HTMLElement;
}

interface FighterCard {
  readonly root: HTMLElement;
  readonly state: HTMLElement;
  readonly stamina: MeterParts;
  readonly stability: MeterParts;
  readonly energy: MeterParts;
  readonly dodge: MeterParts;
  readonly speed: HTMLElement;
}

function meter(parent: HTMLElement, label: string, kind: string): MeterParts {
  const root = div(`combat-hud__meter combat-hud__meter--${kind}`);
  const name = document.createElement('span');
  name.textContent = label;
  const track = div('combat-hud__track');
  const fill = div('combat-hud__fill');
  track.append(fill);
  const value = document.createElement('output');
  root.append(name, track, value);
  parent.append(root);
  return { root, fill, value };
}

function setMeter(parts: MeterParts, fraction: number, band: 'ok' | 'warn' | 'critical'): void {
  const clamped = Math.min(1, Math.max(0, fraction));
  parts.fill.style.width = `${clamped * 100}%`;
  parts.root.dataset['band'] = band;
  parts.value.textContent = `${Math.round(clamped * 100)}`;
}

function group(title: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'combat-hud-lab__group';
  const heading = document.createElement('h2');
  heading.textContent = title;
  section.append(heading);
  return section;
}

function controlButton(label: string, testId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'combat-hud-lab__button';
  button.textContent = label;
  button.setAttribute('data-testid', testId);
  return button;
}

function div(className: string): HTMLDivElement {
  const element = document.createElement('div');
  element.className = className;
  return element;
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .combat-hud-lab { position: fixed; inset: 0; z-index: 1200; pointer-events: none; font-family: Inter, system-ui, sans-serif; color: #eaf1ff; --panel-w: 318px; }
    .combat-hud-lab__panel { pointer-events: auto; position: absolute; inset: 0 auto 0 0; width: var(--panel-w); padding: 18px 16px 24px; overflow-y: auto; background: rgba(7,10,16,.96); border-right: 1px solid #273247; box-shadow: 10px 0 30px rgba(0,0,0,.28); transition: transform .18s ease; }
    .combat-hud-lab.is-panel-hidden .combat-hud-lab__panel { transform: translateX(calc(-1 * var(--panel-w) + 44px)); }
    .combat-hud-lab__viewport { position: absolute; inset: 0 0 0 var(--panel-w); transition: left .18s ease; overflow: hidden; }
    .combat-hud-lab.is-panel-hidden .combat-hud-lab__viewport { left: 44px; }
    .combat-hud-lab__kicker { color: #ffb347; text-transform: uppercase; letter-spacing: .16em; font: 700 10px/1.2 ui-monospace, monospace; }
    .combat-hud-lab h1 { margin: 6px 0 8px; font-size: 22px; }
    .combat-hud-lab__warning, .combat-hud-lab__note, .combat-hud-lab__direction-info, .combat-hud-lab__status { margin: 0; color: #93a0b5; font-size: 11px; line-height: 1.45; }
    .combat-hud-lab__warning { border-left: 2px solid #ffb347; padding-left: 9px; }
    .combat-hud-lab__group { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
    .combat-hud-lab__group h2 { flex-basis: 100%; margin: 0 0 2px; color: #7f8aa0; font: 700 10px ui-monospace, monospace; letter-spacing: .14em; }
    .combat-hud-lab__button, .combat-hud-lab__select { border: 1px solid #2a354a; background: #111824; color: #dbe6f8; border-radius: 5px; padding: 7px 9px; font: 600 11px/1.2 inherit; cursor: pointer; }
    .combat-hud-lab__button:hover, .combat-hud-lab__button[aria-pressed='true'] { border-color: #ffb347; background: #242033; }
    .combat-hud-lab__select { width: 100%; }
    .combat-hud-lab__note { flex-basis: 100%; }
    .combat-hud-lab__direction-info { margin-top: 16px; color: #c9d4e6; }
    .combat-hud-lab__status { margin-top: 12px; font-family: ui-monospace, monospace; }
    .combat-hud-lab__surfaces { position: absolute; inset: 0; }
    .combat-hud-lab__surfaces.is-compare { display: grid; grid-template-columns: repeat(3, 1fr); }
    .combat-hud-lab__surfaces.is-compare .combat-hud { position: relative; inset: auto; min-width: 0; border-right: 1px solid rgba(255,255,255,.16); overflow: hidden; }
    .combat-hud-lab__surfaces.is-compare .combat-hud__card { transform: scale(.68); transform-origin: top left; width: 46%; }
    .combat-hud-lab__surfaces.is-compare .combat-hud__card--second { transform-origin: top right; }
    .combat-hud-lab__surfaces.is-compare .combat-hud__centre { transform: translateX(-50%) scale(.72); transform-origin: top center; }

    .combat-hud { --player: ${PLAYER_ACCENT}; --opponent: ${OPPONENT_ACCENT}; position: absolute; inset: 0; pointer-events: none; color: #f4f8ff; }
    .combat-hud__card { position: absolute; top: 16px; width: min(310px, 34vw); padding: 10px 12px; box-sizing: border-box; }
    .combat-hud__card--first { left: 16px; }
    .combat-hud__card--second { right: 16px; }
    .combat-hud__head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 7px; }
    .combat-hud__head strong { color: var(--accent); letter-spacing: .16em; font-size: 11px; }
    .combat-hud__head span { color: #98a5ba; font-size: 10px; letter-spacing: .1em; }
    .combat-hud__state { margin-left: auto; color: #ff5161; font-size: 10px; letter-spacing: .1em; }
    .combat-hud__meter { display: grid; grid-template-columns: 42px 1fr 28px; gap: 6px; align-items: center; min-height: 17px; font: 700 9px ui-monospace, monospace; color: #8e9bb0; }
    .combat-hud__track { height: 6px; background: rgba(255,255,255,.08); overflow: hidden; }
    .combat-hud__fill { height: 100%; background: var(--accent); transition: width .08s linear; }
    .combat-hud__meter[data-band='warn'] .combat-hud__fill { background: #ffb347; }
    .combat-hud__meter[data-band='critical'] .combat-hud__fill { background: #ff4055; }
    .combat-hud__meter output { text-align: right; color: #cfd9e8; }
    .combat-hud__speed { margin-top: 4px; color: #7f8ba0; font: 10px ui-monospace, monospace; }
    .combat-hud__card--second .combat-hud__head { flex-direction: row-reverse; }
    .combat-hud__card--second .combat-hud__state { margin-left: 0; margin-right: auto; }
    .combat-hud__card--second .combat-hud__meter { grid-template-columns: 28px 1fr 42px; direction: rtl; }
    .combat-hud__card--second .combat-hud__meter output { text-align: left; }
    .combat-hud__card--second .combat-hud__speed { text-align: right; }
    .combat-hud__centre { position: absolute; left: 50%; top: 16px; transform: translateX(-50%); text-align: center; }
    .combat-hud__round { font: 800 11px ui-monospace, monospace; letter-spacing: .14em; }
    .combat-hud__score { margin-top: 3px; font: 700 17px ui-monospace, monospace; }
    .combat-hud__event { position: absolute; left: 50%; top: 30%; transform: translate(-50%,-50%); white-space: nowrap; }
    .combat-hud__movement { position: absolute; left: 50%; bottom: 14%; transform: translateX(-50%); font: 800 11px ui-monospace, monospace; letter-spacing: .18em; }
    .combat-hud__edge { position: absolute; inset: auto 16% 5% 16%; text-align: center; opacity: calc(.15 + var(--danger) * .85); font: 900 11px ui-monospace, monospace; letter-spacing: .22em; color: #ff4055; }
    .combat-hud__clash { position: absolute; width: 300px; height: 18px; transform: translate(-50%,-50%) skewX(-18deg); display: flex; overflow: hidden; border: 1px solid rgba(255,255,255,.7); box-shadow: 0 0 18px rgba(255,255,255,.18); background: rgba(4,6,10,.8); }
    .combat-hud__clash-first { background: var(--player); }
    .combat-hud__clash-second { background: var(--opponent); }

    /* A — restrained broadcast composition */
    .combat-hud[data-direction='A'] .combat-hud__card { background: rgba(8,12,18,.76); border: 1px solid rgba(170,190,220,.24); border-top: 2px solid var(--accent); backdrop-filter: blur(4px); }
    .combat-hud[data-direction='A'] .combat-hud__event { padding: 7px 13px; background: rgba(6,9,14,.84); border: 1px solid #ffb347; font: 800 12px ui-monospace, monospace; letter-spacing: .18em; }
    .combat-hud[data-direction='A'] .combat-hud__movement { padding: 5px 9px; background: rgba(5,8,12,.7); border-radius: 3px; }

    /* B — expressive anime-fighter composition */
    .combat-hud[data-direction='B'] .combat-hud__card { top: auto; bottom: 18px; background: linear-gradient(110deg, rgba(9,10,18,.9), rgba(24,12,28,.68)); border-left: 4px solid var(--accent); clip-path: polygon(0 0, 94% 0, 100% 16%, 100% 100%, 6% 100%, 0 84%); filter: drop-shadow(0 6px 12px rgba(0,0,0,.5)); }
    .combat-hud[data-direction='B'] .combat-hud__card--second { border-left: 0; border-right: 4px solid var(--accent); }
    .combat-hud[data-direction='B'] .combat-hud__track { height: 8px; transform: skewX(-14deg); }
    .combat-hud[data-direction='B'] .combat-hud__fill { box-shadow: 0 0 10px var(--accent); }
    .combat-hud[data-direction='B'] .combat-hud__event { top: 24%; color: #fff; font: 950 clamp(20px,4vw,52px)/1 system-ui,sans-serif; font-style: italic; letter-spacing: -.03em; text-shadow: 0 0 10px #ff4fa3, 3px 3px 0 #14101d; transform: translate(-50%,-50%) rotate(-3deg); }
    .combat-hud[data-direction='B'] .combat-hud__event.is-match-point { color: #ffe066; }
    .combat-hud[data-direction='B'] .combat-hud__movement { bottom: 24%; color: #bfeaff; text-shadow: 0 0 8px #6fd3ff; }
    .combat-hud[data-direction='B'] .combat-hud__edge.is-danger { font-size: 15px; text-shadow: 0 0 10px #ff4055; animation: cbHudPulse .5s ease-in-out infinite alternate; }

    /* C — segmented instrument / tactical composition */
    .combat-hud[data-direction='C'] .combat-hud__card { top: 50%; transform: translateY(-50%); width: 218px; background: rgba(4,9,14,.86); border: 1px solid #33506a; box-shadow: inset 0 0 0 1px rgba(111,211,255,.08); }
    .combat-hud[data-direction='C'] .combat-hud__card--first { left: 14px; }
    .combat-hud[data-direction='C'] .combat-hud__card--second { right: 14px; }
    .combat-hud[data-direction='C'] .combat-hud__meter { grid-template-columns: 42px 1fr 26px; }
    .combat-hud[data-direction='C'] .combat-hud__track { height: 9px; background: repeating-linear-gradient(90deg, rgba(255,255,255,.08) 0 8%, transparent 8% 10%); border: 1px solid rgba(160,190,220,.18); }
    .combat-hud[data-direction='C'] .combat-hud__fill { background: repeating-linear-gradient(90deg, var(--accent) 0 8%, transparent 8% 10%); }
    .combat-hud[data-direction='C'] .combat-hud__centre { top: 10px; padding: 6px 11px; background: rgba(4,9,14,.82); border: 1px solid #33506a; }
    .combat-hud[data-direction='C'] .combat-hud__event { top: 18%; padding: 5px 10px; color: #d8f5ff; background: rgba(4,9,14,.9); border: 1px solid #6fd3ff; font: 800 11px ui-monospace, monospace; letter-spacing: .15em; }
    .combat-hud[data-direction='C'] .combat-hud__movement { bottom: 9%; border: 1px solid #33506a; background: rgba(4,9,14,.84); padding: 4px 8px; color: #aadaee; }
    .combat-hud[data-direction='C'] .combat-hud__edge { left: 24%; right: 24%; border-bottom: 3px repeating-linear-gradient(90deg,#ffcc45 0 8px,#1a1d22 8px 16px); }

    .combat-hud-lab__debug { position: absolute; inset: 0; pointer-events: none; }
    .combat-hud-lab__core-area { position: absolute; left: 28%; right: 28%; top: 22%; bottom: 26%; border: 1px dashed rgba(255,70,90,.72); background: rgba(255,70,90,.035); }
    .combat-hud-lab__core-readout { position: absolute; right: 10px; bottom: 10px; padding: 5px 7px; background: rgba(5,8,12,.85); border: 1px solid #ff4055; color: #ffc5cc; font: 10px ui-monospace, monospace; }
    @keyframes cbHudPulse { from { opacity: .65; transform: scale(.98); } to { opacity: 1; transform: scale(1.02); } }
    @media (max-width: 900px) {
      .combat-hud-lab { --panel-w: 260px; }
      .combat-hud__card { width: min(240px, 36vw); }
      .combat-hud[data-direction='C'] .combat-hud__card { width: 180px; }
    }
  `;
  document.head.append(style);
}
