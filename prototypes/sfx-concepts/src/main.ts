// ============================================================
// SFX LAB — PAGE (wiring only)
// Builds the event list, keeps the owner's per-event choices (saved in the
// browser when possible), auditions A/B/C/SEM SOM, plays the context
// sequences and the real live match, and shows what the mix played or
// dropped. Audio starts on the first click (browsers require a gesture).
// ============================================================

import { ALL_BEY_ARCHETYPES } from '../../../src/bey/archetype/BeyArchetypes';
import type { BeyDefinition } from '../../../src/bey/archetype/BeyDefinition';
import { RoundOutcome } from '../../../src/combat/round-rules/RoundState';
import { BUSES, CATEGORIES, EVENTS, eventById, eventsInCategory, type BusId, type SfxEvent } from './catalog';
import { DIRECTIONS, DIRECTION_IDS, type DirectionId } from './directions';
import { measureAll, type Measurement } from './engine/measure';
import { NOMINAL_LENGTH_S } from './engine/recipes';
import { SfxEngine, type SfxLogEntry } from './engine/SfxEngine';
import { LiveMatch } from './live/LiveMatch';
import { SEQUENCES, loopStateAt, sequenceById, type Sequence } from './sequences';
import { effectiveChoice, exportDecisions, loadSettings, saveSettings, summarize, withChoice, type Choice, type LabSettings } from './selection';
import { ArenaView } from './ui/ArenaView';

declare global {
  interface Window {
    __sfxLab: SfxLabApi;
  }
}

interface SfxLabApi {
  state(): { ready: boolean; audio: string; choices: Record<string, Choice | null>; preview: DirectionId; live: boolean; liveTicks: number; sequence: string | null; played: number; dropped: Record<string, number>; logSize: number; loops: string[] };
  choose(eventId: string, choice: Choice | null): void;
  audition(eventId: string, direction: DirectionId, magnitude?: number): Promise<boolean>;
  playSequence(id: string): Promise<void>;
  stopAll(): void;
  startLive(seed?: string): Promise<void>;
  stopLive(): void;
  measureAll(): Promise<Measurement[]>;
  /** Newest first: what was requested, and whether it played, was dropped by the mix or silenced by SEM SOM. */
  log(): { eventId: string; direction: DirectionId; played: boolean; reason?: string; silent: boolean }[];
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let settings: LabSettings = loadSettings(safeStorage());
let engine: SfxEngine | null = null;
let focusedEventId: string = EVENTS[0]!.id;
const rowMagnitude = new Map<string, number>();
const logItems: (SfxLogEntry & { readonly silent: boolean })[] = [];

function persist(): void {
  saveSettings(safeStorage(), settings);
}

async function ensureEngine(): Promise<SfxEngine> {
  if (!engine) {
    engine = new SfxEngine();
    engine.setMasterVolume(settings.masterVolume);
    for (const bus of BUSES) engine.setBusVolume(bus.id, settings.busVolumes[bus.id]);
    engine.onLog(onLog);
  }
  await engine.resume();
  return engine;
}

function setStatus(text: string): void {
  $('status').textContent = text;
}

// ------------------------------------------------------------ left panel ---

function renderDirections(): void {
  const root = $('directions');
  root.replaceChildren(
    ...DIRECTION_IDS.map((id) => {
      const d = DIRECTIONS[id];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'preset';
      button.dataset.id = id;
      button.setAttribute('aria-pressed', String(settings.preview === id));
      button.innerHTML = `<strong>${id}</strong><span><b>${d.name}</b> — ${d.tagline}<small>${d.description}</small></span>`;
      button.addEventListener('click', () => {
        settings = { ...settings, preview: id };
        persist();
        renderDirections();
        renderEvents();
        setStatus(`Pré-escuta: ${id} — ${d.name}`);
      });
      return button;
    }),
  );
}

function renderVolumes(): void {
  const rows: { id: 'master' | BusId; label: string; value: number }[] = [{ id: 'master', label: 'Geral', value: settings.masterVolume }, ...BUSES.map((b) => ({ id: b.id, label: b.label, value: settings.busVolumes[b.id] }))];
  $('volumes').replaceChildren(
    ...rows.map((row) => {
      const wrap = document.createElement('label');
      wrap.className = 'vol';
      const text = document.createElement('span');
      text.textContent = row.label;
      const out = document.createElement('output');
      out.textContent = `${Math.round(row.value * 100)}%`;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '1';
      input.step = '0.01';
      input.value = String(row.value);
      input.id = `vol-${row.id}`;
      input.addEventListener('input', () => {
        const value = Number(input.value);
        out.textContent = `${Math.round(value * 100)}%`;
        if (row.id === 'master') {
          settings = { ...settings, masterVolume: value };
          engine?.setMasterVolume(value);
        } else {
          settings = { ...settings, busVolumes: { ...settings.busVolumes, [row.id]: value } };
          engine?.setBusVolume(row.id, value);
        }
        persist();
      });
      wrap.append(text, out, input);
      return wrap;
    }),
  );
}

function renderSequences(): void {
  $('sequences').replaceChildren(
    ...SEQUENCES.map((sequence) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'scenario';
      button.dataset.id = sequence.id;
      button.setAttribute('aria-pressed', String(playingSequence?.id === sequence.id));
      button.innerHTML = `<span>▶ ${sequence.label}</span><small>${sequence.description}</small>`;
      button.addEventListener('click', () => void (playingSequence?.id === sequence.id ? stopSequence() : playSequence(sequence.id)));
      return button;
    }),
  );
}

function renderSummary(): void {
  const summary = summarize(settings);
  const labels: Record<string, string> = { A: 'A', B: 'B', C: 'C', none: 'SEM SOM', pending: 'pendente' };
  $('counts').replaceChildren(
    ...(['A', 'B', 'C', 'none', 'pending'] as const).map((k) => {
      const div = document.createElement('div');
      div.className = 'count';
      div.dataset.k = k;
      div.innerHTML = `${summary.counts[k]}<small>${labels[k]}</small>`;
      return div;
    }),
  );
}

// ------------------------------------------------------------ event rows ---

function magnitudeLabel(event: SfxEvent, m: number, index: number): string {
  if (event.kind === 'loop') return ['início', 'meio', 'fim'][index] ?? String(m);
  if (event.auditionMagnitudes.length === 2) return ['fraco', 'forte'][index]!;
  return ['fraco', 'médio', 'forte'][index] ?? String(m);
}

function renderEventRow(event: SfxEvent): HTMLElement {
  const row = document.createElement('div');
  row.className = 'event';
  row.dataset.id = event.id;
  row.tabIndex = 0;
  if (event.id === focusedEventId) row.classList.add('focused');
  row.addEventListener('focus', () => setFocus(event.id, false));
  row.addEventListener('click', () => setFocus(event.id, false));

  const choice = settings.choices[event.id] ?? null;
  const head = document.createElement('div');
  head.className = 'ev-head';
  head.innerHTML = `<strong>${event.label}</strong>`;
  const tag = document.createElement('span');
  tag.className = `tag ${choice ? `decided-${choice}` : 'pending'}`;
  tag.textContent = choice ? (choice === 'none' ? 'SEM SOM' : `escolhido ${choice}`) : `pendente · pré-escuta ${settings.preview}`;
  head.append(tag);
  if (event.kind === 'loop') head.insertAdjacentHTML('beforeend', '<span class="tag">contínuo</span>');
  if (event.perSide) head.insertAdjacentHTML('beforeend', '<span class="tag">por Bey</span>');

  const trigger = document.createElement('p');
  trigger.className = 'ev-trigger';
  trigger.textContent = event.trigger;
  const source = document.createElement('p');
  source.className = 'ev-source';
  source.textContent = event.source;

  const controls = document.createElement('div');
  controls.className = 'ev-controls';
  const pick = document.createElement('div');
  pick.className = 'group';
  pick.setAttribute('role', 'group');
  pick.setAttribute('aria-label', `Escolha para ${event.label}`);
  pick.insertAdjacentHTML('beforeend', '<span class="group-label">escolha</span>');
  for (const c of ['A', 'B', 'C', 'none'] as const) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pick-btn';
    b.dataset.choice = c;
    b.textContent = c === 'none' ? 'SEM SOM' : c;
    b.setAttribute('aria-pressed', String(choice === c));
    b.title = c === 'none' ? 'Este evento não terá som' : `Escolher a direção ${c} (${DIRECTIONS[c].name}) para este evento`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      choose(event.id, choice === c ? null : c);
      if (c !== 'none') void audition(event.id, c);
    });
    pick.append(b);
  }
  const play = document.createElement('div');
  play.className = 'group';
  play.insertAdjacentHTML('beforeend', '<span class="group-label">ouvir</span>');
  for (const d of DIRECTION_IDS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'play-btn';
    b.dataset.dir = d;
    b.textContent = `▶ ${d}`;
    b.title = `Tocar a opção ${d} (${DIRECTIONS[d].name})`;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setFocus(event.id, false);
      void audition(event.id, d);
    });
    play.append(b);
  }
  const cycle = document.createElement('button');
  cycle.type = 'button';
  cycle.className = 'cycle-btn';
  cycle.textContent = 'A→B→C';
  cycle.title = 'Tocar A, depois B, depois C (Q)';
  cycle.addEventListener('click', (e) => {
    e.stopPropagation();
    setFocus(event.id, false);
    void cycleAbc(event.id);
  });
  play.append(cycle);
  controls.append(pick, play);

  if (event.auditionMagnitudes.length > 1) {
    const mags = document.createElement('div');
    mags.className = 'group';
    mags.insertAdjacentHTML('beforeend', `<span class="group-label">${event.kind === 'loop' ? 'estado' : 'força'}</span>`);
    const current = rowMagnitude.get(event.id) ?? event.auditionMagnitudes[event.auditionMagnitudes.length - 1]!;
    event.auditionMagnitudes.forEach((m, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mag-btn';
      b.textContent = magnitudeLabel(event, m, i);
      b.setAttribute('aria-pressed', String(current === m));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        rowMagnitude.set(event.id, m);
        refreshRow(event.id);
        void audition(event.id, effectiveDirection(event.id) ?? settings.preview, m);
      });
      mags.append(b);
    });
    controls.append(mags);
  }

  row.append(head, trigger, source, controls);
  if (event.silenceNote) {
    const note = document.createElement('p');
    note.className = 'ev-note';
    note.textContent = `SEM SOM? ${event.silenceNote}`;
    row.append(note);
  }
  return row;
}

function renderEvents(): void {
  $('events').replaceChildren(
    ...CATEGORIES.map((category) => {
      const section = document.createElement('section');
      section.className = 'category';
      section.dataset.category = category.id;
      section.innerHTML = `<h2>${category.label} <small>${category.hint}</small></h2>`;
      const rows = document.createElement('div');
      rows.className = 'rows';
      rows.append(...eventsInCategory(category.id).map(renderEventRow));
      section.append(rows);
      return section;
    }),
  );
}

function refreshRow(eventId: string): void {
  const old = document.querySelector<HTMLElement>(`.event[data-id="${eventId}"]`);
  if (!old) return;
  const fresh = renderEventRow(eventById(eventId));
  old.replaceWith(fresh);
}

function setFocus(eventId: string, scroll: boolean): void {
  focusedEventId = eventId;
  document.querySelectorAll('.event.focused').forEach((el) => el.classList.remove('focused'));
  const row = document.querySelector<HTMLElement>(`.event[data-id="${eventId}"]`);
  row?.classList.add('focused');
  if (scroll) {
    row?.scrollIntoView({ block: 'nearest' });
    row?.focus({ preventScroll: true });
  }
}

function choose(eventId: string, choice: Choice | null): void {
  settings = withChoice(settings, eventId, choice);
  persist();
  refreshRow(eventId);
  renderSummary();
  const label = eventById(eventId).label;
  setStatus(choice ? `${label}: ${choice === 'none' ? 'SEM SOM' : `direção ${choice}`}` : `${label}: pendente`);
}

/** The direction that plays for an event right now, or null for SEM SOM. */
function effectiveDirection(eventId: string): DirectionId | null {
  const c = effectiveChoice(settings, eventId);
  return c === 'none' ? null : c;
}

// ------------------------------------------------------------ audition ---

let auditionToken = 0;

async function audition(eventId: string, direction: DirectionId, magnitude?: number): Promise<boolean> {
  const e = await ensureEngine();
  const event = eventById(eventId);
  const m = magnitude ?? rowMagnitude.get(eventId) ?? event.auditionMagnitudes[event.auditionMagnitudes.length - 1]!;
  flashPlay(eventId, direction);
  if (event.kind === 'oneShot') return e.trigger(eventId, { direction, magnitude: m, force: true });
  // Loops: a short demo that moves through the state instead of a static tone.
  const token = ++auditionToken;
  const key = `audition:${eventId}`;
  const [from, to] = loopDemoRange(eventId, m);
  const start = performance.now();
  const durationMs = 2600;
  await new Promise<void>((resolve) => {
    const frame = () => {
      if (token !== auditionToken) return resolve();
      const k = Math.min(1, (performance.now() - start) / durationMs);
      const level = k < 0.08 ? k / 0.08 : k > 0.9 ? (1 - k) / 0.1 : 1;
      e.setLoop(eventId, key, direction, level, from + (to - from) * k, { aux: eventId === 'spinHum' ? Math.max(0, 1 - m) * 0.6 : 0.3, archetypeId: 'attack-prototype' });
      if (k < 1) requestAnimationFrame(frame);
      else {
        e.stopLoops(key);
        resolve();
      }
    };
    requestAnimationFrame(frame);
  });
  return true;
}

function loopDemoRange(eventId: string, m: number): [number, number] {
  if (eventId === 'dashCharge' || eventId === 'clashTension') return [Math.max(0, m - 0.5), Math.min(1, m + 0.5)];
  return [m, Math.max(0.05, m * 0.8)];
}

function flashPlay(eventId: string, direction: DirectionId): void {
  const button = document.querySelector<HTMLElement>(`.event[data-id="${eventId}"] .play-btn[data-dir="${direction}"]`);
  if (!button) return;
  button.classList.add('playing');
  setTimeout(() => button.classList.remove('playing'), 350);
}

async function cycleAbc(eventId: string): Promise<void> {
  const event = eventById(eventId);
  const gapMs = event.kind === 'loop' ? 2900 : ((NOMINAL_LENGTH_S[eventId] ?? 0.5) + 0.45) * 1000;
  const token = ++auditionToken;
  for (const d of DIRECTION_IDS) {
    if (token !== auditionToken && event.kind === 'oneShot') return;
    const playing = audition(eventId, d);
    setStatus(`${event.label}: ${d} — ${DIRECTIONS[d].name}`);
    if (event.kind === 'loop') await playing;
    else await new Promise((r) => setTimeout(r, gapMs));
  }
}

// ------------------------------------------------------------ sequences ---

let playingSequence: Sequence | null = null;
let sequenceTimers: ReturnType<typeof setTimeout>[] = [];
let sequenceRaf = 0;

async function playSequence(id: string): Promise<void> {
  stopLive();
  stopSequence();
  const e = await ensureEngine();
  const sequence = sequenceById(id);
  playingSequence = sequence;
  renderSequences();
  setStatus(`Sequência: ${sequence.label}`);
  for (const step of sequence.steps) {
    sequenceTimers.push(
      setTimeout(() => {
        const direction = effectiveDirection(step.eventId);
        if (!direction) {
          onLog({ t: e.ctx.currentTime, eventId: step.eventId, direction: settings.preview, magnitude: step.magnitude ?? 1, side: step.side, played: false, stolen: 0 }, true);
          return;
        }
        e.trigger(step.eventId, { direction, magnitude: step.magnitude ?? 1, side: step.side, pan: step.pan });
      }, step.atS * 1000),
    );
  }
  const start = performance.now();
  const activeKeys = new Set<string>();
  const frame = () => {
    if (playingSequence !== sequence) return;
    const t = (performance.now() - start) / 1000;
    const state = loopStateAt(sequence, t);
    for (const key of activeKeys) if (!state.has(key)) e.setLoop('spinHum', `seq:${key}`, null, 0, 0);
    activeKeys.clear();
    for (const [key, s] of state) {
      activeKeys.add(key);
      e.setLoop(s.eventId, `seq:${key}`, effectiveDirection(s.eventId), s.level, s.param, { pan: s.pan, aux: s.aux, archetypeId: s.archetypeId });
    }
    if (t < sequence.durationS) sequenceRaf = requestAnimationFrame(frame);
    else stopSequence();
  };
  sequenceRaf = requestAnimationFrame(frame);
  await new Promise((r) => setTimeout(r, sequence.durationS * 1000 + 50));
}

function stopSequence(): void {
  for (const t of sequenceTimers) clearTimeout(t);
  sequenceTimers = [];
  cancelAnimationFrame(sequenceRaf);
  engine?.stopLoops('seq:');
  if (playingSequence) {
    playingSequence = null;
    renderSequences();
  }
}

// ------------------------------------------------------------ live match ---

const MATCHUPS: readonly { id: string; first: BeyDefinition; second: BeyDefinition }[] = ALL_BEY_ARCHETYPES.flatMap((a) => ALL_BEY_ARCHETYPES.map((b) => ({ id: `${a.id}|${b.id}`, first: a, second: b })));
const COLORS: Record<string, string> = { 'attack-prototype': '#ff5c5c', 'defense-prototype': '#4f8cff', 'stamina-prototype': '#4fffb0' };
const shortName = (d: BeyDefinition) => d.id.replace('-prototype', '').replace(/^./, (c) => c.toUpperCase());

let live: LiveMatch | null = null;
let liveRaf = 0;
let liveGeneration = 0;
let liveSeedCounter = 0;
let autoChain = true;
/** Distance attenuation on the opponent's sounds (see deriveSfx.distanceGain). */
let distanceOn = true;
let lastFrame: ReturnType<LiveMatch['step']> | null = null;
const arena = new ArenaView($('arena') as HTMLCanvasElement, { first: '#ff5c5c', second: '#4f8cff' });

function renderMatchups(): void {
  const select = $('matchup') as HTMLSelectElement;
  select.replaceChildren(
    ...MATCHUPS.map((m) => {
      const option = document.createElement('option');
      option.value = m.id;
      option.textContent = `${shortName(m.first)} × ${shortName(m.second)}`;
      return option;
    }),
  );
  select.value = 'attack-prototype|defense-prototype';
}

async function startLive(seed?: string): Promise<void> {
  stopSequence();
  stopLive();
  const e = await ensureEngine();
  const generation = ++liveGeneration;
  const matchup = MATCHUPS.find((m) => m.id === ($('matchup') as HTMLSelectElement).value) ?? MATCHUPS[0]!;
  const matchSeed = seed ?? `sfx-lab-${Date.now().toString(36)}-${liveSeedCounter++}`;
  const match = await LiveMatch.create(matchSeed, matchup.first, matchup.second);
  if (generation !== liveGeneration) {
    match.dispose();
    return;
  }
  live = match;
  arena.setColors({ first: COLORS[matchup.first.id] ?? '#ff5c5c', second: COLORS[matchup.second.id] ?? '#4f8cff' });
  $('live-toggle').setAttribute('aria-pressed', 'true');
  setStatus(`Luta ao vivo: ${shortName(matchup.first)} × ${shortName(matchup.second)} (seed ${matchSeed})`);
  let accumulator = 0;
  let previous = performance.now();
  let endedAt: number | null = null;
  const frame = () => {
    if (generation !== liveGeneration || !live) return;
    const now = performance.now();
    accumulator = Math.min(accumulator + (now - previous) / 1000, 4 / 60);
    previous = now;
    while (accumulator >= 1 / 60 && live) {
      accumulator -= 1 / 60;
      if (endedAt !== null && now - endedAt > 600) break; // let the result stinger breathe
      const f = live.step();
      lastFrame = f;
      for (const t of f.output.triggers) {
        const direction = effectiveDirection(t.eventId);
        const event = eventById(t.eventId);
        if (!direction) {
          onLog({ t: e.ctx.currentTime, eventId: t.eventId, direction: settings.preview, magnitude: t.magnitude, side: t.side, played: false, stolen: 0 }, true);
          continue;
        }
        const played = e.trigger(t.eventId, { direction, magnitude: t.magnitude, side: t.side, pan: t.pan, delayS: t.delayS, gain: distanceOn ? t.gain : 1 });
        if (played) {
          const where = t.side ? f.positions[t.side] : { x: (f.positions.first.x + f.positions.second.x) / 2, y: 0, z: (f.positions.first.z + f.positions.second.z) / 2 };
          arena.flash(where, event.category, event.mix.priority >= 8, now);
        }
      }
      for (const loop of f.output.loops) {
        const archetypeId = loop.side === 'first' ? live.firstDefinition.id : loop.side === 'second' ? live.secondDefinition.id : undefined;
        e.setLoop(loop.eventId, `live:${loop.key}`, effectiveDirection(loop.eventId), loop.level, loop.param, { pan: loop.pan, aux: loop.aux, gain: distanceOn ? loop.gain : 1, archetypeId });
      }
      if (f.outcome !== RoundOutcome.Ongoing && endedAt === null) endedAt = now;
    }
    if (lastFrame) arena.draw(lastFrame.positions, { clashActive: lastFrame.clashActive, broken: lastFrame.broken, label: `tick ${lastFrame.tick}${lastFrame.clashActive ? ' · CLASH' : ''}${lastFrame.outcome !== RoundOutcome.Ongoing ? ` · ${lastFrame.outcome}` : ''}` }, now);
    if (endedAt !== null && now - endedAt > 3200) {
      if (autoChain) void startLive();
      else stopLive();
      return;
    }
    liveRaf = requestAnimationFrame(frame);
  };
  liveRaf = requestAnimationFrame(frame);
}

function stopLive(): void {
  liveGeneration++;
  cancelAnimationFrame(liveRaf);
  engine?.stopLoops('live:');
  live?.dispose();
  live = null;
  $('live-toggle').setAttribute('aria-pressed', 'false');
}

// ------------------------------------------------------------ log & mix ---

const REASONS: Record<string, string> = { gate: 'fraco demais', cooldown: 'repetido (cooldown)', budget: 'mix cheio' };

function onLog(entry: SfxLogEntry, silent = false): void {
  logItems.unshift({ ...entry, silent });
  if (logItems.length > 400) logItems.pop();
  const li = document.createElement('li');
  li.className = silent ? 'silent' : entry.played ? 'played' : 'dropped';
  const time = document.createElement('span');
  time.textContent = entry.t.toFixed(2);
  const dir = document.createElement('span');
  dir.className = `d ${entry.direction}`;
  dir.textContent = silent ? '·' : entry.direction;
  const name = document.createElement('span');
  const event = eventById(entry.eventId);
  name.textContent = `${event.label}${event.scalesWithMagnitude ? ` ${Math.round(entry.magnitude * 100)}%` : ''}${entry.side ? ` (${entry.side === 'first' ? 'P1' : 'P2'})` : ''}`;
  const why = document.createElement('span');
  why.className = 'why';
  why.textContent = silent ? 'SEM SOM' : entry.played ? (entry.stolen ? `cortou ${entry.stolen}` : '') : (REASONS[entry.reason ?? ''] ?? '');
  li.append(time, dir, name, why);
  const log = $('log');
  log.prepend(li);
  while (log.children.length > 60) log.lastElementChild?.remove();
}

function renderMix(): void {
  if (!engine) {
    $('mix').textContent = 'Áudio parado. Clique em qualquer ▶ para começar.';
    return;
  }
  const s = engine.getStats();
  const loops = engine.activeLoopKeys().filter((k) => !k.startsWith('audition:'));
  $('mix').textContent = [
    `tocados ${s.played} · cortados por repetição ${s.stolen}`,
    `descartados: fracos ${s.dropped.gate} · cooldown ${s.dropped.cooldown} · mix cheio ${s.dropped.budget}`,
    `vozes agora ${s.activeVoices} · ducking ${s.duckDb.toFixed(1)} dB`,
    `contínuos ativos ${loops.length}${loops.length ? `: ${[...new Set(loops.map((k) => k.split(':').slice(-2).join(':')))].slice(0, 6).join(', ')}` : ''}`,
  ].join('\n');
}

// ------------------------------------------------------------ export ---

async function copyDecisions(): Promise<void> {
  const text = exportDecisions(settings);
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Escolhas copiadas (JSON).');
  } catch {
    setStatus('Não foi possível copiar; use Baixar JSON.');
  }
}

function downloadDecisions(): void {
  const blob = new Blob([exportDecisions(settings)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'chaosbey-sfx-decisions.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  setStatus('JSON baixado.');
}

function clearDecisions(): void {
  if (!confirm('Limpar todas as escolhas deste Lab?')) return;
  for (const event of EVENTS) settings = withChoice(settings, event.id, null);
  persist();
  renderEvents();
  renderSummary();
  setStatus('Escolhas limpas: tudo pendente.');
}

function stopAll(): void {
  auditionToken++;
  stopSequence();
  stopLive();
  engine?.silence();
  setStatus('Silêncio.');
}

// ------------------------------------------------------------ keyboard ---

function onKey(event: KeyboardEvent): void {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  const key = event.key;
  const index = EVENTS.findIndex((e) => e.id === focusedEventId);
  if (key === '1' || key === '2' || key === '3') {
    const c = (['A', 'B', 'C'] as const)[Number(key) - 1]!;
    choose(focusedEventId, c);
    void audition(focusedEventId, c);
  } else if (key === '0') choose(focusedEventId, 'none');
  else if (key === 'Enter' || key === ' ') {
    if (event.target instanceof HTMLButtonElement) return;
    event.preventDefault();
    const d = effectiveDirection(focusedEventId);
    if (d) void audition(focusedEventId, d);
  } else if (key === 'q' || key === 'Q') void cycleAbc(focusedEventId);
  else if (key === 'ArrowDown' || key === 'ArrowUp') {
    event.preventDefault();
    const next = EVENTS[Math.max(0, Math.min(EVENTS.length - 1, index + (key === 'ArrowDown' ? 1 : -1)))]!;
    setFocus(next.id, true);
  } else if (key === 'l' || key === 'L') void (live ? stopLive() : startLive());
  else if (key === 'Escape') stopAll();
}

// ------------------------------------------------------------ boot ---

renderDirections();
renderVolumes();
renderSequences();
renderSummary();
renderEvents();
renderMatchups();
renderMix();
arena.draw(null, { clashActive: false, broken: { first: false, second: false }, label: 'Ouvir luta para começar' }, performance.now());
setInterval(renderMix, 250);

$('copy').addEventListener('click', () => void copyDecisions());
$('download').addEventListener('click', downloadDecisions);
$('clear').addEventListener('click', clearDecisions);
$('live-toggle').addEventListener('click', () => void (live ? stopLive() : startLive()));
$('live-next').addEventListener('click', () => void startLive());
$('live-auto').addEventListener('click', () => {
  autoChain = !autoChain;
  $('live-auto').setAttribute('aria-pressed', String(autoChain));
});
$('live-distance').addEventListener('click', () => {
  distanceOn = !distanceOn;
  $('live-distance').setAttribute('aria-pressed', String(distanceOn));
  setStatus(distanceOn ? 'Distância ligada: o oponente longe soa mais baixo.' : 'Distância desligada: tudo no mesmo plano.');
});
$('matchup').addEventListener('change', () => {
  if (live) void startLive();
});
window.addEventListener('keydown', onKey);

window.__sfxLab = {
  state: () => ({
    ready: true,
    audio: engine?.ctx.state ?? 'none',
    choices: { ...settings.choices },
    preview: settings.preview,
    live: live !== null,
    liveTicks: live?.ticks ?? 0,
    sequence: playingSequence?.id ?? null,
    played: engine?.getStats().played ?? 0,
    dropped: { ...(engine?.getStats().dropped ?? {}) },
    logSize: logItems.length,
    loops: engine?.activeLoopKeys() ?? [],
  }),
  choose,
  audition,
  playSequence,
  stopAll,
  startLive,
  stopLive,
  measureAll,
  log: () => logItems.map((e) => ({ eventId: e.eventId, direction: e.direction, played: e.played, reason: e.reason, silent: e.silent })),
};
