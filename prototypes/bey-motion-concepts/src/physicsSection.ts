// ============================================================
// BEY MOTION LAB — MOTION PHYSICS SECTION (panel wiring)
// Presets A/B/C, live parameter sliders (value shown, changed ones
// highlighted, reset to the selected preset, copy as JSON to record an
// approval), reproducible scenarios, game replays, transport, cameras,
// debug overlays and a live readout.
// ============================================================

import { CONCEPTS } from '../../bey-visual-concepts/src/concepts/conceptDefinitions';
import type { ConceptDefinition } from '../../bey-visual-concepts/src/model/types';
import { PARAM_SPECS, PRESETS, presetParams, type PhysicsParams, type PresetId } from './physics/params';
import { PhysicsViewer, type DebugFlags, type PhysicsCamera, type Replay } from './physics/PhysicsViewer';
import { SCENARIOS } from './physics/scenarios';
import replayExt0 from './replays/m7-ext-0.json';
import replayExt32 from './replays/m7-ext-32.json';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Bey motion lab: missing #${id}`);
  return node as T;
}

const REPLAYS: ReadonlyArray<{ id: string; replay: Replay }> = [
  { id: 'replay-ext-0', replay: replayExt0 as unknown as Replay },
  { id: 'replay-ext-32', replay: replayExt32 as unknown as Replay },
];

let presetId: PresetId = 'B';
let params: PhysicsParams = presetParams(presetId);
let beyConcepts: ConceptDefinition[] = [CONCEPTS[0]!, CONCEPTS[3]!];
let current = SCENARIOS[0]!.id;

export const physics = new PhysicsViewer(el<HTMLCanvasElement>('phys-canvas'), el('stage'), params, beyConcepts);

// ---- Presets + parameters ----

const groups = el('param-groups');
const sliderRefs = new Map<keyof PhysicsParams, { input: HTMLInputElement; out: HTMLOutputElement; label: HTMLLabelElement }>();
const groupEls = new Map<string, HTMLElement>();
for (const spec of PARAM_SPECS) {
  let group = groupEls.get(spec.group);
  if (!group) {
    const details = document.createElement('details');
    details.className = 'params';
    details.open = spec.group === 'Tilt / lean' || spec.group === 'Impacts / bounce';
    details.innerHTML = `<summary>${spec.group}</summary>`;
    groups.appendChild(details);
    groupEls.set(spec.group, details);
    group = details;
  }
  const label = document.createElement('label');
  label.className = 'slider';
  label.title = spec.help;
  label.innerHTML = `${spec.label} <output></output><input type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" data-param="${spec.key}" />`;
  group.appendChild(label);
  const input = label.querySelector('input')!;
  const out = label.querySelector('output')!;
  input.addEventListener('input', () => {
    params = { ...params, [spec.key]: Number(input.value) };
    physics.setParams(params);
    render();
  });
  sliderRefs.set(spec.key, { input, out, label });
}

function modifiedKeys(): Array<keyof PhysicsParams> {
  const base = presetParams(presetId);
  return PARAM_SPECS.map((s) => s.key).filter((k) => Math.abs(base[k] - params[k]) > 1e-9);
}

function selectPreset(id: PresetId): void {
  presetId = id;
  params = presetParams(id);
  physics.setParams(params);
  restart();
}

// ---- Scenarios / replays ----

const scenarioList = el('scenario-list');
for (const s of SCENARIOS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.scenario = s.id;
  b.textContent = s.label;
  b.addEventListener('click', () => playScenario(s.id));
  scenarioList.appendChild(b);
}
const replayList = el('replay-list');
for (const r of REPLAYS) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'replay';
  b.dataset.scenario = r.id;
  b.textContent = r.replay.title;
  b.addEventListener('click', () => playScenario(r.id));
  replayList.appendChild(b);
}

function playScenario(id: string): void {
  current = id;
  const replay = REPLAYS.find((r) => r.id === id);
  if (replay) physics.playReplay(replay.replay);
  else physics.playScenario(SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0]!);
  physics.snapCamera();
  timeline.max = String(physics.duration);
  renderMoments();
  render();
}

function restart(): void {
  playScenario(current);
}

// ---- Beys ----

for (const [i, id] of [['0', 'bey1-select'], ['1', 'bey2-select']] as const) {
  const select = el<HTMLSelectElement>(id);
  for (const c of CONCEPTS) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.archetype[0]!.toUpperCase()}${c.archetype.slice(1)} ${c.letter} — ${c.headline}`;
    select.appendChild(o);
  }
  select.value = beyConcepts[Number(i)]!.id;
  select.addEventListener('change', () => {
    beyConcepts = [...beyConcepts];
    beyConcepts[Number(i)] = CONCEPTS.find((c) => c.id === select.value)!;
    physics.setConcepts(beyConcepts);
    restart();
  });
}

// ---- Transport, camera, debug ----

el('restart').addEventListener('click', restart);
el('ppause').addEventListener('click', () => {
  physics.paused = !physics.paused;
  render();
});
el('pstep').addEventListener('click', () => {
  physics.paused = true;
  physics.step();
  render();
});
const timeline = el<HTMLInputElement>('timeline');
let scrubbing = false;
timeline.addEventListener('pointerdown', () => (scrubbing = true));
timeline.addEventListener('pointerup', () => (scrubbing = false));
timeline.addEventListener('input', () => physics.seek(Number(timeline.value)));

function renderMoments(): void {
  const box = el('moments');
  box.innerHTML = '';
  for (const m of physics.replayMoments()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${m.t.toFixed(2)} s — ${m.label}`;
    b.addEventListener('click', () => physics.seek(Math.max(0, m.t - 0.5)));
    box.appendChild(b);
  }
}

el('ptime-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
  b.addEventListener('click', () => {
    physics.timeScale = Number(b.dataset.ptime);
    render();
  }),
);
el('pcam-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => physics.setCamera(b.dataset.pcam as PhysicsCamera)));
el('follow-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
  b.addEventListener('click', () => {
    physics.followIndex = Number(b.dataset.follow);
    physics.setCamera('follow');
  }),
);
el('debug-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
  b.addEventListener('click', () => {
    const k = b.dataset.debug as keyof DebugFlags;
    physics.debug[k] = !physics.debug[k];
    render();
  }),
);
el('preset-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => selectPreset(b.dataset.preset as PresetId)));
el('reset-params').addEventListener('click', () => selectPreset(presetId));
el('copy-params').addEventListener('click', () => {
  const record = { lab: 'bey-motion-lab', preset: presetId, modified: modifiedKeys(), params };
  const text = JSON.stringify(record, null, 2);
  const pre = el('params-json');
  pre.textContent = text;
  pre.style.display = 'block';
  navigator.clipboard?.writeText(text).catch(() => undefined);
});

export function physicsKey(e: KeyboardEvent): boolean {
  const map: Record<string, () => void> = {
    KeyA: () => selectPreset('A'),
    KeyB: () => selectPreset('B'),
    KeyC: () => selectPreset('C'),
    KeyR: restart,
    Space: () => {
      physics.paused = !physics.paused;
    },
    Period: () => {
      physics.paused = true;
      physics.step();
    },
    KeyG: () => physics.setCamera('combat'),
    KeyF: () => physics.setCamera('follow'),
    KeyT: () => physics.setCamera('top'),
    KeyV: () => physics.setCamera('side'),
    KeyO: () => physics.setCamera('free'),
    BracketRight: () => cycle(1),
    BracketLeft: () => cycle(-1),
  };
  const action = map[e.code];
  if (!action) return false;
  action();
  render();
  return true;
}

function cycle(d: number): void {
  const ids = [...SCENARIOS.map((s) => s.id), ...REPLAYS.map((r) => r.id)];
  const i = ids.indexOf(current);
  playScenario(ids[(i + d + ids.length) % ids.length]!);
}

// ---- Render ----

const fmt = (n: number, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const deg = (r: number) => (Number.isFinite(r) ? `${((r * 180) / Math.PI).toFixed(1)}°` : '—');

function press(root: string, attr: string, value: string): void {
  el(root).querySelectorAll<HTMLButtonElement>(`button[data-${attr}]`).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === value)));
}

export function render(): void {
  press('preset-seg', 'preset', physics.replay ? '' : presetId);
  press('pcam-seg', 'pcam', physics.cameraMode);
  press('follow-seg', 'follow', physics.cameraMode === 'follow' ? String(physics.followIndex) : '');
  press('ptime-seg', 'ptime', String(physics.timeScale));
  el('ppause').setAttribute('aria-pressed', String(physics.paused));
  el('debug-seg').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(physics.debug[b.dataset.debug as keyof DebugFlags])));
  document.querySelectorAll<HTMLButtonElement>('#scenario-list button, #replay-list button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scenario === current)));
  const preset = PRESETS.find((p) => p.id === presetId)!;
  el('preset-summary').textContent = `${preset.id} — ${preset.name}: ${preset.summary}`;
  const scenario = SCENARIOS.find((s) => s.id === current);
  const replay = REPLAYS.find((r) => r.id === current)?.replay;
  el('scenario-desc').textContent = replay
    ? `REPLAY of the game's own simulation (seed ${replay.seed}, ${replay.beys.join(' vs ')}, outcome ${replay.outcome}). Presets and sliders do not apply to a replay: it shows what the game does today. Events: ${replay.events.slice(0, 6).map((e) => `${e.t}s ${e.kind}${e.bey !== undefined ? ` (Bey ${e.bey + 1})` : ''}`).join(', ')}${replay.events.length > 6 ? ', …' : ''}`
    : (scenario?.description ?? '');

  const mods = modifiedKeys();
  el('modified-count').textContent = mods.length ? `(${mods.length} changed from ${presetId})` : `(= preset ${presetId})`;
  for (const spec of PARAM_SPECS) {
    const ref = sliderRefs.get(spec.key)!;
    ref.input.value = String(params[spec.key]);
    ref.out.textContent = `${params[spec.key]} ${spec.unit}`;
    ref.label.classList.toggle('changed', mods.includes(spec.key));
  }
}

function renderReadout(): void {
  if (document.documentElement.dataset.tab !== 'physics') return;
  const rows = physics.readouts();
  const names = ['Bey 1', 'Bey 2'];
  const line = (label: string, get: (i: number) => string) => `<tr><td>${label}</td>${rows.map((_, i) => `<td>${get(i)}</td>`).join('')}</tr>`;
  el('phys-readout').innerHTML = `<table class="ro"><tr><td></td>${rows.map((_, i) => `<td><b>${names[i]}</b></td>`).join('')}</tr>${[
    line('speed', (i) => `${fmt(rows[i]!.speed, 1)} m/s`),
    line('heading vs velocity', (i) => deg(rows[i]!.slipAngle)),
    line('tilt', (i) => deg(rows[i]!.tilt)),
    line('tilt rate', (i) => `${fmt(rows[i]!.tiltRate)} rad/s`),
    line('whirl', (i) => `${fmt(rows[i]!.whirl)} rad/s`),
    line('spin', (i) => `${fmt(rows[i]!.spinRate, 1)} rad/s`),
    line('wobble', (i) => fmt(rows[i]!.wobble)),
    line('grip', (i) => `${fmt(rows[i]!.grip)}${rows[i]!.slipping ? ' SLIP' : ''}`),
    line('recovery torque', (i) => fmt(rows[i]!.recoveryTorque)),
    line('height', (i) => `${fmt(rows[i]!.height)} m${rows[i]!.grounded ? '' : ' AIR'}`),
    line('state', (i) => [rows[i]!.tumbling && 'TUMBLE', rows[i]!.scraping && 'WALL', rows[i]!.ringOut && 'RING-OUT', rows[i]!.state].filter(Boolean).join(' ') || '—'),
  ].join('')}</table>`;
  if (!scrubbing) timeline.value = String(physics.time);
  el('timeline-out').textContent = `${physics.time.toFixed(2)} / ${physics.duration.toFixed(1)} s`;
  el('phys-hud').innerHTML = `<b>${physics.replay ? 'GAME REPLAY' : `Preset ${presetId}${modifiedKeys().length ? '*' : ''}`}</b> · t = ${physics.time.toFixed(2)} / ${physics.duration.toFixed(1)} s${physics.paused ? ' · PAUSED' : ''}${physics.timeScale !== 1 ? ` · ${physics.timeScale}×` : ''}`;
}
setInterval(renderReadout, 100);
physics.onChange(render);

export function startPhysics(): void {
  playScenario(current);
}

// Automation hook (window.__beyMotionLab.physics), not a gameplay API.
export const physicsHook = {
  scenarios: () => [...SCENARIOS.map((s) => s.id), ...REPLAYS.map((r) => r.id)],
  play: (id: string) => playScenario(id),
  preset: (id: PresetId) => selectPreset(id),
  setParam: (key: keyof PhysicsParams, value: number) => {
    params = { ...params, [key]: value };
    physics.setParams(params);
    render();
  },
  camera: (mode: PhysicsCamera) => physics.setCamera(mode),
  seek: (t: number) => physics.seek(t),
  moments: () => physics.replayMoments(),
  state: () => ({
    scenario: current,
    preset: presetId,
    modified: modifiedKeys(),
    time: physics.time,
    duration: physics.duration,
    frames: physics.frameCount,
    camera: physics.cameraMode,
    replay: physics.replay !== null,
    readouts: physics.readouts(),
  }),
};
