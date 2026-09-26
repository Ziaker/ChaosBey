// ============================================================
// VFX LANGUAGE LAB — ENTRY POINT
// Compares complete VFX languages (A Mechanical, B Anime, C Hybrid) on the same
// scripted combat moments, in the approved arena. Visual exploration only
// (GDD 1.6 / 51 / 54 / 98): imports nothing from the game.
// Keys: 1–9 effect · A / B / H (hybrid) / V (A|B) / W (B|C) / Q (wind 1|2|3)
//       J K L U wind style (1 / 2 / 3 / v1) · Z X C intensity · R replay · S slow motion
// ============================================================

import { FOUNDRY_PIT } from '../../arena-visual-concepts/src/arenas/foundryPit';
import { RIFT_CRATER } from '../../arena-visual-concepts/src/arenas/riftCrater';
import { TOURNAMENT_STADIUM } from '../../arena-visual-concepts/src/arenas/tournamentStadium';
import type { ArenaConcept } from '../../arena-visual-concepts/src/arenas/types';
import { CONCEPTS as BEYS } from '../../bey-visual-concepts/src/concepts/conceptDefinitions';
import { ANIME } from './languages/anime';
import { WIND_STYLES, makeHybrid, type WindStyle } from './languages/hybrid';
import { MECHANICAL } from './languages/mechanical';
import type { VfxLanguage } from './languages/types';
import { SCENARIOS } from './scenarios/scenarios';
import { VfxStage } from './stage/VfxStage';
import { World } from './stage/World';

const WIND_COMPARE: readonly WindStyle[] = ['sonic', 'comet', 'cel'];
const WIND_SCENARIOS = ['burst', 'dash', 'dodge'];
const ARENAS: readonly ArenaConcept[] = [FOUNDRY_PIT, RIFT_CRATER, TOURNAMENT_STADIUM];
const INTENSITIES = [
  { id: 'light', label: 'Light', m: 0.3, key: 'Z' },
  { id: 'medium', label: 'Medium', m: 0.62, key: 'X' },
  { id: 'heavy', label: 'Heavy', m: 1, key: 'C' },
] as const;

type View = 'A' | 'B' | 'C' | 'AB' | 'BC' | 'W';
const state = {
  view: 'W' as View,
  wind: 'sonic' as WindStyle,
  scenario: SCENARIOS[0]!,
  intensity: INTENSITIES[1] as (typeof INTENSITIES)[number],
  arena: ARENAS[0]!,
  bey: ['attack-a', 'defense-c'] as [string, string],
};
/** Which languages each view shows, left to right. */
function langsFor(v: View): VfxLanguage[] {
  const c = makeHybrid(state.wind);
  switch (v) {
    case 'A': return [MECHANICAL];
    case 'B': return [ANIME];
    case 'C': return [c];
    case 'AB': return [MECHANICAL, ANIME];
    case 'BC': return [ANIME, c];
    case 'W': return WIND_COMPARE.map(makeHybrid);
  }
}
if (!WIND_SCENARIOS.includes(state.scenario.id)) state.scenario = SCENARIOS.find((s) => s.id === 'burst') ?? state.scenario;

const $ = <T extends HTMLElement>(id: string): T => {
  const n = document.getElementById(id);
  if (!n) throw new Error(`VFX lab: missing #${id}`);
  return n as T;
};

const stage = new VfxStage($<HTMLCanvasElement>('vfx-canvas'), $<HTMLCanvasElement>('vfx-overlay'), $<HTMLCanvasElement>('vfx-invert'), $('stage'));

function rebuild(): void {
  const langs = langsFor(state.view);
  const worlds = langs.map((lang) => {
    const w = new World(lang, state.arena, stage.camera, state.scenario, state.intensity.m);
    state.bey.forEach((id, slot) => w.setBey(slot as 0 | 1, BEYS.find((b) => b.id === id)!));
    w.replay();
    return w;
  });
  stage.setWorlds(worlds);
  stage.resetCamera();
  syncUi();
}

function replay(): void {
  stage.worlds.forEach((w) => w.setScenario(state.scenario, state.intensity.m));
  stage.resetCamera();
  syncUi();
}

// ---------- UI construction ----------
const buttons = {
  view: new Map<View, HTMLButtonElement>(),
  scenario: new Map<string, HTMLButtonElement>(),
  intensity: new Map<string, HTMLButtonElement>(),
  wind: new Map<WindStyle, HTMLButtonElement>(),
};
const mkButton = (parent: HTMLElement, cls: string, html: string, onClick: () => void): HTMLButtonElement => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.innerHTML = html;
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', onClick);
  parent.append(b);
  return b;
};

function setView(view: View): void {
  state.view = view;
  // The wind comparison is only meaningful on moments that trigger a wind burst.
  if (view === 'W' && !WIND_SCENARIOS.includes(state.scenario.id)) state.scenario = SCENARIOS.find((s) => s.id === 'burst')!;
  rebuild();
}
function setWind(wind: WindStyle): void {
  state.wind = wind;
  if (state.view === 'W' || state.view === 'A' || state.view === 'B' || state.view === 'AB') state.view = 'C';
  rebuild();
}
for (const [view, label, key] of [['W', 'Wind 1 | 2 | 3', 'Q'], ['C', 'C · Hybrid', 'H'], ['A', 'A · Mechanical', 'A'], ['B', 'B · Anime', 'B'], ['BC', 'B | C compare', 'W'], ['AB', 'A | B compare', 'V']] as const) {
  buttons.view.set(view, mkButton($('view-picker'), 'chip', `<span>${label}</span><kbd>${key}</kbd>`, () => setView(view)));
}
for (const [i, w] of WIND_STYLES.entries()) {
  buttons.wind.set(w.id, mkButton($('wind-picker'), 'chip', `<span>${w.label}</span><kbd>${'JKLU'[i]}</kbd>`, () => setWind(w.id)));
}
SCENARIOS.forEach((s, i) => {
  buttons.scenario.set(s.id, mkButton($('scenario-picker'), 'row-button', `<span class="num">${i + 1}</span><span>${s.label}</span>`, () => { state.scenario = s; replay(); }));
});
for (const it of INTENSITIES) {
  buttons.intensity.set(it.id, mkButton($('intensity-picker'), 'chip', `<span>${it.label}</span><kbd>${it.key}</kbd>`, () => { state.intensity = it; replay(); }));
}

const arenaSelect = $<HTMLSelectElement>('arena-select');
for (const a of ARENAS) arenaSelect.append(new Option(`${a.letter} — ${a.headline}`, a.id));
arenaSelect.addEventListener('change', () => { state.arena = ARENAS.find((a) => a.id === arenaSelect.value)!; rebuild(); });
for (const slot of [0, 1] as const) {
  const sel = $<HTMLSelectElement>(`bey-${slot + 1}`);
  for (const b of BEYS) sel.append(new Option(`${b.archetype.toUpperCase()} ${b.letter} — ${b.headline}`, b.id));
  sel.value = state.bey[slot];
  sel.addEventListener('change', () => { state.bey[slot] = sel.value; rebuild(); });
}

mkButton($('toolbar'), 'tool-button', '<span>Replay</span><kbd>R</kbd>', replay);
const slowToggle = mkButton($('toolbar'), 'tool-button', '<span>Slow motion</span><kbd>S</kbd>', () => toggleSlow());
mkButton($('toolbar'), 'tool-button', '<span>Reset camera</span>', () => stage.resetCamera());

function toggleSlow(): void {
  stage.slowMotion = !stage.slowMotion;
  slowToggle.setAttribute('aria-pressed', String(stage.slowMotion));
}

function syncUi(): void {
  buttons.view.forEach((b, k) => b.setAttribute('aria-pressed', String(k === state.view)));
  buttons.scenario.forEach((b, k) => b.setAttribute('aria-pressed', String(k === state.scenario.id)));
  buttons.intensity.forEach((b, k) => b.setAttribute('aria-pressed', String(k === state.intensity.id)));
  buttons.wind.forEach((b, k) => b.setAttribute('aria-pressed', String(state.view !== 'W' && k === state.wind)));
  $('wind-note').textContent = state.view === 'W'
    ? 'Comparing 1 · Sonic Boom | 2 · Comet Wake | 3 · Cel Cyclone (all in language C). Best on effect 5, 2 or 4.'
    : WIND_STYLES.find((w) => w.id === state.wind)!.summary;
  arenaSelect.value = state.arena.id;
  const notes = $('notes');
  notes.innerHTML = '';
  for (const lang of [MECHANICAL, ANIME, makeHybrid(state.wind)]) {
    const dt = document.createElement('dt');
    dt.textContent = `${lang.id} · ${lang.name}`;
    const dd = document.createElement('dd');
    dd.textContent = lang.notes[state.scenario.id] ?? '';
    notes.append(dt, dd);
  }
  const badges = $('badges');
  badges.innerHTML = '';
  const shown = langsFor(state.view);
  badges.dataset.split = String(shown.length > 1);
  badges.style.gridTemplateColumns = `repeat(${shown.length}, 1fr)`;
  for (const lang of shown) {
    const b = document.createElement('div');
    b.className = `badge lang-${lang.id}`;
    b.innerHTML = `<strong>${lang.id}</strong><span></span>`;
    if (state.view === 'W') b.querySelector('strong')!.textContent = lang.name.match(/wind (\d|v1)/)?.[1] ?? lang.id;
    b.querySelector('span')!.textContent = `${lang.name} · ${state.scenario.label} · ${state.intensity.label}`;
    badges.append(b);
  }
}

window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target instanceof HTMLSelectElement) return;
  const n = Number.parseInt(e.key, 10);
  if (n >= 1 && n <= SCENARIOS.length) { state.scenario = SCENARIOS[n - 1]!; replay(); return; }
  const k = e.key.toLowerCase();
  const it = INTENSITIES.find((i) => i.key.toLowerCase() === k);
  if (it) { state.intensity = it; replay(); return; }
  const actions: Record<string, () => void> = {
    a: () => setView('A'),
    b: () => setView('B'),
    h: () => setView('C'),
    v: () => setView('AB'),
    w: () => setView('BC'),
    q: () => setView('W'),
    j: () => setWind('sonic'),
    k: () => setWind('comet'),
    l: () => setWind('cel'),
    u: () => setWind('funnel'),
    r: replay,
    s: toggleSlow,
  };
  const act = actions[k];
  if (act) { e.preventDefault(); act(); }
});

rebuild();

// Automation hook for screenshot/smoke scripts (not a gameplay API).
Object.assign(window, {
  __vfxLab: {
    scenarios: SCENARIOS.map((s) => s.id),
    set: (o: { view?: View; wind?: WindStyle; scenario?: string; intensity?: 'light' | 'medium' | 'heavy'; arena?: string }) => {
      const needsRebuild = (o.view && o.view !== state.view) || (o.arena && o.arena !== state.arena.id) || (o.wind && o.wind !== state.wind);
      if (o.view) state.view = o.view;
      if (o.wind) state.wind = o.wind;
      if (o.arena) state.arena = ARENAS.find((a) => a.id === o.arena) ?? state.arena;
      if (o.scenario) state.scenario = SCENARIOS.find((s) => s.id === o.scenario) ?? state.scenario;
      if (o.intensity) state.intensity = INTENSITIES.find((i) => i.id === o.intensity) ?? state.intensity;
      if (needsRebuild) rebuild(); else replay();
    },
    time: () => stage.worlds.map((w) => w.t),
  },
});
