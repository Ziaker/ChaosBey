// ============================================================
// RAIL COURSE LAB — PAGE
// Wires the stage, the course ideas, the parameter sliders and the readouts. Everything here is lab UI; nothing reaches the
// game. The owner picks (or edits) a course shape; the game's rails are not changed until that choice is made.
// ============================================================

import { ARENA_PRESETS, type ArenaPresetId } from '../../../src/arena/presets/ArenaPresets';
import { DEFAULT_ARENA_FLOOR, MATCH_BOWL_DEPTH_DEFAULT_M, type ArenaFloor } from '../../../src/arena/floor/ArenaFloorProfile';
import { ARENA_FLOOR_RADIUS } from '../../../src/arena/colliders/ArenaTuning';
import { courseMetrics, RAIL_COURSE_IDEAS, type RailCourseIdea, type RailCourseParams } from '../../../src/arena/rails/RailCourse';
import { RAIL_TUNING } from '../../../src/arena/rails/RailTraversal';
import { labRails, MAX_LAB_RAILS, PARAM_SPECS } from './labRails';
import { LabStage, VIEW_MODES, type ViewMode } from './stage/LabStage';

const DRAFT_KEY = 'chaosbey.railcourselab.draft.v1';
const HUD_REFRESH_MS = 200;
const FLOOR: ArenaFloor = { id: DEFAULT_ARENA_FLOOR, depthM: MATCH_BOWL_DEPTH_DEFAULT_M };
/** A wall must be cleared by at least this much (m) for the route not to look like it runs through it. */
const WALL_CLEARANCE_OK_M = 0.5;

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const VIEW_LABEL: Record<ViewMode, string> = { overview: 'Geral', top: 'De cima', ride: 'Seguir o Bey', free: 'Livre' };

interface Draft {
  idea: RailCourseIdea['id'];
  params: RailCourseParams;
  railCount: number;
  stage: ArenaPresetId;
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Draft) : null;
  } catch {
    return null;
  }
}
function writeDraft(d: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* storage unavailable: the draft just isn't remembered */
  }
}

const saved = readDraft();
let ideaId: RailCourseIdea['id'] = saved?.idea && RAIL_COURSE_IDEAS.some((i) => i.id === saved.idea) ? saved.idea : 'A';
let params: RailCourseParams = { ...RAIL_COURSE_IDEAS.find((i) => i.id === ideaId)!.params, ...(saved?.params ?? {}) };
let railCount = Math.min(MAX_LAB_RAILS, Math.max(1, saved?.railCount ?? 2));
let stageId: ArenaPresetId = saved?.stage && ARENA_PRESETS.some((p) => p.id === saved.stage) ? saved.stage : 'foundry';

const preset = (): (typeof ARENA_PRESETS)[number] => ARENA_PRESETS.find((p) => p.id === stageId)!;
const stage = new LabStage($<HTMLCanvasElement>('canvas'), $('stage-host'), FLOOR, ARENA_FLOOR_RADIUS, stageId);

// ---------------- ideas ----------------
const ideaButtons = new Map<string, HTMLButtonElement>();
for (const [i, idea] of RAIL_COURSE_IDEAS.entries()) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'idea';
  b.innerHTML = `<b><kbd>${i + 1}</kbd> ${idea.id} — ${idea.name}</b><span>${idea.note}</span>`;
  b.addEventListener('click', () => selectIdea(idea.id));
  $('ideas').appendChild(b);
  ideaButtons.set(idea.id, b);
}

// ---------------- stage select ----------------
const stageSelect = $<HTMLSelectElement>('stage');
for (const p of ARENA_PRESETS) {
  const o = document.createElement('option');
  o.value = p.id;
  o.textContent = `${p.label} — parede de ${p.geometry.wallHeightM} m`;
  stageSelect.appendChild(o);
}
stageSelect.value = stageId;
stageSelect.addEventListener('change', () => {
  stageId = stageSelect.value as ArenaPresetId;
  stage.setArena(stageId);
  refresh();
});

// ---------------- rail count ----------------
const countChips: HTMLButtonElement[] = [];
for (let n = 1; n <= MAX_LAB_RAILS; n++) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = String(n);
  b.addEventListener('click', () => {
    railCount = n;
    refresh();
  });
  $('rail-count').appendChild(b);
  countChips.push(b);
}

// ---------------- views and ride options ----------------
const viewChips = new Map<ViewMode, HTMLButtonElement>();
for (const v of VIEW_MODES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = VIEW_LABEL[v];
  b.addEventListener('click', () => setView(v));
  $('views').appendChild(b);
  viewChips.set(v, b);
}
function setView(v: ViewMode): void {
  stage.setView(v);
  for (const [k, b] of viewChips) b.setAttribute('aria-pressed', String(k === v));
}
const rideOpts = $('ride-opts');
function optChip(label: string, key: string, get: () => boolean, set: (v: boolean) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.innerHTML = `<kbd>${key}</kbd> ${label}`;
  b.setAttribute('aria-pressed', String(get()));
  b.addEventListener('click', () => {
    set(!get());
    b.setAttribute('aria-pressed', String(get()));
  });
  rideOpts.appendChild(b);
  return b;
}
const pingChip = optChip('Ida e volta', 'T', () => stage.pingPong, (v) => (stage.pingPong = v));
const gateChip = optChip('Mostrar entradas', 'G', () => stage.gatesVisible, (v) => stage.setGatesVisible(v));
const pauseChip = optChip('Pausado', 'P', () => stage.paused, (v) => (stage.paused = v));
const restartBtn = document.createElement('button');
restartBtn.type = 'button';
restartBtn.className = 'chip';
restartBtn.innerHTML = '<kbd>R</kbd> Reiniciar passeio';
restartBtn.addEventListener('click', () => stage.restart());
rideOpts.appendChild(restartBtn);
const jumpBtn = document.createElement('button');
jumpBtn.type = 'button';
jumpBtn.className = 'chip';
jumpBtn.innerHTML = '<kbd>Espaço</kbd> Pular';
jumpBtn.addEventListener('click', () => stage.jump());
rideOpts.appendChild(jumpBtn);

// ---------------- sliders ----------------
const sliderRows = new Map<keyof RailCourseParams, { input: HTMLInputElement; out: HTMLOutputElement; row: HTMLElement }>();
for (const spec of PARAM_SPECS) {
  const row = document.createElement('div');
  row.className = 'slider-row';
  const label = document.createElement('label');
  label.textContent = spec.label;
  label.htmlFor = `p-${spec.key}`;
  const input = document.createElement('input');
  input.type = 'range';
  input.id = `p-${spec.key}`;
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  const out = document.createElement('output');
  input.addEventListener('input', () => {
    params = { ...params, [spec.key]: Number(input.value) };
    refresh();
  });
  row.append(label, input, out);
  $('sliders').appendChild(row);
  sliderRows.set(spec.key, { input, out, row });
}

function fmt(spec: (typeof PARAM_SPECS)[number], v: number): string {
  const decimals = spec.step < 0.1 ? 2 : spec.step < 1 ? 1 : 0;
  return `${v.toFixed(decimals)}${spec.unit}`;
}

function selectIdea(id: RailCourseIdea['id']): void {
  ideaId = id;
  const idea = RAIL_COURSE_IDEAS.find((i) => i.id === id)!;
  params = { ...idea.params };
  railCount = idea.suggestedRails;
  refresh();
  stage.restart();
}

$('reset').addEventListener('click', () => selectIdea(ideaId));
$('copy').addEventListener('click', () => {
  const json = JSON.stringify({ idea: ideaId, stage: stageId, railCount, params }, null, 2);
  $<HTMLTextAreaElement>('json').value = json;
  const done = (msg: string): void => {
    $('status').textContent = msg;
  };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(json).then(() => done('Formato copiado.'), () => done('Não deu para copiar: copie o texto abaixo.'));
  else done('Copie o texto abaixo.');
});

// ---------------- refresh ----------------
let lastRailsKey = '';
function refresh(): void {
  const key = JSON.stringify([params, railCount]);
  for (const [id, b] of ideaButtons) b.setAttribute('aria-pressed', String(id === ideaId));
  countChips.forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === railCount)));
  const base = RAIL_COURSE_IDEAS.find((i) => i.id === ideaId)!.params;
  for (const spec of PARAM_SPECS) {
    const r = sliderRows.get(spec.key)!;
    const v = params[spec.key];
    r.input.value = String(v);
    r.out.textContent = fmt(spec, v);
    r.row.classList.toggle('changed', v !== base[spec.key]);
  }
  if (key !== lastRailsKey) {
    lastRailsKey = key;
    stage.setRails(labRails(params, railCount, FLOOR, ARENA_FLOOR_RADIUS));
    stage.restart();
  }
  renderMetrics();
  writeDraft({ idea: ideaId, params, railCount, stage: stageId });
}

function renderMetrics(): void {
  const rails = labRails(params, 1, FLOOR, ARENA_FLOOR_RADIUS);
  const m = courseMetrics(rails[0]!, { floor: FLOOR, floorRadiusM: ARENA_FLOOR_RADIUS, wallHeightM: preset().geometry.wallHeightM });
  const clearanceOk = m.wallClearanceM === null || m.wallClearanceM >= WALL_CLEARANCE_OK_M;
  const rows: Array<[string, string, boolean]> = [
    ['Comprimento', `${m.lengthM.toFixed(0)} m`, false],
    ['Tempo de passeio', `${m.rideTimeS.toFixed(1)} s`, false],
    ['Parte fora da arena', `${(m.outsideShare * 100).toFixed(0)} %`, m.outsideShare < 0.3],
    ['Ponto mais longe do centro', `${m.maxRadiusM.toFixed(0)} m`, false],
    ['Altura (mín – máx)', `${m.lowestM.toFixed(1)} – ${m.highestM.toFixed(1)} m`, false],
    ['Folga sobre a parede', m.wallClearanceM === null ? '—' : `${m.wallClearanceM.toFixed(1)} m`, !clearanceOk],
    ['Vezes que cruza a parede', String(m.wallCrossings), m.wallCrossings !== 2],
    ['Entrada → saída (em linha reta)', `${m.gateSeparationM.toFixed(0)} m`, false],
  ];
  $('readouts').innerHTML = rows.map(([k, v, bad]) => `<dt>${k}</dt><dd class="${bad ? 'bad' : ''}">${v}</dd>`).join('');
  const notes: Array<[string, boolean]> = [];
  notes.push([`Cada entrada é um anel dourado de ${RAIL_TUNING.captureRadiusM} m de raio: o Bey entra pulando em direção a ele, como já é hoje.`, false]);
  notes.push([`O passeio dura ${m.rideTimeS.toFixed(1)} s com o Bey a até ${RAIL_TUNING.targetSpeedMps} m/s; ele fica intocável e fora da arena durante todo esse tempo.`, false]);
  if (!clearanceOk) notes.push(['O percurso passa rente à parede (ou dentro dela): aumente a altura do trecho de fora.', true]);
  if (m.wallCrossings !== 2) notes.push([`O percurso cruza a parede ${m.wallCrossings}×; o normal é 2 (sai e volta).`, true]);
  if (m.outsideShare < 0.3) notes.push(['Menos de 30% do percurso fica fora da arena: aumente a distância do trecho de fora.', true]);
  if (m.gateSeparationM < 8) notes.push(['As duas entradas ficam muito perto: o Bey volta quase onde saiu.', false]);
  $('notes').innerHTML = notes.map(([t, bad]) => `<li class="${bad ? 'bad' : ''}">${t}</li>`).join('');
}

// ---------------- overlay (live) ----------------
function renderOverlay(): void {
  const ride = stage.ride;
  if (!ride) return;
  const phase =
    ride.phase === 'riding' ? 'no rail' : ride.phase === 'returning' ? 'VOLTANDO pelo mesmo caminho' : ride.phase === 'flying' ? 'no ar' : 'parado no chão';
  const where = ride.phase === 'riding' || ride.phase === 'returning' ? (ride.insideWall ? 'dentro da parede' : 'FORA da arena') : '';
  const end =
    ride.lastEnd === 'end' ? 'saiu no fim do rail' : ride.lastEnd === 'jump-inside' ? 'pulou dentro da parede: voltou à arena' : ride.lastEnd === 'jump-outside-back' ? 'pulou fora: voltou pelo mesmo caminho' : '';
  $('overlay').innerHTML = `<b>${VIEW_LABEL[stage.viewMode]}</b> · ${preset().label} · ideia ${ideaId}<br>${phase} ${where} · ${ride.speedMps.toFixed(0)} m/s${end ? `<br>${end}` : ''}`;
}

// ---------------- keys ----------------
addEventListener('keydown', (e) => {
  // Letters and digits still work with a slider focused (it only uses the arrows); not while typing in a field or choosing in a list.
  if ((e.target instanceof HTMLInputElement && e.target.type !== 'range') || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= String(RAIL_COURSE_IDEAS.length)) selectIdea(RAIL_COURSE_IDEAS[Number(k) - 1]!.id);
  else if (k === 'v') setView(VIEW_MODES[(VIEW_MODES.indexOf(stage.viewMode) + 1) % VIEW_MODES.length]!);
  else if (k === ' ') {
    e.preventDefault();
    stage.jump();
  } else if (k === 'r') stage.restart();
  else if (k === 'p') {
    stage.paused = !stage.paused;
    pauseChip.setAttribute('aria-pressed', String(stage.paused));
  } else if (k === 't') {
    stage.pingPong = !stage.pingPong;
    pingChip.setAttribute('aria-pressed', String(stage.pingPong));
  } else if (k === 'g') {
    stage.setGatesVisible(!stage.gatesVisible);
    gateChip.setAttribute('aria-pressed', String(stage.gatesVisible));
  }
});

setView('overview');
refresh();
setInterval(renderOverlay, HUD_REFRESH_MS);

// A hook for the smoke test.
declare global {
  interface Window {
    __railLab: { ideas: string[]; state(): { idea: string; stage: string; railCount: number; view: string; phase: string | null; lengthM: number } };
  }
}
window.__railLab = {
  ideas: RAIL_COURSE_IDEAS.map((i) => i.id),
  state: () => ({
    idea: ideaId,
    stage: stageId,
    railCount,
    view: stage.viewMode,
    phase: stage.ride?.phase ?? null,
    lengthM: labRails(params, 1, FLOOR, ARENA_FLOOR_RADIUS)[0]!.path.lengthM,
  }),
};
