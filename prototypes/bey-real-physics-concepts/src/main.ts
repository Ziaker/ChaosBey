// ============================================================
// BEY REAL LAB — PAGE
// Wires the stage (the game's arena, the Bey Flow FX effects), the keyboard (arrows = the stick, Z attack,
// X jump, C dodge), the HUD, the presets and the tuning panel to the RealSim. Everything here is lab UI;
// nothing reaches the game.
// ============================================================

import type { ArenaPresetId } from '../../../src/arena/presets/ArenaPresets';
import { CalloutLayer } from '../../bey-flow-fx-concepts/src/ui/callouts';
import type { FxFlags } from '../../bey-flow-fx-concepts/src/stage/FlowRig';
import { FlowStage, type ViewMode } from '../../bey-flow-fx-concepts/src/stage/FlowStage';
import { TUNING as FX_TUNING } from '../../bey-flow-fx-concepts/src/tuning';
import { floorHeight } from '../../bey-flow-fx-concepts/src/sim/FlowSim';
import { RealSim, type RealBey, type RealNote } from './sim/RealSim';
import { GROUP_TITLES, PARAMS, PARAM_SPEC, PRESETS, PROPOSED, applyParams, resetParams, type ParamGroup, type RealParams } from './tuning';
import * as THREE from 'three';

const DRAFT_KEY = 'chaosbey.realphysicslab.params.draft.v1';
const HUD_REFRESH_MS = 100;
const NEXT_ROUND_DELAY_S = 3.2;
const LOG_LINES = 6;
const RING_SEGMENTS = 160;
const RING_HALF_WIDTH_M = 0.1;
const RING_LIFT_M = 0.06;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

// ---------------- opponent modes ----------------
type OpponentId = 'ai' | 'demo' | 'dummy';
const OPPONENTS: ReadonlyArray<{ id: OpponentId; label: string; ai: readonly [boolean, boolean] }> = [
  { id: 'ai', label: 'IA', ai: [false, true] },
  { id: 'demo', label: 'Demo: dois automáticos', ai: [true, true] },
  { id: 'dummy', label: 'Só o automático (sem botões)', ai: [false, false] },
];
let opponent: OpponentId = 'ai';
let seed = 1;

const draft = readDraft();
if (draft) applyParams(draft);

function newSim(): RealSim {
  seed++;
  const mode = OPPONENTS.find((o) => o.id === opponent)!;
  return new RealSim({ seed, ai: mode.ai });
}

const stage = new FlowStage<RealSim>($<HTMLCanvasElement>('canvas'), $('stage'), {
  createSim: newSim,
  carryOver: () => {},
  chaseIndex: 0,
});
stage.setView('overview');
const callouts = new CalloutLayer($('callouts'));

stage.setEventHandler((e) => {
  const p = stage.project(e.x, e.z);
  callouts.spawn(e.kind, 'A', p.x, p.y, FX_TUNING.calloutScale, FX_TUNING.calloutLifeS, e.m);
});

// ---------------- the floor ring that marks the edge of the arena ----------------
let ringMesh: THREE.Mesh | null = null;
function buildRing(): void {
  if (ringMesh) {
    stage.scene.remove(ringMesh);
    ringMesh.geometry.dispose();
    (ringMesh.material as THREE.Material).dispose();
  }
  const R = PARAMS.stageRadiusM;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= RING_SEGMENTS; i++) {
    const a = (i / RING_SEGMENTS) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const r of [R - RING_HALF_WIDTH_M, R + RING_HALF_WIDTH_M]) pos.push(c * r, floorHeight(r) + RING_LIFT_M, s * r);
    if (i < RING_SEGMENTS) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  ringMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide, fog: false, toneMapped: false }));
  ringMesh.name = 'bey-real-edge-ring';
  ringMesh.renderOrder = 2;
  stage.scene.add(ringMesh);
}
buildRing();

// ---------------- HUD ----------------
interface Card {
  readonly root: HTMLElement;
  readonly spin: HTMLElement;
  readonly stab: HTMLElement;
  readonly charge: HTMLElement;
  readonly spinText: HTMLElement;
  readonly pips: Record<'dash' | 'dodge' | 'jump' | 'circ', HTMLElement>;
  readonly pipFill: Record<'dash' | 'dodge' | 'jump' | 'circ', HTMLElement>;
}
function bar(cls: string, label: string): { row: HTMLElement; fill: HTMLElement; text: HTMLElement } {
  const row = document.createElement('div');
  row.className = 'barlabel';
  const t = document.createElement('span');
  t.textContent = label;
  const b = document.createElement('div');
  b.className = `bar ${cls}`;
  const fill = document.createElement('i');
  b.appendChild(fill);
  row.append(t, b);
  return { row, fill, text: t };
}
function makeCard(kind: 'you' | 'cpu', name: string): Card {
  const root = document.createElement('div');
  root.className = `card ${kind}`;
  const title = document.createElement('div');
  title.className = 'name';
  const spinText = document.createElement('span');
  title.append(Object.assign(document.createElement('span'), { textContent: name }), spinText);
  const spin = bar('spin', 'GIRO');
  const stab = bar('stab', 'ESTAB');
  const charge = bar('charge', 'CARGA');
  const pipsRow = document.createElement('div');
  pipsRow.className = 'pips';
  const pips = {} as Card['pips'];
  const pipFill = {} as Card['pipFill'];
  for (const [id, label] of [['dash', 'DASH'], ['circ', 'GIRAT'], ['dodge', 'ESQ'], ['jump', 'PULO']] as const) {
    const pip = document.createElement('div');
    pip.className = 'pip';
    const f = document.createElement('i');
    const t = document.createElement('span');
    t.textContent = label;
    pip.append(f, t);
    pipsRow.appendChild(pip);
    pips[id] = pip;
    pipFill[id] = f;
  }
  root.append(title, spin.row, stab.row, charge.row, pipsRow);
  return { root, spin: spin.fill, stab: stab.fill, charge: charge.fill, spinText, pips, pipFill };
}
const hud = $('hud');
const cardYou = makeCard('you', 'VOCÊ');
const cardCpu = makeCard('cpu', 'OPONENTE');
const center = document.createElement('div');
center.className = 'center';
const banner = document.createElement('div');
banner.className = 'banner';
const bannerTitle = document.createElement('b');
const bannerSub = document.createElement('span');
banner.append(bannerTitle, bannerSub);
const logBox = document.createElement('div');
logBox.className = 'log';
hud.append(cardYou.root, cardCpu.root, center, banner, logBox);

function setPip(card: Card, id: 'dash' | 'dodge' | 'jump' | 'circ', cd: number, total: number, ready: boolean): void {
  card.pips[id].classList.toggle('ready', ready);
  card.pipFill[id].style.width = `${ready || total <= 0 ? 0 : Math.round(clamp01(1 - cd / total) * 100)}%`;
}
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

function fillCard(card: Card, b: RealBey, label: string): void {
  card.spin.style.width = `${Math.round(clamp01(b.spin) * 100)}%`;
  card.spin.style.setProperty('--fill', b.spin < PARAMS.wobbleSpin ? '#ff8a4d' : '#7dffa0');
  card.stab.style.width = `${Math.round(clamp01(b.stability / 100) * 100)}%`;
  card.stab.style.setProperty('--fill', b.broken ? '#ff4d6d' : '#6fd3ff');
  card.charge.style.width = `${Math.round(clamp01(b.charge) * 100)}%`;
  card.spinText.textContent = `${label}${b.broken ? ' · QUEBRADO' : ''}`;
  setPip(card, 'dash', b.dashCd, PARAMS.dashCooldownS, b.dashCd <= 0 && !b.broken);
  setPip(card, 'circ', b.circCd, PARAMS.circularDurationS + PARAMS.circularRecoveryS, b.circCd <= 0 && !b.broken);
  setPip(card, 'dodge', b.dodgeCd, PARAMS.dodgeCooldownS, b.dodgeCd <= 0 && !b.broken);
  setPip(card, 'jump', b.jumpCd, PARAMS.jumpCooldownS, b.jumpCd <= 0 && !b.airborne && !b.broken);
}

// ---------------- the log and the round ----------------
const score: [number, number] = [0, 0];
const LOG_TEXT: Partial<Record<RealNote['kind'], string>> = {
  jump: 'pulo',
  land: 'pouso',
  circular: 'giratório',
  dodge: 'esquiva',
  perfectDodge: 'ESQUIVA PERFEITA',
  counter: 'COUNTER!',
  broken: 'QUEBRADO',
  wall: 'parede',
};
const LOG_BIG: ReadonlySet<RealNote['kind']> = new Set(['perfectDodge', 'counter', 'broken']);
const lines: HTMLElement[] = [];
function log(text: string, who: 0 | 1 | null, big = false): void {
  const row = document.createElement('div');
  row.className = `${who === 0 ? 'you' : who === 1 ? 'cpu' : ''}${big ? ' big' : ''}`;
  row.textContent = text;
  logBox.appendChild(row);
  lines.push(row);
  while (lines.length > LOG_LINES) lines.shift()!.remove();
  window.setTimeout(() => {
    row.remove();
    const i = lines.indexOf(row);
    if (i >= 0) lines.splice(i, 1);
  }, 5000);
}

const REASON_TEXT: Record<string, string> = { ringout: 'RING OUT!', spinout: 'SPIN OUT!', ko: 'KO!', time: 'TEMPO!' };
let restartAt = -1;
stage.setNoteHandler((n) => {
  const note = n as RealNote;
  const who = note.side;
  if (note.kind === 'dash') return log(`dash (carga ${Math.round(note.m * 100)}%)`, who);
  if (note.kind === 'ringout' || note.kind === 'spinout' || note.kind === 'ko' || note.kind === 'time') {
    const sim = stage.sim;
    const w = sim.outcome.winner;
    if (w !== null) score[w]++;
    bannerTitle.textContent = REASON_TEXT[note.kind] ?? '';
    bannerSub.textContent = w === null ? 'Empate' : w === 0 ? 'Você venceu a rodada' : 'O oponente venceu a rodada';
    banner.classList.add('on');
    restartAt = performance.now() + (NEXT_ROUND_DELAY_S * 1000) / Math.max(0.1, stage.timeScale);
    return;
  }
  const text = LOG_TEXT[note.kind];
  if (text && note.kind !== 'land' && note.kind !== 'wall') log(text, who, LOG_BIG.has(note.kind));
});

function newRound(): void {
  banner.classList.remove('on');
  restartAt = -1;
  stage.reset();
}

// ---------------- chips ----------------
const pressedChips = new Map<string, HTMLButtonElement>();
function chip(parent: HTMLElement, label: string, key: string, pressed: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.setAttribute('aria-pressed', String(pressed));
  b.innerHTML = key ? `<kbd>${key}</kbd> ${label}` : label;
  b.addEventListener('click', onClick);
  parent.appendChild(b);
  return b;
}

const EFFECTS: ReadonlyArray<{ key: keyof FxFlags; label: string; key1: string }> = [
  { key: 'blur', label: 'Borrão de giro', key1: '1' },
  { key: 'lean', label: 'Inclinação', key1: '2' },
  { key: 'dust', label: 'Poeira anime', key1: '3' },
  { key: 'wind', label: 'Vento', key1: '4' },
  { key: 'crown', label: 'Argolas e coroas', key1: '5' },
  { key: 'shadow', label: 'Sombra', key1: '6' },
];
for (const fx of EFFECTS) {
  pressedChips.set(fx.key, chip($('effects'), fx.label, fx.key1, stage.flags[fx.key], () => toggleEffect(fx.key)));
}
function toggleEffect(key: keyof FxFlags): void {
  stage.flags[key] = !stage.flags[key];
  pressedChips.get(key)?.setAttribute('aria-pressed', String(stage.flags[key]));
}

// presets
const presetChips = new Map<string, HTMLButtonElement>();
let activePreset = 'real';
for (const preset of PRESETS) {
  presetChips.set(preset.id, chip($('presets'), preset.label, '', preset.id === activePreset, () => choosePreset(preset.id)));
}
function choosePreset(id: string): void {
  const preset = PRESETS.find((p) => p.id === id)!;
  activePreset = id;
  resetParams();
  applyParams(preset.values);
  PARAM_SPEC.forEach((s) => syncRow(s.key));
  writeDraft();
  buildRing();
  presetChips.forEach((b, k) => b.setAttribute('aria-pressed', String(k === id)));
  $('preset-desc').textContent = preset.description;
}
$('preset-desc').textContent = PRESETS[0]!.description;

// opponent
const opponentChips = new Map<OpponentId, HTMLButtonElement>();
for (const o of OPPONENTS) opponentChips.set(o.id, chip($('opponents'), o.label, '', o.id === opponent, () => setOpponent(o.id)));
function setOpponent(id: OpponentId): void {
  opponent = id;
  opponentChips.forEach((b, k) => b.setAttribute('aria-pressed', String(k === id)));
  score[0] = 0;
  score[1] = 0;
  newRound();
}

// camera and arena
const VIEWS: ReadonlyArray<{ id: ViewMode; label: string }> = [
  { id: 'overview', label: 'Alta e fixa' },
  { id: 'game', label: 'Do jogo (Arena Fighter)' },
  { id: 'chase', label: 'Perseguição' },
  { id: 'free', label: 'Livre' },
];
const viewChips = new Map<ViewMode, HTMLButtonElement>();
VIEWS.forEach((v) => viewChips.set(v.id, chip($('views'), v.label, '', v.id === stage.viewMode, () => setView(v.id))));
function setView(v: ViewMode): void {
  stage.setView(v);
  viewChips.forEach((b, k) => b.setAttribute('aria-pressed', String(k === v)));
}
const ARENAS: ReadonlyArray<{ id: ArenaPresetId; label: string }> = [
  { id: 'foundry', label: 'Foundry Pit' },
  { id: 'rift', label: 'Rift Crater' },
  { id: 'tournament', label: 'Tournament Stadium' },
];
const arenaChips = new Map<ArenaPresetId, HTMLButtonElement>();
ARENAS.forEach((a) => arenaChips.set(a.id, chip($('arenas'), a.label, '', a.id === stage.arenaPreset, () => setArena(a.id))));
function setArena(id: ArenaPresetId): void {
  stage.setArena(id);
  arenaChips.forEach((b, k) => b.setAttribute('aria-pressed', String(k === id)));
}

// scene buttons
const pauseChip = chip($('scene-buttons'), 'Pausar', 'Espaço', false, () => togglePause());
const slowChip = chip($('scene-buttons'), 'Câmera lenta', 'S', false, () => toggleSlow());
chip($('scene-buttons'), 'Nova rodada', 'R', false, () => newRound());
function togglePause(): void {
  stage.paused = !stage.paused;
  pauseChip.setAttribute('aria-pressed', String(stage.paused));
}
let slow = false;
function applySpeed(): void {
  const base = Number($<HTMLInputElement>('speed').value);
  stage.timeScale = slow ? base * 0.25 : base;
}
function toggleSlow(): void {
  slow = !slow;
  slowChip.setAttribute('aria-pressed', String(slow));
  applySpeed();
}
$<HTMLInputElement>('speed').addEventListener('input', () => {
  $('speed-out').textContent = `${Number($<HTMLInputElement>('speed').value).toFixed(1)}x`;
  applySpeed();
});

// ---------------- tuning panel ----------------
function readDraft(): Partial<RealParams> | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Partial<RealParams>) : null;
  } catch {
    return null;
  }
}
function writeDraft(): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(PARAMS));
  } catch {
    /* storage unavailable: the draft just isn't remembered */
  }
}
const rows = new Map<keyof RealParams, { input: HTMLInputElement; out: HTMLOutputElement; row: HTMLElement }>();
function fmt(v: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
  return v.toFixed(decimals);
}
function buildTuning(): void {
  const host = $('tune-groups');
  const groups = new Map<ParamGroup, HTMLElement>();
  for (const spec of PARAM_SPEC) {
    let body = groups.get(spec.group);
    if (!body) {
      const details = document.createElement('details');
      details.className = 'tune-group';
      details.open = spec.group === 'control' || spec.group === 'physics';
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
      PARAMS[spec.key] = Number(input.value);
      syncRow(spec.key);
      writeDraft();
      if (spec.key === 'stageRadiusM') buildRing();
    });
    rows.set(spec.key, { input, out, row });
  }
  PARAM_SPEC.forEach((s) => syncRow(s.key));
}
function syncRow(key: keyof RealParams): void {
  const r = rows.get(key);
  const spec = PARAM_SPEC.find((s) => s.key === key);
  if (!r || !spec) return;
  r.input.value = String(PARAMS[key]);
  r.out.textContent = fmt(PARAMS[key], spec.step);
  r.row.classList.toggle('changed', Math.abs(PARAMS[key] - PROPOSED[key]) > 1e-9);
}
buildTuning();
$('tune-reset').addEventListener('click', () => choosePreset('real'));
$('tune-copy').addEventListener('click', async () => {
  const json = JSON.stringify(PARAMS, null, 2);
  try {
    await navigator.clipboard.writeText(json);
    $('tune-status').textContent = 'Valores copiados. Cole na conversa para registrar a configuração.';
  } catch {
    $('tune-status').textContent = 'Não consegui copiar; veja o console.';
    console.info(json);
  }
});

// ---------------- keyboard: arrows = the stick, Z / X / C = the actions ----------------
const held = new Set<string>();
const forward = { x: 0, z: -1 };
function pushInput(): void {
  const sim = stage.sim;
  let up = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);
  let right = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
  stage.screenForward(forward);
  // "Up the screen" is the camera's forward axis on the floor; right is a quarter turn clockwise from above.
  let sx = forward.x * up + -forward.z * right;
  let sz = forward.z * up + forward.x * right;
  const m = Math.hypot(sx, sz);
  if (m > 1) {
    sx /= m;
    sz /= m;
  }
  up = 0;
  right = 0;
  sim.setInput(0, { stickX: sx, stickZ: sz, attackHeld: held.has('KeyZ') });
}
window.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  if (ev.code.startsWith('Arrow') || ev.code === 'Space') ev.preventDefault();
  if (!ev.repeat) {
    if (ev.code === 'KeyX') stage.sim.pressJump(0);
    else if (ev.code === 'KeyC') stage.sim.pressDodge(0);
  }
  held.add(ev.code);
  if (ev.repeat) return;
  const k = ev.key.toLowerCase();
  const effect = EFFECTS.find((e) => e.key1 === k);
  if (effect) return toggleEffect(effect.key);
  switch (k) {
    case ' ':
      return togglePause();
    case 's':
      return toggleSlow();
    case 'r':
      return newRound();
    case 'v':
      return setView(VIEWS[(VIEWS.findIndex((x) => x.id === stage.viewMode) + 1) % VIEWS.length]!.id);
    case 'p':
      $('lab').classList.toggle('no-tuning');
  }
});
window.addEventListener('keyup', (ev) => held.delete(ev.code));
window.addEventListener('blur', () => held.clear());

// ---------------- per-frame page work ----------------
function frame(): void {
  pushInput();
  if (restartAt > 0 && performance.now() >= restartAt) newRound();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.setInterval(() => {
  const sim = stage.sim;
  const [a, b] = sim.beys;
  fillCard(cardYou, a, opponent === 'demo' ? 'AUTOMÁTICO' : `${Math.round(PARAMS.influence * 100)}% SEU`);
  fillCard(cardCpu, b, opponent === 'dummy' ? 'AUTOMÁTICO' : opponent === 'demo' ? 'AUTOMÁTICO' : 'IA');
  const left = PARAMS.timeLimitS > 0 ? ` · ${Math.max(0, PARAMS.timeLimitS - sim.time).toFixed(0)} s` : '';
  center.innerHTML = `${score[0]} × ${score[1]}<small>t ${sim.time.toFixed(0)} s${left}</small>`;
  $('hud-line').textContent = `vel ${a.speed.toFixed(1)} m/s · giro ${(a.spin * 100).toFixed(0)}% · estabilidade ${a.stability.toFixed(0)} · efeitos vivos ${stage.stats.live}`;
}, HUD_REFRESH_MS);

declare global {
  interface Window {
    __realLab?: { stage: FlowStage<RealSim>; score: [number, number]; press: (code: string, down: boolean) => void };
  }
}
window.__realLab = {
  stage,
  score,
  press: (code, down) => {
    if (down) {
      if (code === 'KeyX') stage.sim.pressJump(0);
      if (code === 'KeyC') stage.sim.pressDodge(0);
      held.add(code);
    } else held.delete(code);
  },
};
