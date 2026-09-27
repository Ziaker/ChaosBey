// ============================================================
// BEY MOTION LAB — ENTRY POINT
// Standalone visual exploration page. Isolated from the game: it imports
// nothing from src/ (the game values it mirrors are copied in tuning.ts)
// and changes no gameplay, physics, collider or stat. The models are the
// round-2 concepts of the Bey Lab, built by the same code.
// ============================================================

import { CONCEPTS } from '../../bey-visual-concepts/src/concepts/conceptDefinitions';
import type { ConceptDefinition } from '../../bey-visual-concepts/src/model/types';
import { MotionViewer, type CameraMode, type LayoutMode, type MotionMode, type MotionParams, type WobbleStyle } from './MotionViewer';
import { apparentSpin, RING_SYMMETRY } from './symmetry';
import { GAME_FRAME_HZ, GAME_SPIN_RATE_RAD_S, GAME_TOP_SPEED_MPS, GAME_DASH_SPEED_MPS, SPIN_PRESETS } from './tuning';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Bey motion lab: missing #${id}`);
  return node as T;
}

const viewer = new MotionViewer(el<HTMLCanvasElement>('lab-canvas'), el('stage'));
viewer.setParams({ spinRate: GAME_SPIN_RATE_RAD_S });

let primary: ConceptDefinition = CONCEPTS[0]!;
let secondary: ConceptDefinition = CONCEPTS[3]!;

function stageConcepts(): void {
  const { layout } = viewer.params;
  if (layout === 'grid') viewer.showConcepts(CONCEPTS);
  else if (layout === 'duel') viewer.showConcepts([primary, secondary]);
  else viewer.showConcepts([primary]);
  viewer.snapCamera();
  render();
}

function selectConcept(id: string, second = false): void {
  const concept = CONCEPTS.find((c) => c.id === id);
  if (!concept) return;
  if (second) secondary = concept;
  else primary = concept;
  history.replaceState(null, '', `#${primary.id}`);
  stageConcepts();
}

function setLayout(layout: LayoutMode): void {
  viewer.setParams({ layout });
  stageConcepts();
}

// ---- Panel ----

const picker = el('concept-picker');
CONCEPTS.forEach((c, i) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'concept-button';
  b.dataset.id = c.id;
  b.innerHTML = `<b>${c.archetype[0]!.toUpperCase()}${c.archetype.slice(1)} ${c.letter}<kbd>${i + 1}</kbd></b><span>${RING_SYMMETRY[c.id]?.feature ?? ''}</span>`;
  b.addEventListener('click', (e) => selectConcept(c.id, e.shiftKey && viewer.params.layout === 'duel'));
  picker.appendChild(b);
});

const spinPresets = el('spin-presets');
for (const preset of SPIN_PRESETS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.rate = String(preset.rate);
  b.textContent = `${preset.label} rad/s`;
  b.addEventListener('click', () => viewer.setParams({ spinRate: Math.sign(viewer.params.spinRate || 1) * preset.rate }));
  spinPresets.appendChild(b);
}

function bindSeg(id: string, attr: string, apply: (v: string) => void): void {
  el(id).querySelectorAll<HTMLButtonElement>(`button[data-${attr}]`).forEach((b) => b.addEventListener('click', () => apply(b.dataset[attr]!)));
}
bindSeg('layout-seg', 'layout', (v) => setLayout(v as LayoutMode));
bindSeg('wobble-seg', 'wobble', (v) => viewer.setParams({ wobbleStyle: v as WobbleStyle }));
bindSeg('motion-seg', 'motion', (v) => viewer.setParams({ motion: v as MotionMode }));
bindSeg('camera-seg', 'camera', (v) => viewer.setParams({ camera: v as CameraMode }));
bindSeg('time-seg', 'time', (v) => viewer.setParams({ timeScale: Number(v), paused: false }));
el('time-seg').querySelector<HTMLButtonElement>('button[data-pause]')!.addEventListener('click', () => viewer.setParams({ paused: !viewer.params.paused }));

const spinInput = el<HTMLInputElement>('spin');
spinInput.addEventListener('input', () => viewer.setParams({ spinRate: Math.sign(viewer.params.spinRate || 1) * Number(spinInput.value) }));
const tiltInput = el<HTMLInputElement>('tilt');
tiltInput.addEventListener('input', () => viewer.setParams({ tilt: (Number(tiltInput.value) * Math.PI) / 180 }));
const wobbleInput = el<HTMLInputElement>('wobble');
wobbleInput.addEventListener('input', () => viewer.setParams({ wobble: Number(wobbleInput.value) }));
const speedInput = el<HTMLInputElement>('speed');
speedInput.addEventListener('input', () => viewer.setParams({ speed: Number(speedInput.value) }));
el('reverse').addEventListener('click', () => viewer.setParams({ spinRate: -viewer.params.spinRate }));
el('spin-down').addEventListener('click', () => (viewer.isSpinningDown ? viewer.resetSpinDown() : viewer.startSpinDown()));
el('blur').addEventListener('click', () => viewer.setParams({ blur: !viewer.params.blur }));

// ---- Keyboard ----

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const digit = /^Digit([1-9])$/.exec(e.code);
  if (digit) {
    const c = CONCEPTS[Number(digit[1]) - 1];
    if (c) selectConcept(c.id, e.shiftKey && viewer.params.layout === 'duel');
    return;
  }
  const actions: Record<string, () => void> = {
    KeyQ: () => setLayout('solo'),
    KeyW: () => setLayout('duel'),
    KeyA: () => setLayout('grid'),
    KeyG: () => viewer.setParams({ camera: 'combat' }),
    KeyC: () => viewer.setParams({ camera: 'close' }),
    KeyT: () => viewer.setParams({ camera: 'top' }),
    KeyF: () => viewer.setParams({ camera: 'free' }),
    KeyM: () => viewer.setParams({ motion: viewer.params.motion === 'still' ? 'orbit' : 'still' }),
    KeyV: () => viewer.setParams({ spinRate: -viewer.params.spinRate }),
    KeyN: () => (viewer.isSpinningDown ? viewer.resetSpinDown() : viewer.startSpinDown()),
    KeyB: () => viewer.setParams({ blur: !viewer.params.blur }),
    KeyS: () => viewer.setParams({ timeScale: viewer.params.timeScale === 1 ? 0.25 : 1, paused: false }),
    Space: () => viewer.setParams({ paused: !viewer.params.paused }),
  };
  const action = actions[e.code];
  if (action) {
    e.preventDefault();
    action();
  }
});

// ---- Render panel state ----

function press(root: string, attr: string, value: string): void {
  el(root).querySelectorAll<HTMLButtonElement>(`button[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
}

function readoutFor(c: ConceptDefinition, rate: number): string {
  const sym = RING_SYMMETRY[c.id];
  if (!sym) return '';
  const a = apparentSpin(rate, sym.fold, GAME_FRAME_HZ);
  const cls = a.verdict.includes('FROZEN') || a.verdict.includes('BACKWARDS') || a.verdict.includes('not readable') ? 'bad' : a.verdict.includes('ambiguous') || a.verdict.includes('jumps') ? 'warn-t' : 'good';
  const apparent = a.apparentDegPerFrame === null ? '—' : `${a.apparentDegPerFrame.toFixed(1)}°`;
  let detail = '';
  if (sym.detail) {
    const d = apparentSpin(rate, sym.detail.fold, GAME_FRAME_HZ);
    const dCls = d.verdict.includes('FROZEN') || d.verdict.includes('BACKWARDS') ? 'bad' : d.verdict.includes('ambiguous') ? 'warn-t' : 'good';
    detail = `<br>&nbsp;└ ${sym.detail.feature}: <span class="${dCls}">${d.verdict}</span>`;
  }
  return `<div><b>${c.archetype} ${c.letter}</b> · ${sym.fold}-fold · seen ${apparent}/frame<br><span class="${cls}">${a.verdict}</span>${detail}</div>`;
}

function render(): void {
  const p = viewer.params;
  press('layout-seg', 'layout', p.layout);
  press('wobble-seg', 'wobble', p.wobbleStyle);
  press('motion-seg', 'motion', p.motion);
  press('camera-seg', 'camera', p.camera);
  press('time-seg', 'time', p.paused ? '' : String(p.timeScale));
  el('time-seg').querySelector('button[data-pause]')!.setAttribute('aria-pressed', String(p.paused));
  el('blur').setAttribute('aria-pressed', String(p.blur));
  el('spin-down').setAttribute('aria-pressed', String(viewer.isSpinningDown));
  press('spin-presets', 'rate', String(Math.abs(p.spinRate)));
  picker.querySelectorAll<HTMLButtonElement>('.concept-button').forEach((b) => {
    const id = b.dataset.id;
    b.setAttribute('aria-pressed', String(p.layout === 'grid' || id === primary.id));
    b.dataset.second = String(p.layout === 'duel' && id === secondary.id);
  });
  el('second-hint').textContent = p.layout === 'duel' ? `(1st ${primary.archetype} ${primary.letter} · 2nd ${secondary.archetype} ${secondary.letter})` : '';

  spinInput.value = String(Math.abs(p.spinRate));
  el('spin-out').textContent = `${Math.abs(p.spinRate).toFixed(0)} rad/s · ${((Math.abs(p.spinRate) / (2 * Math.PI)) * 60).toFixed(0)} rpm${p.spinRate < 0 ? ' · reversed' : ''}`;
  tiltInput.value = String(Math.round((p.tilt * 180) / Math.PI));
  el('tilt-out').textContent = `${Math.round((p.tilt * 180) / Math.PI)}°`;
  wobbleInput.value = String(p.wobble);
  el('wobble-out').textContent = `${p.wobble.toFixed(2)} (±${(6 * p.wobble).toFixed(1)}° @ 7 Hz)`;
  speedInput.value = String(p.speed);
  el('speed-out').textContent = `${p.speed.toFixed(1)} m/s${p.speed >= GAME_DASH_SPEED_MPS ? ' · Dash top' : p.speed >= GAME_TOP_SPEED_MPS ? ' · above normal top' : ''}`;

  const shown = p.layout === 'grid' ? CONCEPTS : p.layout === 'duel' ? [primary, secondary] : [primary];
  el('readout').innerHTML = shown.map((c) => readoutFor(c, viewer.effectiveSpinRate)).join('');
}

viewer.onChange(render);

// Live HUD (effective spin during spin-down, frame counter).
const hud = el('hud');
setInterval(() => {
  const rate = viewer.effectiveSpinRate;
  hud.innerHTML = `<b>${Math.abs(rate).toFixed(1)} rad/s</b> · ${((Math.abs(rate) * 180) / Math.PI / GAME_FRAME_HZ).toFixed(1)}°/frame @60 · wobble ${viewer.effectiveWobble.toFixed(2)}${viewer.isSpinningDown ? ' · spin-down' : ''}${viewer.params.paused ? ' · PAUSED' : ''}`;
  if (viewer.isSpinningDown) el('readout').innerHTML = (viewer.params.layout === 'grid' ? CONCEPTS : viewer.params.layout === 'duel' ? [primary, secondary] : [primary]).map((c) => readoutFor(c, rate)).join('');
}, 150);

// ---- Start ----

const initial = CONCEPTS.find((c) => c.id === location.hash.slice(1));
if (initial) primary = initial;
stageConcepts();

// Automation hook for screenshot/smoke scripts (not a gameplay API).
Object.assign(window, {
  __beyMotionLab: {
    ids: CONCEPTS.map((c) => c.id),
    select: (id: string, second = false) => selectConcept(id, second),
    layout: (layout: LayoutMode) => setLayout(layout),
    set: (patch: Partial<MotionParams>) => viewer.setParams(patch),
    spinDown: () => viewer.startSpinDown(),
    state: () => ({
      ...viewer.params,
      beys: viewer.beyCount,
      frames: viewer.frameCount,
      effectiveSpinRate: viewer.effectiveSpinRate,
      effectiveWobble: viewer.effectiveWobble,
      spinningDown: viewer.isSpinningDown,
      primary: primary.id,
      secondary: secondary.id,
    }),
  },
});
