// ============================================================
// CAMERA LAB — PAGE WIRING
// Isolated camera prototype (GDD 1.6 / 48–50). It READS the game's
// simulation modules to run real fights, but never changes them, and the
// game's own camera (src/camera/) is untouched. Owns the fight source, the
// three directors (A, B, C always run together on the same fight, so
// switching is instant), the fixed 60 Hz loop with render interpolation,
// and the panels. Automation hook for the smoke test: window.__cameraLab.
// ============================================================

import * as THREE from 'three';
import { CameraDirector, type CameraMode, type DirectorOutput } from './director/CameraDirector';
import { PRESETS, PRESET_IDS, cloneParams, type CameraParams, type PresetId } from './director/CameraParams';
import { ReadabilityMeter, type ReadabilitySummary } from './director/ReadabilityMeter';
import { angleDelta } from './director/frameMath';
import type { FightFrame, Vec3 } from './fight/FightFrame';
import { RealSimSource } from './fight/RealSimSource';
import { SCENARIOS, scenarioById, type Scenario } from './fight/scenarios';
import { LabStage, type CameraPose } from './stage/LabStage';
import { Minimap } from './stage/Minimap';
import { ParamPanel } from './ui/ParamPanel';

// ---------------- PAGE TUNING ----------------
const DT = 1 / 60;                       // The game's fixed tick.
const MAX_TICKS_PER_FRAME = 8;
const SPEEDS = [1, 0.5, 0.25, 2];
const DEBUG_EVERY_FRAMES = 6;
const PRESET_INFO: Readonly<Record<PresetId, { name: string; blurb: string }>> = {
  A: { name: 'Arena Fighter', blurb: 'Leitura primeiro: enquadramento constante dos dois, órbita contida, amortecimento alto, FOV moderado, nunca troca de lado.' },
  B: { name: 'Cinematic Hybrid', blurb: 'Meio-termo premium: órbita contextual, look-ahead, FOV claro com a velocidade, reenquadra no Dash e no knockback, troca de lado rara.' },
  C: { name: 'Hyper Dynamic', blurb: 'O limite dramático do GDD: órbita forte, distância e FOV agressivos, recuo em velocidade, impactos recompõem a cena, troca de lado com a ação.' },
};
const MODE_PT: Readonly<Record<CameraMode, string>> = {
  CombatFollow: 'COMBAT FOLLOW',
  HighSpeed: 'HIGH SPEED',
  CloseCombat: 'CLOSE COMBAT',
  KnockbackFollow: 'KNOCKBACK FOLLOW',
  Clash: 'CLASH',
  RingOut: 'RING-OUT',
  Finisher: 'FINISHER',
};
// ------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const lab = {
  scenario: SCENARIOS[0]!.id,
  preset: 'B' as PresetId,
  compare: false,
  paused: false,
  speedIndex: 0,
  loop: true,
  sequence: false,
  markers: true,
  minimap: true,
  hud: true,
  frames: 0,
  ticks: 0,
  loading: false,
};

const live: Record<PresetId, CameraParams> = { A: cloneParams(PRESETS.A), B: cloneParams(PRESETS.B), C: cloneParams(PRESETS.C) };
const directors: Record<PresetId, CameraDirector> = { A: new CameraDirector(live.A), B: new CameraDirector(live.B), C: new CameraDirector(live.C) };
let meters: Record<PresetId, ReadabilityMeter> = { A: new ReadabilityMeter(), B: new ReadabilityMeter(), C: new ReadabilityMeter() };

const stage = new LabStage($<HTMLCanvasElement>('lab-canvas'), $<HTMLElement>('stage'));
const minimap = new Minimap($<HTMLCanvasElement>('minimap'));
let source: RealSimSource | null = null;
let accumulator = 0;

// Interpolation state: previous and current tick, per preset and per Bey visual.
const newPose = (): CameraPose => ({ eye: { x: 0, y: 8, z: 12 }, focus: { x: 0, y: 0, z: 0 }, fov: 60, shake: { x: 0, y: 0, z: 0 } });
const prevPose: Record<PresetId, CameraPose> = { A: newPose(), B: newPose(), C: newPose() };
const curPose: Record<PresetId, CameraPose> = { A: newPose(), B: newPose(), C: newPose() };
const drawPose: Record<PresetId, CameraPose> = { A: newPose(), B: newPose(), C: newPose() };
const lastOut: Partial<Record<PresetId, DirectorOutput>> = {};
interface VisualState { px: number; py: number; pz: number; q: [number, number, number, number]; spin: number }
const blankVisual = (): VisualState => ({ px: 0, py: 0, pz: 0, q: [0, 0, 0, 1], spin: 0 });
const prevVis = [blankVisual(), blankVisual()];
const curVis = [blankVisual(), blankVisual()];

function copyPose(o: CameraPose, eye: Vec3, focus: Vec3, fov: number, shake: Vec3): void {
  o.eye.x = eye.x; o.eye.y = eye.y; o.eye.z = eye.z;
  o.focus.x = focus.x; o.focus.y = focus.y; o.focus.z = focus.z;
  o.fov = fov;
  o.shake.x = shake.x; o.shake.y = shake.y; o.shake.z = shake.z;
}

function captureVisuals(): void {
  if (!source) return;
  [source.firstVisual, source.secondVisual].forEach((v, i) => {
    const p = prevVis[i]!;
    const c = curVis[i]!;
    Object.assign(p, { px: c.px, py: c.py, pz: c.pz, spin: c.spin });
    p.q = [...c.q] as VisualState['q'];
    c.px = v.group.position.x; c.py = v.group.position.y; c.pz = v.group.position.z;
    c.q = [v.group.quaternion.x, v.group.quaternion.y, v.group.quaternion.z, v.group.quaternion.w];
    c.spin = v.spinGroup.rotation.y;
  });
}

// ---------------- Scenario lifecycle ----------------
async function loadScenario(id: string): Promise<void> {
  lab.loading = true;
  lab.scenario = id;
  const scenario = scenarioById(id);
  const next = await RealSimSource.create(scenario);
  source?.dispose();
  source = next;
  stage.setSource(next.visuals);
  for (const pid of PRESET_IDS) directors[pid].reset();
  meters = { A: new ReadabilityMeter(stage.aspectFor()), B: new ReadabilityMeter(stage.aspectFor()), C: new ReadabilityMeter(stage.aspectFor()) };
  accumulator = 0;
  clearTimeline();
  captureVisuals();
  captureVisuals();
  tick(); // one tick so every camera has a pose before the first draw
  for (const pid of PRESET_IDS) copyPose(prevPose[pid], curPose[pid].eye, curPose[pid].focus, curPose[pid].fov, curPose[pid].shake);
  lab.loading = false;
  syncPanel();
}

function restart(): void {
  void loadScenario(lab.scenario);
}

function onScenarioEnd(): void {
  if (lab.sequence) {
    const i = PRESET_IDS.indexOf(lab.preset);
    if (i < PRESET_IDS.length - 1) {
      setPreset(PRESET_IDS[i + 1]!);
      restart();
    } else {
      lab.sequence = false;
      lab.paused = true;
      syncPanel();
    }
    return;
  }
  if (lab.loop) restart();
  else {
    lab.paused = true;
    syncPanel();
  }
}

// ---------------- Fixed tick ----------------
function tick(): void {
  if (!source) return;
  const frame = source.step();
  source.syncVisuals();
  captureVisuals();
  const aspect = stage.aspectFor();
  for (const pid of PRESET_IDS) {
    const d = directors[pid];
    d.setAspect(aspect);
    const out = d.tick(frame, DT);
    lastOut[pid] = out;
    copyPose(prevPose[pid], curPose[pid].eye, curPose[pid].focus, curPose[pid].fov, curPose[pid].shake);
    copyPose(curPose[pid], out.eye, out.focus, out.fov, out.shake);
    meters[pid].add(frame, out, DT);
  }
  markTimeline(frame);
  lab.ticks++;
}

// ---------------- Render ----------------
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const scratchQ = new THREE.Quaternion();
function render(alpha: number): void {
  if (!source) return;
  [source.firstVisual, source.secondVisual].forEach((v, i) => {
    const p = prevVis[i]!;
    const c = curVis[i]!;
    v.group.position.set(lerp(p.px, c.px, alpha), lerp(p.py, c.py, alpha), lerp(p.pz, c.pz, alpha));
    v.group.quaternion.set(...p.q).slerp(scratchQ.set(...c.q), alpha);
    v.spinGroup.rotation.y = p.spin + angleDelta(p.spin, c.spin) * alpha;
  });
  for (const pid of PRESET_IDS) {
    const a = prevPose[pid];
    const b = curPose[pid];
    const o = drawPose[pid];
    o.eye.x = lerp(a.eye.x, b.eye.x, alpha); o.eye.y = lerp(a.eye.y, b.eye.y, alpha); o.eye.z = lerp(a.eye.z, b.eye.z, alpha);
    o.focus.x = lerp(a.focus.x, b.focus.x, alpha); o.focus.y = lerp(a.focus.y, b.focus.y, alpha); o.focus.z = lerp(a.focus.z, b.focus.z, alpha);
    o.fov = lerp(a.fov, b.fov, alpha);
    o.shake.x = b.shake.x; o.shake.y = b.shake.y; o.shake.z = b.shake.z;
  }
  const shown = lab.compare ? PRESET_IDS : [lab.preset];
  stage.showMarkers = lab.markers;
  const frame = source.frame;
  for (const pid of shown) {
    const out = lastOut[pid];
    if (out) stage.updateMarkers(pid, out, frame.first, frame.second);
  }
  stage.render(drawPose, shown);
  const minimapEl = $<HTMLCanvasElement>('minimap');
  minimapEl.hidden = !lab.minimap;
  if (lab.minimap && lastOut.A && lastOut.B && lastOut.C) minimap.draw(frame, drawPose, lastOut as Record<PresetId, DirectorOutput>, shown, stage.aspectFor());
  updateHud(frame);
  if (lab.frames % DEBUG_EVERY_FRAMES === 0) updateDebug(frame);
}

let last = performance.now();
function frameLoop(): void {
  const now = performance.now();
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (source && !lab.paused && !lab.loading) {
    accumulator += realDt * SPEEDS[lab.speedIndex]!;
    let n = 0;
    while (accumulator >= DT && n < MAX_TICKS_PER_FRAME) {
      tick();
      accumulator -= DT;
      n++;
      if (source.finished) {
        accumulator = 0;
        onScenarioEnd();
        break;
      }
    }
    if (n === MAX_TICKS_PER_FRAME) accumulator = 0;
  }
  render(lab.paused ? 1 : Math.min(1, accumulator / DT));
  lab.frames++;
}

// ---------------- HUD ----------------
const overlay = $<HTMLElement>('overlay');
const huds = new Map<PresetId, HTMLElement>();
let banner: HTMLElement | null = null;
for (const pid of PRESET_IDS) {
  const el = document.createElement('div');
  el.className = 'vp-hud';
  el.dataset.id = pid;
  el.innerHTML = `<div class="top"><strong>${pid}</strong><span class="name"></span><span class="mode"></span></div><div class="nums"></div><div class="mods"></div><div class="read"></div>`;
  el.querySelector('.name')!.textContent = PRESET_INFO[pid].name;
  overlay.append(el);
  huds.set(pid, el);
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
function readLine(s: ReadabilitySummary): string {
  return `no quadro: oponente ${pct(s.opponentInFrame)} · jogador ${pct(s.playerInFrame)} · giro máx ${s.maxYawRateDegS.toFixed(0)}°/s · trocas de lado ${s.sideSwitches}`;
}

function updateHud(frame: FightFrame): void {
  const vps = stage.currentViewports;
  for (const pid of PRESET_IDS) {
    const el = huds.get(pid)!;
    const vp = vps.find((v) => v.id === pid);
    el.hidden = !vp;
    if (!vp) continue;
    el.style.left = `${vp.x + 12}px`;
    el.style.top = `${vp.y + 12}px`;
    el.style.maxWidth = `${Math.max(160, vp.w - 24)}px`;
    const out = lastOut[pid];
    if (!out) continue;
    const mode = el.querySelector<HTMLElement>('.mode')!;
    mode.textContent = MODE_PT[out.mode];
    mode.dataset.mode = out.mode;
    const detail = lab.hud;
    (el.querySelector('.nums') as HTMLElement).hidden = !detail;
    (el.querySelector('.mods') as HTMLElement).hidden = !detail;
    (el.querySelector('.read') as HTMLElement).hidden = !detail;
    if (!detail) continue;
    el.querySelector('.nums')!.textContent = `FOV ${out.fov.toFixed(0)}° · dist ${out.debug.distance.toFixed(1)} m → ${out.debug.distanceTarget.toFixed(1)} · vel ${out.debug.speedFiltered.toFixed(1)} m/s`;
    el.querySelector('.mods')!.textContent = out.debug.modifiers.length ? out.debug.modifiers.join(' · ') : '—';
    el.querySelector('.read')!.textContent = readLine(meters[pid].summary);
  }
  const wantBanner = lab.sequence ? `Sequência: ${lab.preset} (${PRESET_IDS.indexOf(lab.preset) + 1}/3) — mesmo cenário, câmera ${lab.preset}` : frame.roundOver ? 'Round encerrado — continuação de apresentação (só no lab): a física segue 2,5 s para a câmera ter trajetória' : '';
  if (wantBanner && !banner) {
    banner = document.createElement('div');
    banner.className = 'banner';
    overlay.append(banner);
  }
  if (banner) {
    banner.hidden = !wantBanner;
    banner.textContent = wantBanner;
    banner.classList.toggle('temp', !lab.sequence);
  }
  const s = scenarioById(lab.scenario);
  $<HTMLElement>('timeline-fill').style.width = `${Math.min(100, (frame.time / s.durationS) * 100)}%`;
  $<HTMLElement>('timeline-label').textContent = `${s.label} · ${frame.time.toFixed(1)} / ${s.durationS.toFixed(1)} s · ${SPEEDS[lab.speedIndex]}×${lab.paused ? ' · pausado' : ''}`;
}

// ---------------- Debug text ----------------
const f3 = (v: Vec3): string => `(${v.x.toFixed(1)}, ${v.y.toFixed(1)}, ${v.z.toFixed(1)})`;
function updateDebug(frame: FightFrame): void {
  const out = lastOut[lab.preset];
  if (!out) return;
  const d = out.debug;
  const P = live[lab.preset];
  const w = out.weights;
  const bar = (v: number): string => '█'.repeat(Math.round(v * 10)).padEnd(10, '·');
  $<HTMLElement>('debug').textContent = [
    `câmera ${lab.preset} — modo ${out.mode}`,
    `FOV ${out.fov.toFixed(1)}°   dist ${d.distance.toFixed(2)} m   alvo ${d.distanceTarget.toFixed(2)} m`,
    `órbita ${d.yawDeg.toFixed(0)}°   lead ${d.orbitLeadDeg.toFixed(1)}°   lado ${d.side > 0 ? 'direito' : 'esquerdo'}`,
    `alvo da câmera ${f3(out.focus)}`,
    `olho ${f3(out.eye)}`,
    `jogador ${f3(frame.first.position)}  ${frame.first.speed.toFixed(1)} m/s ${frame.first.attack}`,
    `oponente ${f3(frame.second.position)}  ${frame.second.speed.toFixed(1)} m/s ${frame.second.attack}`,
    `meio ${f3(d.midpoint)}`,
    `look-ahead ${f3(d.lookAheadPoint)}  vetor (${d.lookAheadVec.x.toFixed(1)}, ${d.lookAheadVec.z.toFixed(1)})`,
    `encontro ${d.encounterPoint ? f3(d.encounterPoint) : '—'}`,
    `amortecimento pos ${P.positionDamping}/s · alvo ${P.rotationDamping}/s · órbita ${P.orbitDamping}/s · FOV ${P.fovDamping}/s`,
    `shake ${d.shake.toFixed(3)} m   resgate ${(d.rescue * 100).toFixed(0)}%   vel filtrada ${d.speedFiltered.toFixed(1)}`,
    `fora do quadro: jogador ${d.offscreenFirstS.toFixed(2)} s · oponente ${d.offscreenSecondS.toFixed(2)} s`,
    `contextos:`,
    ...(['HighSpeed', 'CloseCombat', 'KnockbackFollow', 'Clash', 'RingOut', 'Finisher'] as const).map((m) => `  ${m.padEnd(16)} ${bar(w[m])} ${(w[m] * 100).toFixed(0)}%`),
    `modificadores: ${d.modifiers.join(', ') || '—'}`,
  ].join('\n');
}

// ---------------- Timeline ----------------
const timeline = $<HTMLElement>('timeline');
const marks: HTMLElement[] = [];
function clearTimeline(): void {
  marks.splice(0).forEach((m) => m.remove());
}
function markTimeline(frame: FightFrame): void {
  const s = scenarioById(lab.scenario);
  for (const e of frame.intents) {
    if (e.kind === 'landing' || e.magnitude < 0.1) continue;
    const m = document.createElement('div');
    m.className = `mark ${e.kind === 'clashStart' || e.kind === 'clashResolved' ? 'clash' : e.kind}`;
    m.style.left = `${Math.min(100, (frame.time / s.durationS) * 100)}%`;
    m.title = `${e.kind} ${e.magnitude.toFixed(2)} @ ${frame.time.toFixed(2)} s`;
    timeline.append(m);
    marks.push(m);
  }
}

// ---------------- Panels ----------------
const presetsEl = $<HTMLElement>('presets');
const presetButtons = new Map<PresetId, HTMLButtonElement>();
for (const pid of PRESET_IDS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'preset';
  b.dataset.id = pid;
  b.innerHTML = `<strong>${pid}</strong><span></span><kbd>${PRESET_IDS.indexOf(pid) + 1}</kbd>`;
  const span = b.querySelector('span')!;
  span.textContent = PRESET_INFO[pid].name;
  const small = document.createElement('small');
  small.textContent = PRESET_INFO[pid].blurb;
  span.append(small);
  b.addEventListener('click', () => setPreset(pid));
  presetsEl.append(b);
  presetButtons.set(pid, b);
}

const scenariosEl = $<HTMLElement>('scenarios');
const scenarioButtons = new Map<string, HTMLButtonElement>();
for (const s of SCENARIOS) scenariosEl.append(scenarioButton(s));
function scenarioButton(s: Scenario): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'scenario';
  b.dataset.id = s.id;
  const title = document.createElement('span');
  title.textContent = `${s.label} · ${s.durationS} s`;
  const desc = document.createElement('small');
  desc.textContent = s.description;
  const ctx = document.createElement('span');
  ctx.className = 'ctx';
  ctx.textContent = s.contexts.join(' · ');
  b.append(title, desc, ctx);
  b.addEventListener('click', () => void loadScenario(s.id));
  scenarioButtons.set(s.id, b);
  return b;
}

const panel = new ParamPanel($<HTMLElement>('params'), $<HTMLElement>('tune-status'), live, () => lab.preset);
$<HTMLButtonElement>('save').addEventListener('click', () => void panel.save());
$<HTMLButtonElement>('copy').addEventListener('click', () => void panel.copy());
$<HTMLButtonElement>('reset-preset').addEventListener('click', () => panel.resetPreset());

function setPreset(pid: PresetId): void {
  lab.preset = pid;
  panel.showPreset(pid);
  syncPanel();
}
function setCompare(on: boolean): void {
  lab.compare = on;
  syncPanel();
}
function cycleSpeed(): void {
  lab.speedIndex = (lab.speedIndex + 1) % SPEEDS.length;
  syncPanel();
}
function startSequence(): void {
  lab.sequence = true;
  lab.compare = false;
  lab.paused = false;
  setPreset('A');
  restart();
}

$<HTMLButtonElement>('view-single').addEventListener('click', () => setCompare(false));
$<HTMLButtonElement>('view-compare').addEventListener('click', () => setCompare(true));
$<HTMLButtonElement>('seq').addEventListener('click', startSequence);
$<HTMLButtonElement>('pause').addEventListener('click', () => { lab.paused = !lab.paused; syncPanel(); });
$<HTMLButtonElement>('restart').addEventListener('click', restart);
$<HTMLButtonElement>('speed').addEventListener('click', cycleSpeed);
$<HTMLButtonElement>('loop').addEventListener('click', () => { lab.loop = !lab.loop; syncPanel(); });
$<HTMLButtonElement>('toggle-markers').addEventListener('click', () => { lab.markers = !lab.markers; syncPanel(); });
$<HTMLButtonElement>('toggle-minimap').addEventListener('click', () => { lab.minimap = !lab.minimap; syncPanel(); });
$<HTMLButtonElement>('toggle-hud').addEventListener('click', () => { lab.hud = !lab.hud; syncPanel(); });

function syncPanel(): void {
  for (const [pid, b] of presetButtons) b.setAttribute('aria-pressed', String(pid === lab.preset));
  for (const [id, b] of scenarioButtons) b.setAttribute('aria-pressed', String(id === lab.scenario));
  $<HTMLElement>('view-single').setAttribute('aria-pressed', String(!lab.compare));
  $<HTMLElement>('view-compare').setAttribute('aria-pressed', String(lab.compare));
  $<HTMLElement>('seq').setAttribute('aria-pressed', String(lab.sequence));
  $<HTMLElement>('pause').setAttribute('aria-pressed', String(lab.paused));
  $<HTMLElement>('loop').setAttribute('aria-pressed', String(lab.loop));
  $<HTMLElement>('speed').firstChild!.textContent = `${SPEEDS[lab.speedIndex]}× `;
  $<HTMLElement>('toggle-markers').setAttribute('aria-pressed', String(lab.markers));
  $<HTMLElement>('toggle-minimap').setAttribute('aria-pressed', String(lab.minimap));
  $<HTMLElement>('toggle-hud').setAttribute('aria-pressed', String(lab.hud));
  $<HTMLElement>('editing').innerHTML = '';
  $<HTMLElement>('editing').append('Editando o preset ', Object.assign(document.createElement('b'), { textContent: `${lab.preset} — ${PRESET_INFO[lab.preset].name}` }), lab.compare ? ' (troque com 1, 2, 3)' : '');
}

// ---------------- Keyboard ----------------
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range'))) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const idx = SCENARIOS.findIndex((s) => s.id === lab.scenario);
  if (k === '1' || k === '2' || k === '3') setPreset(PRESET_IDS[Number(k) - 1]!);
  else if (k === 'q') setCompare(!lab.compare);
  else if (k === 't') startSequence();
  else if (k === ' ') { lab.paused = !lab.paused; syncPanel(); e.preventDefault(); }
  else if (k === 'r') restart();
  else if (k === 's') cycleSpeed();
  else if (k === 'l') { lab.loop = !lab.loop; syncPanel(); }
  else if (k === '[') void loadScenario(SCENARIOS[(idx - 1 + SCENARIOS.length) % SCENARIOS.length]!.id);
  else if (k === ']') void loadScenario(SCENARIOS[(idx + 1) % SCENARIOS.length]!.id);
  else if (k === 'd') { lab.markers = !lab.markers; syncPanel(); }
  else if (k === 'm') { lab.minimap = !lab.minimap; syncPanel(); }
  else if (k === 'h') { lab.hud = !lab.hud; syncPanel(); }
  else if (k === 'p') $<HTMLElement>('lab').classList.toggle('no-tuning');
  else return;
  if (t?.tagName === 'INPUT') t.blur();
});

// ---------------- Boot ----------------
function startScenarioFromHash(): string {
  const h = location.hash.replace('#', '').toLowerCase();
  return SCENARIOS.some((s) => s.id === h) ? h : lab.scenario;
}
syncPanel();
void loadScenario(startScenarioFromHash()).then(() => stage.renderer.setAnimationLoop(frameLoop));

// ---------------- Automation hook (smoke test, captures) ----------------
declare global {
  interface Window {
    __cameraLab: {
      state(): { scenario: string; preset: PresetId; compare: boolean; paused: boolean; loading: boolean; time: number; ticks: number; frames: number; mode: string; fov: number; viewports: number };
      readability(): Record<PresetId, ReadabilitySummary>;
      scenarios: string[];
      loadScenario(id: string): Promise<void>;
      setPreset(id: PresetId): void;
      setCompare(on: boolean): void;
      setPaused(on: boolean): void;
      /** Step `seconds` of fight at the fixed 60 Hz tick (independent of the frame rate), then draw once. */
      advance(seconds: number): void;
    };
  }
}

window.__cameraLab = {
  state: () => ({
    scenario: lab.scenario,
    preset: lab.preset,
    compare: lab.compare,
    paused: lab.paused,
    loading: lab.loading,
    time: source?.frame.time ?? 0,
    ticks: lab.ticks,
    frames: lab.frames,
    mode: lastOut[lab.preset]?.mode ?? '',
    fov: lastOut[lab.preset]?.fov ?? 0,
    viewports: stage.currentViewports.length,
  }),
  readability: () => ({ A: meters.A.summary, B: meters.B.summary, C: meters.C.summary }),
  scenarios: SCENARIOS.map((s) => s.id),
  loadScenario,
  setPreset,
  setCompare,
  setPaused: (on) => {
    lab.paused = on;
    syncPanel();
  },
  advance: (seconds) => {
    const n = Math.max(1, Math.round(seconds / DT));
    for (let i = 0; i < n && source && !source.finished; i++) tick();
    render(1);
  },
};
