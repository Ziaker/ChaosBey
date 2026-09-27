// ============================================================
// CLASH PRESENTATION LAB — PAGE WIRING
// Isolated Clash-presentation prototype (GDD 1.6/1.7, sections 39-45).
// Owns the fixed 60Hz loop (with render interpolation, like the other
// labs), the physical stage (ClashStageSim, real Rapier + the real
// src/combat/clash/ package), the approved CameraDirector (all three
// presets always ticking, so switching is instant, exactly like the
// Camera Lab), the arena-visual-concepts art, and the three presentation
// directions. Automation hook for the smoke test: window.__clashLab.
// ============================================================

import { CameraDirector, type DirectorOutput } from '../../camera-concepts/src/director/CameraDirector';
import { PRESETS, PRESET_IDS, cloneParams, type CameraParams, type PresetId } from '../../camera-concepts/src/director/CameraParams';
import type { FightFrame, Vec3 } from '../../camera-concepts/src/fight/FightFrame';
import { ClashHarness } from './harness/ClashHarness';
import { KeyboardMashCapture, ScriptedMashDriver, type MashLogEntry } from './harness/mash';
import { SCENARIOS, mashSourceFor, scenarioById, type ClashScenario } from './harness/scenarios';
import { ClashPresenter, type PresentationHost } from './presentation/ClashPresenter';
import { DIRECTIONS, DIRECTION_IDS } from './presentation/directions';
import { TIE_STYLES, TIE_STYLE_IDS } from './presentation/tieStyles';
import type { BannerStyle, DirectionId, TieStyleId } from './presentation/types';
import { ClashStageSim } from './sim/ClashStageSim';
import { ClashStageView } from './stage/ClashStageView';

// ---------------- PAGE TUNING ----------------
const DT = 1 / 60;
const MAX_TICKS_PER_FRAME = 8;
const SPEEDS = [1, 0.5, 0.25, 2, 4];
const FLASH_DURATION_S = 0.35;
const BANNER_HOLD_EXTRA_S = 0.4;
// ------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const lab = {
  scenarioId: SCENARIOS[0]!.id,
  directionId: 'B' as DirectionId,
  tieStyleId: DIRECTIONS.B.defaultTieStyle as TieStyleId,
  cameraPresetId: 'B' as PresetId,
  firstMashMode: 'scripted' as 'scripted' | 'keyboard',
  paused: false,
  speedIndex: 0,
  loop: false,
  ticks: 0,
  simTimeS: 0,
};

let currentScenario: ClashScenario = structuredClone(scenarioById(lab.scenarioId));
let sim: ClashStageSim | null = null;
let driver = new ScriptedMashDriver(mashSourceFor(currentScenario.first.mash), mashSourceFor(currentScenario.second.mash));
const keyboard = new KeyboardMashCapture();
keyboard.attach();
const mashLog: MashLogEntry[] = [];

const view = new ClashStageView($<HTMLCanvasElement>('lab-canvas'), $<HTMLElement>('stage'));
const cameraParams: Record<PresetId, CameraParams> = { A: cloneParams(PRESETS.A), B: cloneParams(PRESETS.B), C: cloneParams(PRESETS.C) };
const directors: Record<PresetId, CameraDirector> = { A: new CameraDirector(cameraParams.A), B: new CameraDirector(cameraParams.B), C: new CameraDirector(cameraParams.C) };
const lastOut: Partial<Record<PresetId, DirectorOutput>> = {};

const newPose = () => ({ eye: { x: 0, y: 8, z: 12 } as Vec3, focus: { x: 0, y: 0, z: 0 } as Vec3, fov: 60, shake: { x: 0, y: 0, z: 0 } as Vec3 });
const prevPose = newPose();
const curPose = newPose();
const drawPose = newPose();

// ---------------- Presentation host (hitstop/slow-mo/banner/flash) ----------------
let hitstopRemainingS = 0;
let slowMoRemainingS = 0;
let slowMoFactor = 1;
let arenaIntensity = 0;
let flashRemainingS = 0;
let flashColorHex = '#ffffff';
let bannerHideAtS = -1;

const flashEl = $<HTMLElement>('flash');
const bannerEl = $<HTMLElement>('banner');
const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

const host: PresentationHost = {
  requestHitstop(s) {
    hitstopRemainingS = Math.max(hitstopRemainingS, s);
  },
  requestSlowMo(factor, s) {
    slowMoFactor = factor;
    slowMoRemainingS = Math.max(slowMoRemainingS, s);
  },
  setArenaClashIntensity(v) {
    arenaIntensity = v;
  },
  showBanner(text: string, color: number, style: BannerStyle) {
    bannerEl.textContent = text;
    bannerEl.style.color = hex(color);
    bannerEl.className = `banner show ${style === 'quiet' ? 'quiet' : style === 'dramatic' ? 'dramatic' : 'bold'}`;
    bannerHideAtS = lab.simTimeS + BANNER_HOLD_EXTRA_S;
  },
  hideBanner() {
    bannerEl.classList.remove('show');
    bannerHideAtS = -1;
  },
  flashScreen(strength, color = 0xffffff) {
    flashRemainingS = FLASH_DURATION_S * Math.max(0.1, strength);
    flashColorHex = hex(color);
  },
};

const presenter = new ClashPresenter(DIRECTIONS[lab.directionId], lab.tieStyleId, view.fx, host);

// ---------------- Scenario lifecycle ----------------
async function loadScenario(id: string): Promise<void> {
  lab.scenarioId = id;
  currentScenario = structuredClone(scenarioById(id));
  sim?.dispose();
  sim = await ClashStageSim.create(currentScenario);
  view.setArena(currentScenario.arena);
  view.setBeyVisuals(sim.visuals);
  for (const pid of PRESET_IDS) directors[pid].reset();
  presenter.reset();
  driver = new ScriptedMashDriver(mashSourceFor(currentScenario.first.mash), mashSourceFor(currentScenario.second.mash));
  mashLog.length = 0;
  lab.ticks = 0;
  lab.simTimeS = 0;
  accumulator = 0;
  sim.beginApproach();
  tick();
  copyPose(prevPose, curPose);
  syncSideRatePanel();
  syncPanel();
}

function restart(): void {
  if (!sim) return;
  sim.restart();
  presenter.reset();
  driver = new ScriptedMashDriver(mashSourceFor(currentScenario.first.mash), mashSourceFor(currentScenario.second.mash));
  mashLog.length = 0;
  lab.ticks = 0;
  lab.simTimeS = 0;
  accumulator = 0;
  tick();
  copyPose(prevPose, curPose);
}

function onScenarioEnd(): void {
  if (lab.loop) restart();
  else {
    lab.paused = true;
    syncPanel();
  }
}

function copyPose(dst: ReturnType<typeof newPose>, src: ReturnType<typeof newPose>): void {
  dst.eye.x = src.eye.x; dst.eye.y = src.eye.y; dst.eye.z = src.eye.z;
  dst.focus.x = src.focus.x; dst.focus.y = src.focus.y; dst.focus.z = src.focus.z;
  dst.fov = src.fov;
  dst.shake.x = src.shake.x; dst.shake.y = src.shake.y; dst.shake.z = src.shake.z;
}

// ---------------- Fixed tick ----------------
function logMash(isFirst: boolean, keys: readonly string[], countedAsEvent: boolean, runningCount: number): void {
  if (!isFirst) return; // the debug log focuses on the player side, where real Z/X/C keys are observable.
  mashLog.push({ tick: lab.ticks, keys, countedAsEvent, runningCount });
  if (mashLog.length > 60) mashLog.shift();
}

function tick(): void {
  if (!sim) return;
  let firstMashed = false;
  let secondMashed = false;
  if (sim.harness.phase === 'Active') {
    const scripted = driver.sample(sim.harness.elapsedActiveS);
    if (lab.firstMashMode === 'keyboard') {
      const keys = [...keyboard.sampleTick()];
      firstMashed = keys.length > 0;
      if (keys.length > 0) logMash(true, keys, true, sim.harness.liveScore(true).mashEventCount + 1);
    } else {
      firstMashed = scripted.first;
      if (scripted.first) logMash(true, ['roteiro'], true, sim.harness.liveScore(true).mashEventCount + 1);
    }
    secondMashed = scripted.second;
  }
  const result = sim.tick(DT, firstMashed, secondMashed);
  presenter.handleTick(DT, sim, result);
  view.fx.tick(DT);
  lab.simTimeS += DT;
  view.updateArena(lab.simTimeS, DT, arenaIntensity);
  const aspect = view.aspect;
  for (const pid of PRESET_IDS) {
    directors[pid].setAspect(aspect);
    lastOut[pid] = directors[pid].tick(result.fightFrame, DT);
  }
  copyPose(prevPose, curPose);
  const out = lastOut[lab.cameraPresetId]!;
  copyPose(curPose, { eye: out.eye, focus: out.focus, fov: out.fov, shake: out.shake });
  lab.ticks++;
  updateSidePanel(result.fightFrame);
  renderMashLog();
  if (bannerHideAtS >= 0 && lab.simTimeS >= bannerHideAtS && sim.harness.beat !== 'resolutionBurst') host.hideBanner();
}

// ---------------- Render ----------------
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
function render(alpha: number): void {
  const eye: Vec3 = { x: lerp(prevPose.eye.x, curPose.eye.x, alpha), y: lerp(prevPose.eye.y, curPose.eye.y, alpha), z: lerp(prevPose.eye.z, curPose.eye.z, alpha) };
  const focus: Vec3 = { x: lerp(prevPose.focus.x, curPose.focus.x, alpha), y: lerp(prevPose.focus.y, curPose.focus.y, alpha), z: lerp(prevPose.focus.z, curPose.focus.z, alpha) };
  const fov = lerp(prevPose.fov, curPose.fov, alpha);
  view.applyCamera(eye, focus, fov, curPose.shake);
  view.render();

  if (flashRemainingS > 0) {
    flashEl.style.background = flashColorHex;
    flashEl.style.opacity = String(Math.min(1, flashRemainingS / FLASH_DURATION_S));
  } else {
    flashEl.style.opacity = '0';
  }
}

let last = performance.now();
let accumulator = 0;
function frameLoop(): void {
  const now = performance.now();
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (hitstopRemainingS > 0) {
    hitstopRemainingS = Math.max(0, hitstopRemainingS - realDt);
  } else if (sim && !lab.paused) {
    const speed = SPEEDS[lab.speedIndex]!;
    const effectiveFactor = slowMoRemainingS > 0 ? slowMoFactor : 1;
    if (slowMoRemainingS > 0) slowMoRemainingS = Math.max(0, slowMoRemainingS - realDt);
    accumulator += realDt * speed * effectiveFactor;
    let n = 0;
    while (accumulator >= DT && n < MAX_TICKS_PER_FRAME) {
      tick();
      accumulator -= DT;
      n++;
      if (sim.harness.beat === 'cooldownWait' && sim.harness.phase === 'Idle') {
        accumulator = 0;
        onScenarioEnd();
        break;
      }
    }
    if (n === MAX_TICKS_PER_FRAME) accumulator = 0;
  }
  if (flashRemainingS > 0) flashRemainingS = Math.max(0, flashRemainingS - realDt);
  render(lab.paused || hitstopRemainingS > 0 ? 1 : Math.min(1, accumulator / DT));
}

// ---------------- Side panel: live score ----------------
const scoreEl = $<HTMLElement>('score');
function sideScoreMarkup(label: string, cls: string): string {
  return `<div class="side-score ${cls}"><h4>${label}</h4>
    <div class="bar-row"><span>Mash</span><div class="bar-track"><div class="bar-fill" data-k="mash"></div></div><output data-o="mash"></output></div>
    <div class="bar-row"><span>Stamina</span><div class="bar-track"><div class="bar-fill" data-k="stamina"></div></div><output data-o="stamina"></output></div>
    <div class="bar-row"><span>Velocity</span><div class="bar-track"><div class="bar-fill" data-k="velocity"></div></div><output data-o="velocity"></output></div>
    <div class="power-row"><span>ClashPower</span><output data-o="power">0.00</output></div>
  </div>`;
}
scoreEl.innerHTML = sideScoreMarkup('Jogador', 'first') + sideScoreMarkup('Oponente', 'second');
const scoreNodes = scoreEl.querySelectorAll('.side-score');

function updateSidePanel(frame: FightFrame): void {
  if (!sim) return;
  for (const [i, isFirst] of [0, 1].map((i) => [i, i === 0] as const)) {
    const node = scoreNodes[i]!;
    const score = sim.harness.liveScore(isFirst);
    const set = (key: 'mash' | 'stamina' | 'velocity', v: number): void => {
      (node.querySelector(`[data-k="${key}"]`) as HTMLElement).style.width = `${Math.round(v * 100)}%`;
      (node.querySelector(`[data-o="${key}"]`) as HTMLElement).textContent = v.toFixed(2);
    };
    set('mash', score.mashPerformance);
    set('stamina', score.staminaFactor);
    set('velocity', score.velocityFactor);
    (node.querySelector('[data-o="power"]') as HTMLElement).textContent = score.clashPower.toFixed(3);
  }

  const info = sim.harness.approachInfo;
  const h = sim.harness;
  const lines = [
    `fase: <b>${h.phase}</b> (${h.beat})`,
    h.phase === 'Active' ? `progresso: ${(h.activeProgress01 * 100).toFixed(0)}% (${h.elapsedActiveS.toFixed(2)}s)` : '',
    h.phase === 'Cooldown' ? `cooldown restante: ${h.cooldownRemainingS.toFixed(1)}s` : '',
    info ? `janela de 150ms: Δ=${(info.connectDeltaS * 1000).toFixed(0)}ms — ${info.withinWindow ? 'dentro' : 'fora'}` : '',
    `arena: ${currentScenario.arena} · intensidade de luz de Clash: ${(arenaIntensity * 100).toFixed(0)}%`,
    frame.ringOutIsFirst !== null ? `ring-out natural: ${frame.ringOutIsFirst ? 'jogador' : 'oponente'}` : '',
  ].filter(Boolean);
  $<HTMLElement>('phase-hud').innerHTML = lines.join('<br/>');

  const totalS = 0.45 + 4 + 2.5;
  const elapsed = h.phase === 'Approach' ? h.approachProgress01 * 0.45 : h.phase === 'Active' ? 0.45 + h.elapsedActiveS : h.phase === 'Cooldown' ? 0.45 + 4 + (1 - h.resolutionBurstProgress01) * 0 + (h.beat === 'resolutionBurst' ? h.resolutionBurstProgress01 * 2.5 : 2.5) : 0;
  $<HTMLElement>('timeline-fill').style.width = `${Math.min(100, (elapsed / totalS) * 100)}%`;
  $<HTMLElement>('timeline-label').textContent = `${currentScenario.label} · ${h.phase}${lab.paused ? ' · pausado' : ''} · ${SPEEDS[lab.speedIndex]}×`;
}

function renderMashLog(): void {
  const el = $<HTMLElement>('mash-log');
  el.textContent = mashLog
    .slice(-24)
    .map((e) => `#${e.tick.toString().padStart(5, '0')}  [${e.keys.join('+')}] -> ${e.countedAsEvent ? `evento #${e.runningCount}` : 'sem evento'}`)
    .join('\n');
  el.scrollTop = el.scrollHeight;
}

// ---------------- Panels: direction / tie / camera / scenario ----------------
const directionsEl = $<HTMLElement>('directions');
const directionButtons = new Map<DirectionId, HTMLButtonElement>();
for (const id of DIRECTION_IDS) {
  const d = DIRECTIONS[id];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'option';
  b.dataset.id = id;
  b.innerHTML = `<strong>${id}</strong><span>${d.name}<small>${d.tagline}</small></span>`;
  b.title = d.blurb;
  b.addEventListener('click', () => setDirection(id));
  directionsEl.append(b);
  directionButtons.set(id, b);
}

const tieStylesEl = $<HTMLElement>('tie-styles');
const tieButtons = new Map<TieStyleId, HTMLButtonElement>();
for (const id of TIE_STYLE_IDS) {
  const t = TIE_STYLES[id];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tie-style';
  b.innerHTML = `${t.label}<small>${t.blurb}</small>`;
  b.addEventListener('click', () => {
    lab.tieStyleId = id;
    presenter.setTieStyle(id);
    syncPanel();
  });
  tieStylesEl.append(b);
  tieButtons.set(id, b);
}

const cameraPresetsEl = $<HTMLElement>('camera-presets');
const cameraButtons = new Map<PresetId, HTMLButtonElement>();
const CAMERA_NAMES: Record<PresetId, string> = { A: 'A Arena Fighter', B: 'B Cinematic Hybrid', C: 'C Hyper Dynamic' };
for (const pid of PRESET_IDS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = CAMERA_NAMES[pid];
  b.addEventListener('click', () => {
    lab.cameraPresetId = pid;
    syncPanel();
  });
  cameraPresetsEl.append(b);
  cameraButtons.set(pid, b);
}

const scenariosEl = $<HTMLElement>('scenarios');
const scenarioButtons = new Map<string, HTMLButtonElement>();
for (const s of SCENARIOS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'scenario';
  b.dataset.id = s.id;
  b.innerHTML = `${s.label}<small>${s.description}</small>`;
  b.addEventListener('click', () => void loadScenario(s.id));
  scenariosEl.append(b);
  scenarioButtons.set(s.id, b);
}

function setDirection(id: DirectionId): void {
  lab.directionId = id;
  lab.tieStyleId = DIRECTIONS[id].defaultTieStyle;
  presenter.setDirection(DIRECTIONS[id]);
  presenter.setTieStyle(lab.tieStyleId);
  syncPanel();
}

// ---------------- Sliders: Stamina / speed / mash rate ----------------
const slidersEl = $<HTMLElement>('sliders');
function sliderRow(id: string, label: string): string {
  return `<div class="slider-row"><label>${label}</label><input type="range" id="${id}" /><output id="${id}-out"></output></div>`;
}
slidersEl.innerHTML = [
  sliderRow('first-stamina', 'Stamina — Jogador (0–1)'),
  sliderRow('first-speed', 'Velocidade — Jogador (m/s)'),
  sliderRow('first-mash', 'Mash — Jogador (eventos/s)'),
  sliderRow('second-stamina', 'Stamina — Oponente (0–1)'),
  sliderRow('second-speed', 'Velocidade — Oponente (m/s)'),
  sliderRow('second-mash', 'Mash — Oponente (eventos/s)'),
].join('');

interface SliderSpec { id: string; min: number; max: number; step: number; get: () => number; set: (v: number) => void }
function bindSlider(spec: SliderSpec): void {
  const input = $<HTMLInputElement>(spec.id);
  const out = $<HTMLElement>(`${spec.id}-out`);
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(spec.get());
  out.textContent = spec.get().toFixed(2);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    spec.set(v);
    out.textContent = v.toFixed(2);
  });
}

function rateOf(profile: ClashScenario['first']['mash']): number {
  return profile.kind === 'rate' ? profile.eventsPerSecond : profile.afterEventsPerSecond;
}

function syncSideRatePanel(): void {
  bindSlider({ id: 'first-stamina', min: 0, max: 1, step: 0.01, get: () => currentScenario.first.staminaFraction, set: (v) => (currentScenario.first.staminaFraction = v) });
  bindSlider({ id: 'first-speed', min: 0, max: 16, step: 0.1, get: () => currentScenario.first.speedMps, set: (v) => (currentScenario.first.speedMps = v) });
  bindSlider({
    id: 'first-mash',
    min: 0,
    max: 12,
    step: 0.1,
    get: () => rateOf(currentScenario.first.mash),
    set: (v) => {
      currentScenario.first.mash = { kind: 'rate', eventsPerSecond: v };
      driver = new ScriptedMashDriver(mashSourceFor(currentScenario.first.mash), mashSourceFor(currentScenario.second.mash));
    },
  });
  bindSlider({ id: 'second-stamina', min: 0, max: 1, step: 0.01, get: () => currentScenario.second.staminaFraction, set: (v) => (currentScenario.second.staminaFraction = v) });
  bindSlider({ id: 'second-speed', min: 0, max: 16, step: 0.1, get: () => currentScenario.second.speedMps, set: (v) => (currentScenario.second.speedMps = v) });
  bindSlider({
    id: 'second-mash',
    min: 0,
    max: 12,
    step: 0.1,
    get: () => rateOf(currentScenario.second.mash),
    set: (v) => {
      currentScenario.second.mash = { kind: 'rate', eventsPerSecond: v };
      driver = new ScriptedMashDriver(mashSourceFor(currentScenario.first.mash), mashSourceFor(currentScenario.second.mash));
    },
  });
}

// ---------------- Transport ----------------
$<HTMLButtonElement>('pause').addEventListener('click', () => { lab.paused = !lab.paused; syncPanel(); });
$<HTMLButtonElement>('restart').addEventListener('click', restart);
$<HTMLButtonElement>('speed').addEventListener('click', () => { lab.speedIndex = (lab.speedIndex + 1) % SPEEDS.length; syncPanel(); });
$<HTMLButtonElement>('loop').addEventListener('click', () => { lab.loop = !lab.loop; syncPanel(); });
$<HTMLButtonElement>('mash-mode-first').addEventListener('click', () => {
  lab.firstMashMode = lab.firstMashMode === 'scripted' ? 'keyboard' : 'scripted';
  syncPanel();
});

function syncPanel(): void {
  for (const [id, b] of directionButtons) b.setAttribute('aria-pressed', String(id === lab.directionId));
  for (const [id, b] of tieButtons) b.setAttribute('aria-pressed', String(id === lab.tieStyleId));
  for (const [id, b] of cameraButtons) b.setAttribute('aria-pressed', String(id === lab.cameraPresetId));
  for (const [id, b] of scenarioButtons) b.setAttribute('aria-pressed', String(id === lab.scenarioId));
  $<HTMLElement>('pause').setAttribute('aria-pressed', String(lab.paused));
  $<HTMLElement>('loop').setAttribute('aria-pressed', String(lab.loop));
  $<HTMLElement>('speed').firstChild!.textContent = `${SPEEDS[lab.speedIndex]}× `;
  $<HTMLElement>('mash-mode-first').firstChild!.textContent = `Jogador: ${lab.firstMashMode === 'scripted' ? 'roteiro' : 'teclado (Z/X/C)'} `;
}

// ---------------- Keyboard ----------------
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range'))) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const idx = SCENARIOS.findIndex((s) => s.id === lab.scenarioId);
  if (k === '1' || k === '2' || k === '3') setDirection(DIRECTION_IDS[Number(k) - 1]!);
  else if (k === ' ') { lab.paused = !lab.paused; syncPanel(); e.preventDefault(); }
  else if (k === 'r') restart();
  else if (k === 's') { lab.speedIndex = (lab.speedIndex + 1) % SPEEDS.length; syncPanel(); }
  else if (k === 'l') { lab.loop = !lab.loop; syncPanel(); }
  else if (k === 'm') { lab.firstMashMode = lab.firstMashMode === 'scripted' ? 'keyboard' : 'scripted'; syncPanel(); }
  else if (k === '[') void loadScenario(SCENARIOS[(idx - 1 + SCENARIOS.length) % SCENARIOS.length]!.id);
  else if (k === ']') void loadScenario(SCENARIOS[(idx + 1) % SCENARIOS.length]!.id);
  else return;
  if (t?.tagName === 'INPUT') t.blur();
});

// ---------------- Boot ----------------
function startScenarioFromHash(): string {
  const h = location.hash.replace('#', '').toLowerCase();
  return SCENARIOS.some((s) => s.id === h) ? h : lab.scenarioId;
}
syncPanel();
void loadScenario(startScenarioFromHash()).then(() => view.renderer.setAnimationLoop(frameLoop));

// ---------------- Automation hook (smoke test) ----------------
declare global {
  interface Window {
    __clashLab: {
      state(): { scenario: string; direction: DirectionId; tieStyle: TieStyleId; cameraPreset: PresetId; phase: string; beat: string; paused: boolean; ticks: number };
      scenarios: string[];
      directions: DirectionId[];
      loadScenario(id: string): Promise<void>;
      setDirection(id: DirectionId): void;
      setPaused(on: boolean): void;
      advance(seconds: number): void;
    };
  }
}
window.__clashLab = {
  state: () => ({
    scenario: lab.scenarioId,
    direction: lab.directionId,
    tieStyle: lab.tieStyleId,
    cameraPreset: lab.cameraPresetId,
    phase: sim?.harness.phase ?? 'Idle',
    beat: sim?.harness.beat ?? 'idle',
    paused: lab.paused,
    ticks: lab.ticks,
  }),
  scenarios: SCENARIOS.map((s) => s.id),
  directions: [...DIRECTION_IDS],
  loadScenario,
  setDirection,
  setPaused: (on) => { lab.paused = on; syncPanel(); },
  advance: (seconds) => {
    const n = Math.max(1, Math.round(seconds / DT));
    for (let i = 0; i < n; i++) tick();
    render(1);
  },
};
