// ============================================================
// STAMINA & STABILITY LAB — PAGE WIRING
// Visual exploration prototype (GDD 1.6 / 28–30 / 84 / 123). Imports
// nothing from src/ (the game); it reuses the round-2 Bey concepts from
// prototypes/bey-visual-concepts. Owns the sims, builds the worlds for the
// current view, runs the frame loop and keeps the side panels in sync.
// Automation hook for the smoke test: window.__conditionLab.
// ============================================================

import { CONCEPTS } from '../../bey-visual-concepts/src/concepts/conceptDefinitions';
import type { ConceptDefinition } from '../../bey-visual-concepts/src/model/types';
import { LANGUAGE_IDS, LANGUAGE_INFO, type LanguageId } from './languages/types';
import { AUTO_HITS, ConditionSim, type ConditionEvent, type HitStrength } from './sim/ConditionSim';
import { Stage, type CameraMode } from './stage/Stage';
import { World } from './stage/World';
import { TUNING } from './tuning';
import { TuningPanel, type SavedChoice } from './ui/TuningPanel';

// ---------------- PAGE TUNING ----------------
const DEFAULT_TEST_BEY = 'defense-c';     // Blue glow: reads against the red danger cues.
const DEFAULT_OPPONENT = 'attack-a';
const LADDER_X = [-5.4, -2.7, 0, 2.7, 5.4];
const STAMINA_LADDER = [1, 0.75, 0.5, 0.25, 0.06];
const STAMINA_LADDER_STABILITY = 0.9;
const STABILITY_LADDER = [1, 0.7, 0.4, 0.15, 0];
const STABILITY_LADDER_STAMINA = 0.8;
const TIMELINE_SECONDS = 42;             // Approximate length of one scripted fight (for the strip).
const SLOW_MOTION = 0.25;
const MAX_FRAME_DT = 0.05;
// ------------------------------------------------

type View = 'arena' | 'compare' | 'ladderStamina' | 'ladderStability';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const conceptById = (id: string): ConceptDefinition => CONCEPTS.find((c) => c.id === id) ?? CONCEPTS[0]!;
const pct = (v: number): string => `${Math.round(v * 100)}%`;

// ---------------- State ----------------
const lab = {
  view: 'arena' as View,
  layers: { A: true, B: false, C: false } as Record<LanguageId, boolean>,
  mix: false,
  paused: false,
  slow: false,
  testBey: DEFAULT_TEST_BEY,
  opponent: DEFAULT_OPPONENT,
  frames: 0,
};

const mainSim = new ConditionSim('auto', 7, () => TUNING.spinOutSeconds);
const ladderSims = LADDER_X.map((_, i) => new ConditionSim('hold', 20 + i, () => TUNING.spinOutSeconds));

const stageEl = $<HTMLElement>('stage');
const stage = new Stage($<HTMLCanvasElement>('lab-canvas'), stageEl);
let worlds: World[] = [];
let lastCamera: CameraMode = 'game';

// ---------------- Worlds ----------------
function isLadder(view: View = lab.view): boolean {
  return view === 'ladderStamina' || view === 'ladderStability';
}

function applyLadderPresets(): void {
  ladderSims.forEach((sim, i) => {
    if (lab.view === 'ladderStamina') sim.setHold(STAMINA_LADDER[i]!, STAMINA_LADDER_STABILITY, false);
    else sim.setHold(STABILITY_LADDER_STAMINA, STABILITY_LADDER[i]!, STABILITY_LADDER[i] === 0);
    sim.reset();
  });
}

function ladderLabel(i: number): string {
  if (lab.view === 'ladderStamina') return `Stamina ${pct(STAMINA_LADDER[i]!)}`;
  const v = STABILITY_LADDER[i]!;
  return v === 0 ? 'Quebrado' : `Stability ${pct(v)}`;
}

function buildWorlds(): void {
  worlds.forEach((w) => w.dispose());
  worlds = [];
  const test = conceptById(lab.testBey);
  if (isLadder()) {
    applyLadderPresets();
    const w = new World('flat', stage.camera, TUNING, stage.environment);
    ladderSims.forEach((sim, i) => w.addBey(test, sim, { kind: 'fixed', x: LADDER_X[i]!, z: 0 }, i * 1.3, ladderLabel(i)));
    w.setLayers(lab.layers);
    worlds.push(w);
  } else {
    const sets: Array<Record<LanguageId, boolean>> = lab.view === 'compare'
      ? LANGUAGE_IDS.map((id) => ({ A: id === 'A', B: id === 'B', C: id === 'C' }))
      : [lab.layers];
    for (const layers of sets) {
      const w = new World('bowl', stage.camera, TUNING, stage.environment);
      w.addBey(test, mainSim, { kind: 'path' });
      w.setOpponent(conceptById(lab.opponent));
      w.setLayers(layers);
      worlds.push(w);
    }
  }
  stage.setWorlds(worlds);
  buildOverlay();
}

// ---------------- Overlay (badges, ladder labels, readout) ----------------
const overlay = $<HTMLElement>('overlay');
let overlayItems: HTMLElement[] = [];

function buildOverlay(): void {
  overlayItems.forEach((el) => el.remove());
  overlayItems = [];
  if (lab.view === 'compare') {
    for (const id of LANGUAGE_IDS) {
      const b = document.createElement('div');
      b.className = 'badge';
      b.dataset.lang = id;
      b.innerHTML = `<strong>${id}</strong><span></span>`;
      b.querySelector('span')!.textContent = LANGUAGE_INFO[id].name;
      overlay.append(b);
      overlayItems.push(b);
    }
    for (let i = 0; i < 2; i++) {
      const d = document.createElement('div');
      d.className = 'divider';
      overlay.append(d);
      overlayItems.push(d);
    }
  } else if (isLadder()) {
    for (const entry of worlds[0]?.entries ?? []) {
      const l = document.createElement('div');
      l.className = 'ladder-label';
      l.textContent = entry.label;
      overlay.append(l);
      overlayItems.push(l);
    }
  }
}

const projected = { x: 0, y: 0 };
function positionOverlay(): void {
  const vps = stage.currentViewports;
  if (lab.view === 'compare') {
    const horizontal = vps.length > 1 && vps[1]!.x > 0;
    LANGUAGE_IDS.forEach((_, i) => {
      const v = vps[i];
      const b = overlayItems[i];
      if (!v || !b) return;
      b.style.left = `${v.x + 14}px`;
      b.style.top = `${v.y + (i === 0 ? 44 : 14)}px`;
    });
    for (let k = 0; k < 2; k++) {
      const d = overlayItems[3 + k];
      const v = vps[k + 1];
      if (!d || !v) continue;
      if (horizontal) Object.assign(d.style, { left: `${v.x - 1}px`, top: '0', width: '2px', height: '100%' });
      else Object.assign(d.style, { left: '0', top: `${v.y - 1}px`, width: '100%', height: '2px' });
    }
  } else if (isLadder()) {
    worlds[0]?.entries.forEach((entry, i) => {
      const el = overlayItems[i];
      if (!el) return;
      const p = entry.rig.root.position.clone();
      p.y -= 0.15;
      if (stage.project(p, 0, projected)) {
        el.style.left = `${projected.x}px`;
        el.style.top = `${projected.y + 8}px`;
        el.hidden = false;
      } else {
        el.hidden = true;
      }
      el.classList.toggle('broken', entry.sim.state.broken);
    });
  }
}

// ---------------- Left panel ----------------
const langPicker = $<HTMLElement>('lang-picker');
const langButtons = new Map<LanguageId, HTMLButtonElement>();
for (const id of LANGUAGE_IDS) {
  const info = LANGUAGE_INFO[id];
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'lang';
  b.dataset.lang = id;
  b.innerHTML = `<strong>${id}</strong><span></span><kbd>${LANGUAGE_IDS.indexOf(id) + 1}</kbd>`;
  const span = b.querySelector('span')!;
  span.textContent = info.name;
  const small = document.createElement('small');
  small.textContent = id === 'A' ? 'movimento, material e contato' : id === 'B' ? 'aura, escudos e perigo em anime' : 'anel no chão e núcleo pulsando';
  span.append(small);
  b.addEventListener('click', () => pickLanguage(id));
  langPicker.append(b);
  langButtons.set(id, b);
}

const mixInput = $<HTMLInputElement>('mix');
mixInput.addEventListener('change', () => {
  lab.mix = mixInput.checked;
  if (!lab.mix) {
    const first = LANGUAGE_IDS.find((id) => lab.layers[id]) ?? 'A';
    lab.layers = { A: first === 'A', B: first === 'B', C: first === 'C' };
    applyLayers();
  }
  syncPanel();
});

function pickLanguage(id: LanguageId): void {
  if (lab.mix) lab.layers = { ...lab.layers, [id]: !lab.layers[id] };
  else lab.layers = { A: id === 'A', B: id === 'B', C: id === 'C' };
  if (lab.view === 'compare') setView('arena');
  else applyLayers();
  syncPanel();
}

function applyLayers(): void {
  if (lab.view !== 'compare') worlds.forEach((w) => w.setLayers(lab.layers));
  tuningPanel.focusGroups(lab.view === 'compare' ? { A: true, B: true, C: true } : lab.layers);
}

const notes = $<HTMLElement>('notes');
const noteEls = new Map<LanguageId, HTMLElement>();
for (const id of LANGUAGE_IDS) {
  const info = LANGUAGE_INFO[id];
  const n = document.createElement('div');
  n.className = 'note';
  n.dataset.lang = id;
  const title = document.createElement('b');
  title.textContent = `${id} — ${info.name}`;
  const idea = document.createElement('p');
  idea.textContent = info.idea;
  const dl = document.createElement('dl');
  for (const [k, v] of [['Stamina', info.stamina], ['Stability', info.stability], ['Quebrado', info.broken]] as const) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  n.append(title, idea, dl);
  notes.append(n);
  noteEls.set(id, n);
}

const staminaInput = $<HTMLInputElement>('stamina');
const stabilityInput = $<HTMLInputElement>('stability');
const staminaOut = $<HTMLOutputElement>('stamina-out');
const stabilityOut = $<HTMLOutputElement>('stability-out');
staminaInput.addEventListener('input', () => {
  if (isLadder()) return;
  mainSim.setMode('manual');
  mainSim.setStamina(Number(staminaInput.value) / 100);
  syncPanel();
});
stabilityInput.addEventListener('input', () => {
  if (isLadder()) return;
  mainSim.setMode('manual');
  mainSim.setStability(Number(stabilityInput.value) / 100);
  syncPanel();
});

function hit(strength: HitStrength): void {
  if (isLadder()) ladderSims.forEach((s) => s.scheduleHit(strength));
  else mainSim.scheduleHit(strength);
}
function resetAll(): void {
  if (isLadder()) ladderSims.forEach((s) => s.reset());
  else mainSim.reset();
  clearTimelineMarks();
}
function setDemo(mode: 'auto' | 'manual'): void {
  if (mode === 'auto') {
    mainSim.setMode('auto');
    mainSim.reset();
    clearTimelineMarks();
  } else {
    mainSim.setMode('manual');
  }
  syncPanel();
}

$<HTMLButtonElement>('act-light').addEventListener('click', () => hit('light'));
$<HTMLButtonElement>('act-medium').addEventListener('click', () => hit('medium'));
$<HTMLButtonElement>('act-heavy').addEventListener('click', () => hit('heavy'));
$<HTMLButtonElement>('act-break').addEventListener('click', () => mainSim.forceBreak());
$<HTMLButtonElement>('act-recover').addEventListener('click', () => mainSim.forceRecover());
$<HTMLButtonElement>('act-spinout').addEventListener('click', () => mainSim.forceSpinOut());
$<HTMLButtonElement>('act-reset').addEventListener('click', resetAll);
$<HTMLButtonElement>('demo-auto').addEventListener('click', () => setDemo('auto'));
$<HTMLButtonElement>('demo-manual').addEventListener('click', () => setDemo('manual'));
$<HTMLButtonElement>('time-pause').addEventListener('click', () => { lab.paused = !lab.paused; syncPanel(); });
$<HTMLButtonElement>('time-slow').addEventListener('click', () => { lab.slow = !lab.slow; syncPanel(); });

const beySelects = [$<HTMLSelectElement>('bey-test'), $<HTMLSelectElement>('bey-opp')];
for (const sel of beySelects) {
  for (const c of CONCEPTS) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.archetype[0]!.toUpperCase()}${c.archetype.slice(1)} ${c.letter} — ${c.headline}`;
    sel.append(o);
  }
}
beySelects[0]!.value = lab.testBey;
beySelects[1]!.value = lab.opponent;
beySelects[0]!.addEventListener('change', () => { lab.testBey = beySelects[0]!.value; buildWorlds(); });
beySelects[1]!.addEventListener('change', () => { lab.opponent = beySelects[1]!.value; buildWorlds(); });

// ---------------- Toolbar (view + camera) ----------------
interface Tool { id: string; label: string; key: string }
const TOOLS: Tool[] = [
  { id: 'game', label: 'Jogo', key: 'G' },
  { id: 'gameFar', label: 'Oponente longe', key: 'L' },
  { id: 'close', label: 'Perto', key: 'V' },
  { id: 'compare', label: 'A | B | C', key: 'Q' },
  { id: 'ladderStamina', label: 'Escada Stamina', key: 'E' },
  { id: 'ladderStability', label: 'Escada Stability', key: 'T' },
  { id: 'tuning', label: 'Ajuste', key: 'P' },
];
const toolbar = $<HTMLElement>('toolbar');
const toolButtons = new Map<string, HTMLButtonElement>();
for (const t of TOOLS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool';
  b.dataset.tool = t.id;
  b.innerHTML = `<span></span><kbd>${t.key}</kbd>`;
  b.querySelector('span')!.textContent = t.label;
  b.addEventListener('click', () => runTool(t.id));
  toolbar.append(b);
  toolButtons.set(t.id, b);
}

function setView(view: View): void {
  if (view === lab.view) return;
  const wasLadder = isLadder();
  lab.view = view;
  buildWorlds();
  if (isLadder()) stage.setMode('ladder');
  else if (wasLadder) stage.setMode(lastCamera);
  applyLayers();
  syncPanel();
}

function runTool(id: string): void {
  if (id === 'tuning') {
    $<HTMLElement>('lab').classList.toggle('no-tuning');
    return;
  }
  if (id === 'compare') {
    setView(lab.view === 'compare' ? 'arena' : 'compare');
    return;
  }
  if (id === 'ladderStamina' || id === 'ladderStability') {
    setView(lab.view === id ? 'arena' : id);
    return;
  }
  const cam = id as CameraMode;
  lastCamera = cam;
  if (isLadder()) setView('arena');
  stage.setMode(cam);
  syncPanel();
}
stage.onModeChange(() => syncPanel());

// ---------------- Keyboard ----------------
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement | null;
  // Only text-like fields keep their keys; sliders and the mix checkbox still let shortcuts through.
  if (t && (t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['range', 'checkbox'].includes((t as HTMLInputElement).type)))) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  const tool = TOOLS.find((x) => x.key.toLowerCase() === k);
  if (k === '1' || k === '2' || k === '3') pickLanguage(LANGUAGE_IDS[Number(k) - 1]!);
  else if (tool) runTool(tool.id);
  else if (k === 'z') hit('light');
  else if (k === 'x') hit('medium');
  else if (k === 'c') hit('heavy');
  else if (k === 'b') mainSim.forceBreak();
  else if (k === 'r') mainSim.forceRecover();
  else if (k === 'o') mainSim.forceSpinOut();
  else if (k === 'n') resetAll();
  else if (k === 'm') setDemo(mainSim.mode === 'auto' ? 'manual' : 'auto');
  else if (k === 's') { lab.slow = !lab.slow; syncPanel(); }
  else if (k === ' ') { lab.paused = !lab.paused; syncPanel(); e.preventDefault(); }
  else return;
  if (t?.tagName === 'INPUT') t.blur();
});

// ---------------- Timeline strip ----------------
const timeline = $<HTMLElement>('timeline');
const timelineFill = $<HTMLElement>('timeline-fill');
const timelineLabel = $<HTMLElement>('timeline-label');
const dynamicMarks: HTMLElement[] = [];
for (const h of AUTO_HITS) addMark(`hit-${h.strength}`, h.t, false);
function addMark(cls: string, t: number, dynamic: boolean): void {
  const m = document.createElement('div');
  m.className = `mark ${cls}`;
  m.style.left = `${Math.min(100, (t / TIMELINE_SECONDS) * 100)}%`;
  timeline.append(m);
  if (dynamic) dynamicMarks.push(m);
}
function clearTimelineMarks(): void {
  dynamicMarks.splice(0).forEach((m) => m.remove());
}
function onMainEvents(events: readonly ConditionEvent[]): void {
  if (mainSim.mode !== 'auto') return;
  for (const e of events) {
    if (e.kind === 'reset') clearTimelineMarks();
    else if (e.kind === 'break' || e.kind === 'recover' || e.kind === 'spinOut') addMark(e.kind, mainSim.state.time, true);
  }
}

// ---------------- Panel sync ----------------
const readout = $<HTMLElement>('readout');
function syncPanel(): void {
  const s = mainSim.state;
  const ladder = isLadder();
  for (const [id, b] of langButtons) b.setAttribute('aria-pressed', String(lab.view === 'compare' ? true : lab.layers[id]));
  for (const [id, n] of noteEls) n.classList.toggle('dim', lab.view !== 'compare' && !lab.layers[id]);
  mixInput.checked = lab.mix;
  $<HTMLElement>('pill-auto').classList.toggle('on', mainSim.mode === 'auto' && !ladder);
  $<HTMLElement>('pill-broken').classList.toggle('on', !ladder && s.broken);
  $<HTMLElement>('pill-spin').classList.toggle('on', !ladder && s.spinOut > 0);
  $<HTMLElement>('demo-auto').setAttribute('aria-pressed', String(mainSim.mode === 'auto'));
  $<HTMLElement>('demo-manual').setAttribute('aria-pressed', String(mainSim.mode === 'manual'));
  $<HTMLElement>('time-pause').setAttribute('aria-pressed', String(lab.paused));
  $<HTMLElement>('time-slow').setAttribute('aria-pressed', String(lab.slow));
  for (const id of ['act-break', 'act-recover', 'act-spinout', 'demo-auto', 'demo-manual']) ($<HTMLButtonElement>(id)).disabled = ladder;
  staminaInput.disabled = ladder;
  stabilityInput.disabled = ladder;
  const cam = stage.cameraMode;
  for (const [id, b] of toolButtons) {
    let on = false;
    if (id === 'compare') on = lab.view === 'compare';
    else if (id === 'ladderStamina' || id === 'ladderStability') on = lab.view === id;
    else if (id === 'tuning') on = !$<HTMLElement>('lab').classList.contains('no-tuning');
    else on = !ladder && cam === id;
    b.setAttribute('aria-pressed', String(on));
  }
  timeline.hidden = ladder || mainSim.mode !== 'auto';
}

function syncLive(): void {
  const s = mainSim.state;
  if (!isLadder()) {
    if (document.activeElement !== staminaInput) staminaInput.value = String(Math.round(s.stamina * 100));
    if (document.activeElement !== stabilityInput) stabilityInput.value = String(Math.round(s.stability * 100));
    staminaOut.textContent = pct(s.stamina);
    stabilityOut.textContent = pct(s.stability);
    const status = s.spinOut >= 1 ? ' · PARADO' : s.spinOut > 0 ? ' · SPIN-OUT' : s.broken ? ' · QUEBRADO' : '';
    readout.innerHTML = '';
    readout.append(`Stamina ${pct(s.stamina)} · Stability ${pct(s.stability)}${status}`);
    const small = document.createElement('small');
    small.textContent = '(leitura do lab, não é HUD)';
    readout.append(small);
    timelineFill.style.width = `${Math.min(100, (s.time / TIMELINE_SECONDS) * 100)}%`;
    timelineLabel.textContent = `${s.time.toFixed(1)} s`;
  } else {
    readout.textContent = lab.view === 'ladderStamina'
      ? `Escada de Stamina · Stability fixa em ${pct(STAMINA_LADDER_STABILITY)} · golpes atingem os cinco`
      : `Escada de Stability · Stamina fixa em ${pct(STABILITY_LADDER_STAMINA)} · golpes atingem os cinco`;
  }
  const s0 = s.broken;
  if ($<HTMLElement>('pill-broken').classList.contains('on') !== (!isLadder() && s0) || $<HTMLElement>('pill-spin').classList.contains('on') !== (!isLadder() && s.spinOut > 0)) syncPanel();
}

// ---------------- Tuning panel ----------------
const tuningPanel = new TuningPanel(
  $<HTMLElement>('tune-groups'),
  $<HTMLElement>('tune-status'),
  (): SavedChoice => ({ layers: { ...lab.layers }, mix: lab.mix }),
  (choice) => {
    lab.mix = Boolean(choice.mix);
    lab.layers = { A: Boolean(choice.layers.A), B: Boolean(choice.layers.B), C: Boolean(choice.layers.C) };
    applyLayers();
    syncPanel();
  },
);
$<HTMLButtonElement>('tune-save').addEventListener('click', () => void tuningPanel.saveFinal());
$<HTMLButtonElement>('tune-copy').addEventListener('click', () => void tuningPanel.copy());
$<HTMLButtonElement>('tune-reset').addEventListener('click', () => tuningPanel.reset());

// ---------------- Deep links (#compare, #stamina, #stability, #a, #b, #c) ----------------
function applyHash(): void {
  const h = location.hash.replace('#', '').toLowerCase();
  if (h === 'a' || h === 'b' || h === 'c') pickLanguage(h.toUpperCase() as LanguageId);
  else if (h === 'compare') setView('compare');
  else if (h === 'stamina') setView('ladderStamina');
  else if (h === 'stability') setView('ladderStability');
}

// ---------------- Frame loop ----------------
let last = performance.now();
const eventsBySim = new Map<ConditionSim, ConditionEvent[]>();
/** Advance sims and worlds by `dt` seconds of lab time (no rendering). */
function tick(dt: number): void {
  eventsBySim.clear();
  const sims = isLadder() ? ladderSims : [mainSim];
  for (const sim of sims) eventsBySim.set(sim, sim.step(dt));
  if (!isLadder()) onMainEvents(eventsBySim.get(mainSim) ?? []);
  for (const w of worlds) w.update(dt, eventsBySim);
}
function frame(): void {
  const now = performance.now();
  const realDt = Math.min(MAX_FRAME_DT, (now - last) / 1000);
  last = now;
  tick(lab.paused ? 0 : realDt * (lab.slow ? SLOW_MOTION : 1));
  stage.render(realDt);
  positionOverlay();
  syncLive();
  lab.frames++;
}

buildWorlds();
applyLayers();
syncPanel();
applyHash();
window.addEventListener('hashchange', applyHash);
stage.renderer.setAnimationLoop(frame);

// ---------------- Automation hook (smoke test) ----------------
declare global {
  interface Window {
    __conditionLab: {
      state(): {
        view: View;
        layers: Record<LanguageId, boolean>;
        mix: boolean;
        camera: CameraMode;
        mode: string;
        stamina: number;
        stability: number;
        broken: boolean;
        spinOut: number;
        worlds: number;
        beys: number;
        frames: number;
      };
      setView(view: View): void;
      pick(id: LanguageId): void;
      hit(strength: HitStrength): void;
      forceBreak(): void;
      forceRecover(): void;
      forceSpinOut(): void;
      setManual(stamina: number, stability: number): void;
      reset(): void;
      /** Step the lab by `seconds` of lab time at a fixed 60 Hz, independent of the frame rate (tests, captures). */
      advance(seconds: number): void;
    };
  }
}

window.__conditionLab = {
  state: () => {
    const s = mainSim.state;
    return {
      view: lab.view,
      layers: { ...lab.layers },
      mix: lab.mix,
      camera: stage.cameraMode,
      mode: mainSim.mode,
      stamina: s.stamina,
      stability: s.stability,
      broken: s.broken,
      spinOut: s.spinOut,
      worlds: worlds.length,
      beys: worlds.reduce((n, w) => n + w.entries.length, 0),
      frames: lab.frames,
    };
  },
  setView,
  pick: pickLanguage,
  hit,
  forceBreak: () => mainSim.forceBreak(),
  forceRecover: () => mainSim.forceRecover(),
  forceSpinOut: () => mainSim.forceSpinOut(),
  setManual: (stamina, stability) => {
    mainSim.setMode('manual');
    mainSim.setStamina(stamina);
    mainSim.setStability(stability);
    syncPanel();
  },
  reset: resetAll,
  advance: (seconds) => {
    const steps = Math.max(1, Math.round(seconds * 60));
    for (let i = 0; i < steps; i++) tick(1 / 60);
    stage.render(seconds); // let the camera catch up with the whole step
    positionOverlay();
    syncLive();
  },
};
