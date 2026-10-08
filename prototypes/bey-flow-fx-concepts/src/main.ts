// ============================================================
// BEY FLOW FX LAB — PAGE
// Wires the stage, the effect toggles, the callout styles and the tuning
// panel. Everything here is lab UI; nothing reaches the game.
// ============================================================

import type { FxFlags } from './stage/FlowRig';
import { FlowStage } from './stage/FlowStage';
import type { CalloutKind, FlowEvent } from './sim/FlowSim';
import { CALLOUT_MEANING, CALLOUT_STYLES, CALLOUT_WORDS, CalloutLayer, type CalloutStyleId } from './ui/callouts';
import { GROUP_TITLES, PROPOSED, TUNING, TUNING_SPEC, applyTuning, resetTuning, type Tuning, type TuningGroup } from './tuning';

const DRAFT_KEY = 'chaosbey.flowfxlab.tuning.draft.v1';
const HUD_REFRESH_MS = 250;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const EFFECTS: ReadonlyArray<{ key: keyof FxFlags; label: string; key1: string }> = [
  { key: 'blur', label: 'Borrão de giro', key1: '1' },
  { key: 'lean', label: 'Inclinação', key1: '2' },
  { key: 'dust', label: 'Poeira anime', key1: '3' },
  { key: 'wind', label: 'Vento: riscos', key1: '4' },
  { key: 'swoosh', label: 'Vento: faixas', key1: '5' },
  { key: 'crown', label: 'Coroas de impacto', key1: '6' },
];

// ---------------- tuning draft (best effort) ----------------
function readDraft(): Partial<Tuning> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<Tuning>) : null;
  } catch {
    return null;
  }
}
function writeDraft(): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(TUNING));
  } catch {
    /* storage unavailable: the draft just isn't remembered */
  }
}

const stage = new FlowStage($<HTMLCanvasElement>('canvas'), $('stage'));
const callouts = new CalloutLayer($('callouts'));
let calloutStyle: CalloutStyleId = 'A';

const draft = readDraft();
if (draft) applyTuning(draft);

stage.setEventHandler((e: FlowEvent) => {
  const p = stage.project(e.x, e.z);
  callouts.spawn(e.kind, calloutStyle, p.x, p.y, TUNING.calloutScale, TUNING.calloutLifeS, e.m);
});

// ---------------- effects chips ----------------
const pressedChips = new Map<string, HTMLButtonElement>();
function chip(parent: HTMLElement, label: string, key: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.setAttribute('aria-pressed', String(pressed));
  b.innerHTML = `<kbd>${key}</kbd> ${label}`;
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

for (const fx of EFFECTS) {
  const b = chip($('effects'), fx.label, fx.key1, stage.flags[fx.key], () => toggleEffect(fx.key));
  pressedChips.set(fx.key, b);
}
function toggleEffect(key: keyof FxFlags): void {
  stage.flags[key] = !stage.flags[key];
  pressedChips.get(key)?.setAttribute('aria-pressed', String(stage.flags[key]));
}

// ---------------- scene buttons ----------------
const dashChip = chip($('scene-buttons'), 'Dashes', 'D', true, () => toggleDashes());
const pauseChip = chip($('scene-buttons'), 'Pausar', 'Espaço', false, () => togglePause());
const slowChip = chip($('scene-buttons'), 'Câmera lenta', 'S', false, () => toggleSlow());
chip($('scene-buttons'), 'Reiniciar', 'R', false, () => stage.reset());

function toggleDashes(): void {
  stage.sim.dashesEnabled = !stage.sim.dashesEnabled;
  dashChip.setAttribute('aria-pressed', String(stage.sim.dashesEnabled));
}
function togglePause(): void {
  stage.paused = !stage.paused;
  pauseChip.setAttribute('aria-pressed', String(stage.paused));
}
let slow = false;
function applySpeed(): void {
  const base = Number((document.getElementById('speed') as HTMLInputElement).value);
  stage.timeScale = slow ? base * 0.25 : base;
}
function toggleSlow(): void {
  slow = !slow;
  slowChip.setAttribute('aria-pressed', String(slow));
  applySpeed();
}

const spinInput = $<HTMLInputElement>('spin');
spinInput.addEventListener('input', () => {
  stage.sim.spinTarget = Number(spinInput.value);
  $('spin-out').textContent = `${Math.round(stage.sim.spinTarget * 100)}%`;
});
const speedInput = $<HTMLInputElement>('speed');
speedInput.addEventListener('input', () => {
  $('speed-out').textContent = `${Number(speedInput.value).toFixed(1)}x`;
  applySpeed();
});

// ---------------- callout styles ----------------
const styleChips = new Map<CalloutStyleId, HTMLButtonElement>();
CALLOUT_STYLES.forEach((s, i) => {
  const b = chip($('callout-styles'), s.label, String(7 + i), s.id === calloutStyle, () => setStyle(s.id));
  styleChips.set(s.id, b);
});
function setStyle(id: CalloutStyleId): void {
  calloutStyle = id;
  styleChips.forEach((b, k) => b.setAttribute('aria-pressed', String(k === id)));
  $('callout-desc').textContent = CALLOUT_STYLES.find((s) => s.id === id)?.description ?? '';
}
setStyle(calloutStyle);

const FIRE_KEYS: ReadonlyArray<{ kind: CalloutKind; key: string }> = [
  { kind: 'hit', key: 'H' },
  { kind: 'block', key: 'J' },
  { kind: 'counter', key: 'K' },
];
for (const f of FIRE_KEYS) chip($('callout-fire'), CALLOUT_WORDS[f.kind], f.key, false, () => stage.fire(f.kind));
for (const f of FIRE_KEYS) {
  const li = document.createElement('li');
  li.innerHTML = `<b>${CALLOUT_WORDS[f.kind]}</b> — ${CALLOUT_MEANING[f.kind]}`;
  $('callout-legend').appendChild(li);
}

// ---------------- camera ----------------
const viewChips = new Map<string, HTMLButtonElement>();
viewChips.set('overview', chip($('views'), 'Alta e fixa', 'V', true, () => setView('overview')));
viewChips.set('free', chip($('views'), 'Livre', 'V', false, () => setView('free')));
function setView(v: 'overview' | 'free'): void {
  stage.setView(v);
  viewChips.forEach((b, k) => b.setAttribute('aria-pressed', String(k === v)));
}

// ---------------- tuning panel ----------------
const rows = new Map<keyof Tuning, { input: HTMLInputElement; out: HTMLOutputElement; row: HTMLElement }>();
function fmt(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  return v.toFixed(decimals);
}
function buildTuning(): void {
  const host = $('tune-groups');
  const groups = new Map<TuningGroup, HTMLElement>();
  for (const spec of TUNING_SPEC) {
    let body = groups.get(spec.group);
    if (!body) {
      const details = document.createElement('details');
      details.className = 'tune-group';
      details.open = spec.group === 'dust' || spec.group === 'wind' || spec.group === 'swoosh';
      const summary = document.createElement('summary');
      summary.textContent = GROUP_TITLES[spec.group];
      body = document.createElement('div');
      body.className = 'tune-body';
      details.append(summary, body);
      host.appendChild(details);
      groups.set(spec.group, body);
    }
    const row = document.createElement('div');
    row.className = 'slider-row';
    const id = `tune-${spec.key}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = spec.label;
    const input = document.createElement('input');
    input.type = 'range';
    input.id = id;
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    const out = document.createElement('output');
    row.append(label, input, out);
    body.appendChild(row);
    input.addEventListener('input', () => {
      TUNING[spec.key] = Number(input.value);
      syncRow(spec.key);
      writeDraft();
    });
    rows.set(spec.key, { input, out, row });
  }
  TUNING_SPEC.forEach((s) => syncRow(s.key));
}
function syncRow(key: keyof Tuning): void {
  const r = rows.get(key);
  const spec = TUNING_SPEC.find((s) => s.key === key);
  if (!r || !spec) return;
  r.input.value = String(TUNING[key]);
  r.out.textContent = fmt(TUNING[key], spec.step);
  r.row.classList.toggle('changed', Math.abs(TUNING[key] - PROPOSED[key]) > 1e-9);
}
buildTuning();

$('tune-reset').addEventListener('click', () => {
  resetTuning();
  TUNING_SPEC.forEach((s) => syncRow(s.key));
  writeDraft();
  $('tune-status').textContent = 'Valores iniciais restaurados.';
});
$('tune-copy').addEventListener('click', async () => {
  const json = JSON.stringify(TUNING, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    $('tune-status').textContent = 'Valores copiados. Cole na conversa para registrar a configuração final.';
  } catch {
    $('tune-status').textContent = 'Não consegui copiar; veja o console.';
    console.info(json);
  }
});

// ---------------- keyboard ----------------
window.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  const effect = EFFECTS.find((e) => e.key1 === k);
  if (effect) return toggleEffect(effect.key);
  const styleIndex = ['7', '8', '9'].indexOf(k);
  if (styleIndex >= 0) return setStyle(CALLOUT_STYLES[styleIndex]!.id);
  switch (k) {
    case 'h': return stage.fire('hit');
    case 'j': return stage.fire('block');
    case 'k': return stage.fire('counter');
    case 'd': return toggleDashes();
    case ' ': ev.preventDefault(); return togglePause();
    case 's': return toggleSlow();
    case 'r': return stage.reset();
    case 'v': return setView(stage.viewMode === 'overview' ? 'free' : 'overview');
    case 'p': $('lab').classList.toggle('no-tuning'); return;
  }
});

// ---------------- HUD line ----------------
window.setInterval(() => {
  const s = stage.stats;
  $('hud').textContent = `t ${s.simTime.toFixed(1)} s · efeitos vivos ${s.live} · nuvens ${s.clouds}`;
}, HUD_REFRESH_MS);

declare global {
  interface Window { __flowLab?: { stage: FlowStage } }
}
window.__flowLab = { stage };
