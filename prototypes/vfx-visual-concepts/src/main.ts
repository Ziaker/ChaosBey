// ============================================================
// VFX LANGUAGE LAB — ENTRY POINT
// Compares two complete VFX languages (A Mechanical, B Anime) on the same
// scripted combat moments, in the approved arena. Visual exploration only
// (GDD 1.6 / 51 / 54 / 98): imports nothing from the game.
// Keys: 1–8 effect · A / B / V (split) · Z X C intensity · R replay · S slow motion
// ============================================================

import { FOUNDRY_PIT } from '../../arena-visual-concepts/src/arenas/foundryPit';
import { RIFT_CRATER } from '../../arena-visual-concepts/src/arenas/riftCrater';
import { TOURNAMENT_STADIUM } from '../../arena-visual-concepts/src/arenas/tournamentStadium';
import type { ArenaConcept } from '../../arena-visual-concepts/src/arenas/types';
import { CONCEPTS as BEYS } from '../../bey-visual-concepts/src/concepts/conceptDefinitions';
import { ANIME } from './languages/anime';
import { MECHANICAL } from './languages/mechanical';
import type { VfxLanguage } from './languages/types';
import { SCENARIOS } from './scenarios/scenarios';
import { VfxStage } from './stage/VfxStage';
import { World } from './stage/World';

const LANGUAGES: readonly VfxLanguage[] = [MECHANICAL, ANIME];
const ARENAS: readonly ArenaConcept[] = [FOUNDRY_PIT, RIFT_CRATER, TOURNAMENT_STADIUM];
const INTENSITIES = [
  { id: 'light', label: 'Light', m: 0.3, key: 'Z' },
  { id: 'medium', label: 'Medium', m: 0.62, key: 'X' },
  { id: 'heavy', label: 'Heavy', m: 1, key: 'C' },
] as const;

type View = 'A' | 'B' | 'split';
const state = {
  view: 'split' as View,
  scenario: SCENARIOS[0]!,
  intensity: INTENSITIES[1] as (typeof INTENSITIES)[number],
  arena: ARENAS[0]!,
  bey: ['attack-a', 'defense-c'] as [string, string],
};

const $ = <T extends HTMLElement>(id: string): T => {
  const n = document.getElementById(id);
  if (!n) throw new Error(`VFX lab: missing #${id}`);
  return n as T;
};

const stage = new VfxStage($<HTMLCanvasElement>('vfx-canvas'), $<HTMLCanvasElement>('vfx-overlay'), $<HTMLCanvasElement>('vfx-invert'), $('stage'));

function rebuild(): void {
  const langs = state.view === 'split' ? LANGUAGES : LANGUAGES.filter((l) => l.id === state.view);
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

for (const [view, label, key] of [['A', 'A · Mechanical', 'A'], ['B', 'B · Anime', 'B'], ['split', 'A | B compare', 'V']] as const) {
  buttons.view.set(view, mkButton($('view-picker'), 'chip', `<span>${label}</span><kbd>${key}</kbd>`, () => { state.view = view; rebuild(); }));
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
  arenaSelect.value = state.arena.id;
  const notes = $('notes');
  notes.innerHTML = '';
  for (const lang of LANGUAGES) {
    const dt = document.createElement('dt');
    dt.textContent = `${lang.id} · ${lang.name}`;
    const dd = document.createElement('dd');
    dd.textContent = lang.notes[state.scenario.id] ?? '';
    notes.append(dt, dd);
  }
  const badges = $('badges');
  badges.innerHTML = '';
  const shown = state.view === 'split' ? LANGUAGES : LANGUAGES.filter((l) => l.id === state.view);
  badges.dataset.split = String(shown.length > 1);
  for (const lang of shown) {
    const b = document.createElement('div');
    b.className = `badge lang-${lang.id}`;
    b.innerHTML = `<strong>${lang.id}</strong><span></span>`;
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
    a: () => { state.view = 'A'; rebuild(); },
    b: () => { state.view = 'B'; rebuild(); },
    v: () => { state.view = 'split'; rebuild(); },
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
    set: (o: { view?: View; scenario?: string; intensity?: 'light' | 'medium' | 'heavy'; arena?: string }) => {
      const needsRebuild = (o.view && o.view !== state.view) || (o.arena && o.arena !== state.arena.id);
      if (o.view) state.view = o.view;
      if (o.arena) state.arena = ARENAS.find((a) => a.id === o.arena) ?? state.arena;
      if (o.scenario) state.scenario = SCENARIOS.find((s) => s.id === o.scenario) ?? state.scenario;
      if (o.intensity) state.intensity = INTENSITIES.find((i) => i.id === o.intensity) ?? state.intensity;
      if (needsRebuild) rebuild(); else replay();
    },
    time: () => stage.worlds.map((w) => w.t),
  },
});
