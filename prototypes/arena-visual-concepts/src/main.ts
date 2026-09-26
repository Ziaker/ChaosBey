// ============================================================
// ARENA VISUAL CONCEPTS — ENTRY POINT
// Standalone visual exploration page (GDD section 35/36/98). Imports
// nothing from the game (src/); reuses the round-2 Bey concepts.
// Keys: 1–3 arena · O overview · G gameplay cam · T top · F free
//       M motion · X clash · I impact
// ============================================================

import { CONCEPTS as BEYS } from '../../bey-visual-concepts/src/concepts/conceptDefinitions';
import { FOUNDRY_PIT } from './arenas/foundryPit';
import { RIFT_CRATER } from './arenas/riftCrater';
import { TOURNAMENT_STADIUM } from './arenas/tournamentStadium';
import type { ArenaConcept } from './arenas/types';
import { ArenaViewer, type CameraMode } from './viewer/ArenaViewer';

const ARENAS: readonly ArenaConcept[] = [FOUNDRY_PIT, RIFT_CRATER, TOURNAMENT_STADIUM];
const DEFAULT_BEYS = ['attack-a', 'defense-c'] as const;

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Arena lab: missing #${id}`);
  return node as T;
};

const viewer = new ArenaViewer($<HTMLCanvasElement>('arena-canvas'), $('stage'));
const arenaButtons = new Map<string, HTMLButtonElement>();
const camButtons = new Map<CameraMode, HTMLButtonElement>();

// ---------- arena picker ----------
for (const [i, arena] of ARENAS.entries()) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'arena-button';
  b.innerHTML = `<span class="arena-letter">${arena.letter}</span><span class="arena-name"></span><span class="arena-key">${i + 1}</span>`;
  b.querySelector('.arena-name')!.textContent = arena.headline;
  b.addEventListener('click', () => selectArena(arena.id));
  arenaButtons.set(arena.id, b);
  $('arena-picker').append(b);
}

// ---------- bowl depth ----------
const depthInput = $<HTMLInputElement>('depth');
const depths = new Map<string, number>(); // per-arena choice, kept while switching
let currentArena: ArenaConcept = ARENAS[0]!;

function showDepth(depth: number): void {
  depthInput.value = String(depth);
  $('depth-value').textContent = `${depth.toFixed(1)} m`;
  const avgSlope = (Math.atan(depth / 12) * 180) / Math.PI;
  $('depth-note').textContent = `avg slope ≈ ${avgSlope.toFixed(0)}° · default ${currentArena.defaultDepth.toFixed(1)} m`;
}
function applyDepth(depth: number): void {
  depths.set(currentArena.id, depth);
  showDepth(depth);
  viewer.showArena(currentArena, depth);
}
depthInput.addEventListener('input', () => showDepth(Number(depthInput.value)));
depthInput.addEventListener('change', () => applyDepth(Number(depthInput.value)));
$('depth-reset').addEventListener('click', () => applyDepth(currentArena.defaultDepth));

function selectArena(id: string): void {
  const arena = ARENAS.find((a) => a.id === id) ?? ARENAS[0]!;
  currentArena = arena;
  const depth = depths.get(arena.id) ?? arena.defaultDepth;
  showDepth(depth);
  viewer.showArena(arena, depth);
  arenaButtons.forEach((b, key) => b.setAttribute('aria-pressed', String(key === arena.id)));
  document.documentElement.dataset.arena = arena.letter;
  const title = $('arena-title');
  title.innerHTML = '';
  const info = $('arena-info');
  info.innerHTML = '';
  const kicker = document.createElement('div');
  kicker.className = 'info-kicker';
  kicker.textContent = `ARENA — CONCEPT ${arena.letter}`;
  const heading = document.createElement('h2');
  heading.className = 'info-title';
  heading.textContent = arena.headline;
  const desc = document.createElement('p');
  desc.className = 'info-desc';
  desc.textContent = arena.description;
  const dl = document.createElement('dl');
  dl.className = 'info-answers';
  for (const [label, value] of [
    ['Architecture', arena.answers.architecture],
    ['Floor', arena.answers.floor],
    ['Boundary', arena.answers.boundary],
    ['Lighting', arena.answers.lighting],
    ['Background', arena.answers.background],
    ['Impact / Clash', arena.answers.impact],
  ] as const) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  title.append(kicker, heading, desc);
  const h3 = document.createElement('h3');
  h3.textContent = 'VISUAL DIRECTION';
  info.append(h3, dl);
  history.replaceState(null, '', `#${arena.id}`);
}

// ---------- Bey selectors ----------
for (const [slot, id] of DEFAULT_BEYS.entries()) {
  const select = $<HTMLSelectElement>(`bey-${slot + 1}`);
  for (const bey of BEYS) {
    const opt = document.createElement('option');
    opt.value = bey.id;
    opt.textContent = `${bey.archetype.toUpperCase()} ${bey.letter} — ${bey.headline}`;
    select.append(opt);
  }
  select.value = id;
  select.addEventListener('change', () => viewer.setBey(slot as 0 | 1, BEYS.find((b) => b.id === select.value)!));
  viewer.setBey(slot as 0 | 1, BEYS.find((b) => b.id === id)!);
}

// ---------- toolbar ----------
const toolbar = $('toolbar');
const group = (): HTMLDivElement => {
  const g = document.createElement('div');
  g.className = 'toolbar-group';
  toolbar.append(g);
  return g;
};
const button = (parent: HTMLElement, label: string, key: string, onClick: () => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool-button';
  b.setAttribute('aria-pressed', 'false');
  b.innerHTML = `<span></span><kbd class="tool-key">${key}</kbd>`;
  b.querySelector('span')!.textContent = label;
  b.addEventListener('click', onClick);
  parent.append(b);
  return b;
};
const cams = group();
for (const [mode, label, key] of [['overview', 'Overview', 'O'], ['gameplay', 'Game cam', 'G'], ['top', 'Top', 'T'], ['free', 'Free', 'F']] as const) {
  camButtons.set(mode, button(cams, label, key, () => viewer.setMode(mode)));
}
const toggles = group();
const motionBtn = button(toggles, 'Motion', 'M', () => toggleMotion());
const clashBtn = button(toggles, 'Clash', 'X', () => toggleClash());
button(toggles, 'Impact', 'I', () => viewer.triggerImpact());

function toggleMotion(): void {
  viewer.setMotion(!viewer.isMotion);
  motionBtn.setAttribute('aria-pressed', String(viewer.isMotion));
}
function toggleClash(): void {
  viewer.setClash(!viewer.isClash);
  clashBtn.setAttribute('aria-pressed', String(viewer.isClash));
}
const syncCam = (m: CameraMode): void => camButtons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === m)));
viewer.onModeChange(syncCam);
syncCam(viewer.cameraMode);
motionBtn.setAttribute('aria-pressed', 'true');

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
  const n = Number.parseInt(e.key, 10);
  if (n >= 1 && n <= ARENAS.length) return selectArena(ARENAS[n - 1]!.id);
  const actions: Record<string, () => void> = {
    o: () => viewer.setMode('overview'),
    g: () => viewer.setMode('gameplay'),
    t: () => viewer.setMode('top'),
    f: () => viewer.setMode('free'),
    m: toggleMotion,
    x: toggleClash,
    i: () => viewer.triggerImpact(),
  };
  const action = actions[e.key.toLowerCase()];
  if (action) {
    e.preventDefault();
    action();
  }
});

const fromHash = location.hash.slice(1);
selectArena(ARENAS.some((a) => a.id === fromHash) ? fromHash : ARENAS[0]!.id);

// Automation hook for screenshot/smoke scripts (not a gameplay API).
Object.assign(window, {
  __arenaLab: {
    ids: ARENAS.map((a) => a.id),
    select: selectArena,
    camera: (m: CameraMode) => viewer.setMode(m),
    clash: (on: boolean) => { if (viewer.isClash !== on) toggleClash(); },
    motion: (on: boolean) => { if (viewer.isMotion !== on) toggleMotion(); },
    impact: () => viewer.triggerImpact(),
    depth: applyDepth,
    state: () => ({ mode: viewer.cameraMode, motion: viewer.isMotion, clash: viewer.isClash }),
  },
});
