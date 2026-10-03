// ============================================================
// PREGAME SIMULATOR (M10, GDD 56/59)
// The match setup between Character Select and the fight. Common choices
// first (opponent Bey, AI level, AI style, arena, match length); the
// selected sliders and experimental rules behind "Advanced rules" (wall
// height, wall bounce, Clash impact, fixed seed). The right
// column explains, from the real numbers, what the chosen opponent can do
// and how the matchup looks. Keyboard: ↑/↓ row, ←/→ change, Enter start,
// Esc back.
// ============================================================

import { RING_OUT_DELAY_RANGE } from '../../arena/ringout/RingOutTuning';
import { DASH_COOLDOWN_RANGE } from '../../combat/attacks/AttackTuning';
import {
  BODY_COLLISION_DAMAGE_RANGE,
  MOMENTUM_DECAY_RANGE,
  MOMENTUM_FILL_RANGE,
  MOMENTUM_GAIN_RANGE,
  MOMENTUM_LOSS_ON_COLLISION_RANGE,
} from '../../bey/momentum/MomentumTuning';
import { AI_DIFFICULTY_TIERS, aiDifficultyTier, type AiDifficultyTierId } from '../../ai/difficulty/AiDifficultyTiers';
import { isEditableEventTarget } from '../../input/devices/EditableTarget';
import { AI_PERSONALITY_CHOICES, resolveAiPersonality, type AiPersonalityChoice } from '../session/SideControllers';
import type { Bey } from '../../bey/core/Bey';
import { AI_STYLE_LABELS, aiCapabilities, aiStyleLines } from './aiExplanation';
import { BEY_ROSTER, rosterEntry } from './beyRoster';
import { button, el, ensureFrontendStyle, keyHint } from './frontendStyle';
import { navigationIntent, wrapIndex } from './listNavigation';
import { ROUNDS_TO_WIN_CHOICES, describeRoundsToWin, type RoundsToWin } from './matchScore';
import { CLASH_IMPACT_RANGE, matchupLines, normalizeSeedText, withArenaFloor, withArenaPreset, type MatchSetup } from './matchSetup';
import { ARENA_FLOORS, ARENA_FLOOR_IDS, DEFAULT_ARENA_FLOOR, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
import { DEFAULT_MOTION_DIRECTION, MOTION_DIRECTIONS, MOTION_DIRECTION_IDS, type MotionDirectionId } from '../../bey/motion/MotionPresets';
import { ARENA_PRESETS, ARENA_WALL_BOUNCE_RANGE, ARENA_WALL_HEIGHT_RANGE, arenaPreset, isPresetGeometry, type ArenaPresetId } from '../../arena/presets/ArenaPresets';

export interface PregameOptions {
  readonly setup: MatchSetup;
  readonly onStart: (setup: MatchSetup) => void;
  readonly onBack: (setup: MatchSetup) => void;
}

interface ChoiceOption<T> {
  readonly value: T;
  readonly label: string;
  readonly accentCss?: string;
}

interface ChoiceRow<T> {
  readonly id: string;
  readonly label: string;
  readonly options: readonly ChoiceOption<T>[];
  get(setup: MatchSetup): T;
  set(setup: MatchSetup, value: T): MatchSetup;
}

// Heterogeneous rows share one list; each row only ever sees its own value type.
type AnyChoiceRow = ChoiceRow<never> & ChoiceRow<unknown>;

/** Compact names for the floor row's buttons (full names in the rules panel). */
const ARENA_FLOOR_SHORT_LABELS: Readonly<Record<ArenaFloorId, string>> = {
  flat: 'Flat',
  'bowl-a': 'Bowl A · Dish',
  'bowl-b': 'Bowl B · Funnel',
  'bowl-c': 'Bowl C · Plateau',
};

const ROWS: readonly AnyChoiceRow[] = [
  row<string>({
    id: 'opponent-bey',
    label: 'Opponent Bey',
    options: BEY_ROSTER.map((e) => ({ value: e.definition.id, label: e.label, accentCss: e.accentCss })),
    get: (s) => s.opponentBeyId,
    set: (s, v) => ({ ...s, opponentBeyId: v }),
  }),
  row<AiDifficultyTierId>({
    id: 'ai-level',
    label: 'AI level',
    options: AI_DIFFICULTY_TIERS.map((t) => ({ value: t.id, label: t.label })),
    get: (s) => s.ai.tier,
    set: (s, v) => ({ ...s, ai: { ...s.ai, tier: v } }),
  }),
  row<AiPersonalityChoice>({
    id: 'ai-style',
    label: 'AI style',
    options: AI_PERSONALITY_CHOICES.map((c) => ({ value: c, label: AI_STYLE_LABELS[c] })),
    get: (s) => s.ai.style,
    set: (s, v) => ({ ...s, ai: { ...s.ai, style: v } }),
  }),
  row<ArenaPresetId>({
    id: 'arena',
    label: 'Arena',
    options: ARENA_PRESETS.map((p) => ({ value: p.id, label: p.label, accentCss: `#${p.theme.rimHex.toString(16).padStart(6, '0')}` })),
    get: (s) => s.arena.presetId,
    set: (s, v) => withArenaPreset(s, v),
  }),
  row<ArenaFloorId>({
    id: 'arena-floor',
    label: 'Floor (playtest)',
    options: ARENA_FLOOR_IDS.map((id) => ({ value: id, label: ARENA_FLOOR_SHORT_LABELS[id] })),
    get: (s) => s.arena.geometry.floor ?? DEFAULT_ARENA_FLOOR,
    set: (s, v) => withArenaFloor(s, v),
  }),
  row<MotionDirectionId>({
    id: 'motion',
    label: 'Movement',
    options: MOTION_DIRECTION_IDS.map((id) => ({ value: id, label: MOTION_DIRECTIONS[id].name })),
    get: (s) => s.motion ?? DEFAULT_MOTION_DIRECTION,
    set: (s, v) => ({ ...s, motion: v }),
  }),
  row<RoundsToWin>({
    id: 'rounds',
    label: 'Match length',
    options: ROUNDS_TO_WIN_CHOICES.map((n) => ({ value: n, label: n === 1 ? '1 round' : `First to ${n}` })),
    get: (s) => s.roundsToWin,
    set: (s, v) => ({ ...s, roundsToWin: v }),
  }),
];

function row<T>(definition: ChoiceRow<T>): AnyChoiceRow {
  return definition as unknown as AnyChoiceRow;
}

export class PregameScreen {
  private readonly root = el('div', 'cb-screen cb-screen--opaque cb-pregame', 'pregame');
  private readonly rowButtons: HTMLButtonElement[][] = [];
  private readonly explanation = el('div', 'cb-pregame__explain', 'pregame-explanation');
  private readonly sliders: { readonly input: HTMLInputElement; readonly output: HTMLOutputElement; readonly read: (setup: MatchSetup) => number; readonly format: (value: number) => string }[] = [];
  private readonly seedInput = el('input', 'cb-pregame__seed', 'pregame-seed');
  private setup: MatchSetup;
  private focusRow = 0;
  private closed = false;

  constructor(
    mount: HTMLElement,
    private readonly options: PregameOptions,
  ) {
    ensureFrontendStyle();
    injectPregameStyle();
    this.setup = options.setup;

    const layout = el('div', 'cb-pregame__layout');
    const header = el('header', 'cb-pregame__header');
    const eyebrow = el('p', 'cb-eyebrow');
    eyebrow.textContent = 'Match setup';
    const title = el('h1', 'cb-title');
    title.textContent = 'Pregame simulator';
    const you = rosterEntry(this.setup.playerBeyId);
    const youLine = el('p', 'cb-pregame__you', 'pregame-player');
    youLine.style.setProperty('--bey-accent', you.accentCss);
    youLine.textContent = `You play ${you.label}`;
    header.append(eyebrow, title, youLine);

    const controls = el('section', 'cb-panel cb-pregame__controls');
    controls.setAttribute('aria-label', 'Match setup');
    ROWS.forEach((choiceRow, rowIndex) => controls.append(this.buildRow(choiceRow, rowIndex)));
    controls.append(this.buildAdvanced());

    const explain = el('section', 'cb-panel cb-pregame__explain-panel');
    explain.setAttribute('aria-label', 'What to expect');
    const explainTitle = el('h2', 'cb-pregame__heading');
    explainTitle.textContent = 'What to expect';
    explain.append(explainTitle, this.explanation);

    const footer = el('div', 'cb-footer cb-pregame__footer');
    const hints = el('div', 'cb-footer__hints');
    hints.append(keyHint(['↑', '↓'], 'Row'), keyHint(['←', '→'], 'Change'), keyHint(['Enter'], 'Start'), keyHint(['Esc'], 'Back'));
    footer.append(
      hints,
      button('Back', '', 'pregame-back', () => this.back()),
      button('Start match', 'cb-button--primary', 'pregame-start', () => this.start()),
    );

    layout.append(header, controls, explain, footer);
    this.root.append(layout);
    mount.append(this.root);

    this.refresh();
    this.rowButtons[0]?.find((b) => b.getAttribute('aria-checked') === 'true')?.focus();
    window.addEventListener('keydown', this.handleKey);
  }

  getSetup(): MatchSetup {
    return this.setup;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.handleKey);
    this.root.remove();
  }

  private buildRow(choiceRow: AnyChoiceRow, rowIndex: number): HTMLElement {
    const wrapper = el('div', 'cb-pregame__row');
    const label = el('span', 'cb-field-label');
    label.id = `pregame-label-${choiceRow.id}`;
    label.textContent = choiceRow.label;
    const group = el('div', 'cb-segments', `pregame-${choiceRow.id}`);
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', label.id);
    const buttons: HTMLButtonElement[] = [];
    for (const option of choiceRow.options) {
      const node = el('button', 'cb-segment', `pregame-${choiceRow.id}-${String(option.value)}`);
      node.type = 'button';
      node.setAttribute('role', 'radio');
      node.textContent = option.label;
      if (option.accentCss) node.style.setProperty('--bey-accent', option.accentCss);
      node.addEventListener('click', () => {
        this.focusRow = rowIndex;
        this.update(choiceRow.set(this.setup, option.value as never));
      });
      buttons.push(node);
      group.append(node);
    }
    this.rowButtons[rowIndex] = buttons;
    wrapper.append(label, group);
    return wrapper;
  }

  private buildAdvanced(): HTMLElement {
    const details = el('details', 'cb-pregame__advanced', 'pregame-advanced');
    const summary = el('summary');
    summary.textContent = 'Advanced rules';
    details.append(summary);

    details.append(
      this.slider({
        id: 'wall-height',
        label: 'Wall height',
        range: ARENA_WALL_HEIGHT_RANGE,
        read: (s) => s.arena.geometry.wallHeightM,
        write: (s, v) => ({ ...s, arena: { ...s.arena, geometry: { ...s.arena.geometry, wallHeightM: v } } }),
        format: (v) => `${v.toFixed(1)} m`,
        note: 'A low wall lets a launched Bey fly out of the arena; a tall one keeps it in.',
      }),
      this.slider({
        id: 'wall-bounce',
        label: 'Wall bounce',
        range: ARENA_WALL_BOUNCE_RANGE,
        read: (s) => s.arena.geometry.wallRestitution,
        write: (s, v) => ({ ...s, arena: { ...s.arena, geometry: { ...s.arena.geometry, wallRestitution: v } } }),
        format: (v) => v.toFixed(2),
        note: 'How hard the wall throws a Bey back into the fight.',
      }),
      this.slider({
        id: 'clash-impact',
        label: 'Clash impact',
        range: CLASH_IMPACT_RANGE,
        read: (s) => s.clashImpactMultiplier,
        write: (s, v) => ({ ...s, clashImpactMultiplier: v }),
        format: (v) => `×${v.toFixed(2)}`,
        note: 'How hard the loser of a Clash is knocked back and how much Stability it loses.',
      }),
      this.slider({
        id: 'ring-out-delay',
        label: 'Ring-out delay',
        range: RING_OUT_DELAY_RANGE,
        read: (s) => s.rules.ringOutDelayS,
        write: (s, v) => ({ ...s, rules: { ...s.rules, ringOutDelayS: v } }),
        format: (v) => `${v.toFixed(2)} s`,
        note: 'How long a Bey must stay outside the arena before the ring-out counts (back inside resets it). 0 = instant. Provisional default 1.5 s.',
      }),
      this.slider({
        id: 'dash-cooldown',
        label: 'Dash cooldown',
        range: DASH_COOLDOWN_RANGE,
        read: (s) => s.rules.dashCooldownS,
        write: (s, v) => ({ ...s, rules: { ...s.rules, dashCooldownS: v } }),
        format: (v) => `${v.toFixed(2)} s`,
        note: 'Time after a Dash before the next one can charge, for you and the AI (the CD line on the HUD refills; full = ready). Provisional default 1.5 s.',
      }),
      this.slider({
        id: 'momentum-gain',
        label: 'Momentum gain',
        range: MOMENTUM_GAIN_RANGE,
        read: (s) => s.rules.momentumGain,
        write: (s, v) => ({ ...s, rules: { ...s.rules, momentumGain: v } }),
        format: (v) => `+${Math.round(v * 100)}%`,
        note: 'How much full momentum raises the top speed. Default +100% (twice the top speed).',
      }),
      this.slider({
        id: 'momentum-fill',
        label: 'Momentum build-up',
        range: MOMENTUM_FILL_RANGE,
        read: (s) => s.rules.momentumFillS,
        write: (s, v) => ({ ...s, rules: { ...s.rules, momentumFillS: v } }),
        format: (v) => `${v.toFixed(1)} s`,
        note: 'Seconds of fast, steady movement to fill momentum. Default 4 s.',
      }),
      this.slider({
        id: 'momentum-decay',
        label: 'Momentum decay',
        range: MOMENTUM_DECAY_RANGE,
        read: (s) => s.rules.momentumDecayS,
        write: (s, v) => ({ ...s, rules: { ...s.rules, momentumDecayS: v } }),
        format: (v) => `${v.toFixed(2)} s`,
        note: 'Seconds for full momentum to drain when you brake, turn hard or stop. Default 2 s.',
      }),
      this.slider({
        id: 'body-collision-damage',
        label: 'Body collision damage',
        range: BODY_COLLISION_DAMAGE_RANGE,
        read: (s) => s.rules.bodyCollisionDamage,
        write: (s, v) => ({ ...s, rules: { ...s.rules, bodyCollisionDamage: v } }),
        format: (v) => `×${v.toFixed(1)}`,
        note: 'Stability damage the slower Bey takes when the Beys collide without attacking. ×1 = a Circular Attack at a 10 m/s speed difference. Provisional.',
      }),
      this.slider({
        id: 'momentum-loss',
        label: 'Momentum loss on collision',
        range: MOMENTUM_LOSS_ON_COLLISION_RANGE,
        read: (s) => s.rules.momentumLossOnCollision,
        write: (s, v) => ({ ...s, rules: { ...s.rules, momentumLossOnCollision: v } }),
        format: (v) => `${Math.round(v * 100)}%`,
        note: 'Share of momentum the faster Bey loses in a collision (also on a hit taken or a wall impact). Provisional 50%.',
      }),
    );

    const seedRow = el('label', 'cb-pregame__row');
    const seedLabel = el('span', 'cb-field-label');
    seedLabel.textContent = 'Seed';
    this.seedInput.type = 'text';
    this.seedInput.placeholder = 'random each match';
    this.seedInput.maxLength = 64;
    this.seedInput.spellcheck = false;
    this.seedInput.addEventListener('input', () => this.update({ ...this.setup, seedText: normalizeSeedText(this.seedInput.value) }));
    seedRow.append(seedLabel, this.seedInput);
    const seedNote = el('p', 'cb-hint');
    seedNote.textContent = 'Same seed, same inputs, same match. Leave blank for a new one every time.';

    details.append(seedRow, seedNote);
    return details;
  }

  private slider(spec: {
    id: string;
    label: string;
    range: { readonly min: number; readonly max: number; readonly step: number };
    read: (setup: MatchSetup) => number;
    write: (setup: MatchSetup, value: number) => MatchSetup;
    format: (value: number) => string;
    note: string;
  }): DocumentFragment {
    const fragment = document.createDocumentFragment();
    const wrapper = el('label', 'cb-pregame__row cb-pregame__row--slider');
    const label = el('span', 'cb-field-label');
    label.textContent = spec.label;
    const input = el('input', 'cb-pregame__slider', `pregame-${spec.id}`);
    input.type = 'range';
    input.min = String(spec.range.min);
    input.max = String(spec.range.max);
    input.step = String(spec.range.step);
    const output = el('output', 'cb-pregame__value', `pregame-${spec.id}-value`);
    input.addEventListener('input', () => this.update(spec.write(this.setup, Number(input.value))));
    this.sliders.push({ input, output, read: spec.read, format: spec.format });
    wrapper.append(label, input, output);
    const note = el('p', 'cb-hint');
    note.textContent = spec.note;
    fragment.append(wrapper, note);
    return fragment;
  }

  private update(next: MatchSetup): void {
    this.setup = next;
    this.refresh();
  }

  private refresh(): void {
    ROWS.forEach((choiceRow, rowIndex) => {
      const current = choiceRow.get(this.setup);
      choiceRow.options.forEach((option, optionIndex) => {
        const node = this.rowButtons[rowIndex]![optionIndex]!;
        const checked = option.value === current;
        node.setAttribute('aria-checked', String(checked));
        node.tabIndex = checked ? 0 : -1;
      });
    });
    for (const slider of this.sliders) {
      const value = slider.read(this.setup);
      slider.input.value = String(value);
      slider.output.textContent = slider.format(value);
    }
    if (normalizeSeedText(this.seedInput.value) !== this.setup.seedText) this.seedInput.value = this.setup.seedText ?? '';
    this.renderExplanation();
  }

  private renderExplanation(): void {
    const setup = this.setup;
    const you = rosterEntry(setup.playerBeyId);
    const them = rosterEntry(setup.opponentBeyId);
    const tier = aiDifficultyTier(setup.ai.tier);
    const personality = resolveAiPersonality(setup.ai.style, { definition: them.definition } as Bey);

    const matchup = el('div', 'cb-pregame__block', 'pregame-matchup');
    const matchupTitle = el('h3', 'cb-pregame__subheading');
    matchupTitle.innerHTML = '';
    const youTag = tag(you.label, you.accentCss);
    const themTag = tag(them.label, them.accentCss);
    matchupTitle.append(youTag, ' vs ', themTag);
    const list = el('ul', 'cb-pregame__lines');
    for (const line of matchupLines(setup)) {
      const item = el('li', `is-${line.tone}`);
      item.textContent = line.text;
      list.append(item);
    }
    matchup.append(matchupTitle, list);

    const ai = el('div', 'cb-pregame__block', 'pregame-ai');
    const aiTitle = el('h3', 'cb-pregame__subheading');
    aiTitle.textContent = `${tier.label} · ${AI_STYLE_LABELS[setup.ai.style]}`;
    const aiSummary = el('p', 'cb-pregame__summary');
    aiSummary.textContent = tier.summary;
    const bars = el('div', 'cb-pregame__caps');
    for (const capability of aiCapabilities(personality, tier.profile)) {
      const cap = el('div', 'cb-pregame__cap', `pregame-cap-${capability.key}`);
      const name = el('span', 'cb-pregame__cap-name');
      name.textContent = capability.label;
      const bar = el('div', 'cb-bar');
      const fill = el('div', 'cb-bar__fill');
      fill.style.width = `${Math.round(capability.score * 100)}%`;
      bar.append(fill);
      const readout = el('span', 'cb-pregame__cap-readout');
      readout.textContent = capability.readout;
      cap.append(name, bar, readout);
      bars.append(cap);
    }
    const style = el('ul', 'cb-pregame__lines cb-pregame__style');
    for (const line of aiStyleLines(personality)) {
      const item = el('li');
      item.textContent = line;
      style.append(item);
    }
    ai.append(aiTitle, aiSummary, bars, style);

    const rules = el('div', 'cb-pregame__block', 'pregame-rules');
    const rulesTitle = el('h3', 'cb-pregame__subheading');
    rulesTitle.textContent = 'Rules';
    const rulesList = el('ul', 'cb-pregame__lines');
    const addRule = (text: string): void => {
      const item = el('li');
      item.textContent = text;
      rulesList.append(item);
    };
    const arena = arenaPreset(setup.arena.presetId);
    const walls = setup.arena.geometry;
    addRule(`${arena.label}: ${arena.description}`);
    if (!isPresetGeometry(arena.id, walls)) addRule(`Custom walls: ${walls.wallHeightM.toFixed(1)} m high, bounce ${walls.wallRestitution.toFixed(2)}`);
    const floor = ARENA_FLOORS[walls.floor ?? DEFAULT_ARENA_FLOOR];
    addRule(floor.id === 'flat' ? `Floor: ${floor.label}` : `Floor (playtest): ${floor.label} — ${floor.description} Temporary look; walls measured from the rim.`);
    const motion = MOTION_DIRECTIONS[setup.motion ?? DEFAULT_MOTION_DIRECTION];
    addRule(`Movement ${motion.name}: ${motion.summary}`);
    addRule(describeRoundsToWin(setup.roundsToWin));
    addRule('A round ends on a ring-out or a knock-out (a hit while broken). A draw scores nobody.');
    addRule(setup.clashImpactMultiplier === 1 ? 'Standard Clash impact' : `Clash impact ×${setup.clashImpactMultiplier.toFixed(2)}`);
    addRule(setup.seedText === null ? 'New random seed every match' : `Fixed seed "${setup.seedText}"`);
    rules.append(rulesTitle, rulesList);

    this.explanation.replaceChildren(matchup, ai, rules);
  }

  private start(): void {
    if (!this.closed) this.options.onStart(this.setup);
  }

  private back(): void {
    if (!this.closed) this.options.onBack(this.setup);
  }

  private changeFocusedRow(delta: number): void {
    const choiceRow = ROWS[this.focusRow]!;
    const index = choiceRow.options.findIndex((o) => o.value === choiceRow.get(this.setup));
    const next = choiceRow.options[wrapIndex(index, delta, choiceRow.options.length)]!;
    this.update(choiceRow.set(this.setup, next.value as never));
    this.focusCheckedIn(this.focusRow);
  }

  private focusCheckedIn(rowIndex: number): void {
    this.rowButtons[rowIndex]?.find((b) => b.getAttribute('aria-checked') === 'true')?.focus();
  }

  private readonly handleKey = (event: KeyboardEvent): void => {
    const intent = navigationIntent(event.code);
    if (!intent) return;
    // Typing a seed: keys belong to the field; Esc and Enter leave it.
    if (isEditableEventTarget(event.target)) {
      if (intent !== 'back' && event.code !== 'Enter') return;
      if (intent === 'back') {
        event.preventDefault();
        (event.target as HTMLElement).blur();
        return;
      }
    }
    // The sliders and the Advanced toggle keep their own keys.
    if ((this.sliders.some((sl) => sl.input === event.target) && (intent === 'decrease' || intent === 'increase')) || (event.target instanceof HTMLElement && event.target.tagName === 'SUMMARY' && intent === 'confirm')) return;
    // Enter/Space on Back or Start activates that button (Z still means "start").
    if (intent === 'confirm' && event.code !== 'KeyZ' && event.target instanceof HTMLButtonElement && !event.target.classList.contains('cb-segment')) return;
    event.preventDefault();
    switch (intent) {
      case 'previous':
        this.focusRow = wrapIndex(this.focusRow, -1, ROWS.length);
        this.focusCheckedIn(this.focusRow);
        break;
      case 'next':
        this.focusRow = wrapIndex(this.focusRow, 1, ROWS.length);
        this.focusCheckedIn(this.focusRow);
        break;
      case 'decrease':
        this.changeFocusedRow(-1);
        break;
      case 'increase':
        this.changeFocusedRow(1);
        break;
      case 'confirm':
        this.start();
        break;
      case 'back':
        this.back();
        break;
    }
  };
}

function tag(label: string, accentCss: string): HTMLElement {
  const node = el('span', 'cb-pregame__tag');
  node.style.setProperty('--bey-accent', accentCss);
  node.textContent = label;
  return node;
}

let pregameStyleInjected = false;
function injectPregameStyle(): void {
  if (pregameStyleInjected) return;
  pregameStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .cb-pregame__layout { box-sizing: border-box; max-width: 1180px; margin: 0 auto; padding: 28px 24px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "header header" "controls explain" "footer footer"; gap: 18px; }
    .cb-pregame__header { grid-area: header; }
    .cb-pregame__you { margin: 6px 0 0; color: var(--cb-text-dim); }
    .cb-pregame__you::before { content: ''; display: inline-block; width: 10px; height: 10px; margin-right: 8px; border-radius: 50%; background: var(--bey-accent); box-shadow: 0 0 8px var(--bey-accent); }
    .cb-pregame__controls { grid-area: controls; display: flex; flex-direction: column; gap: 16px; align-self: start; }
    .cb-pregame__explain-panel { grid-area: explain; align-self: start; }
    .cb-pregame__footer { grid-area: footer; position: sticky; bottom: 0; padding: 12px 0 4px; background: linear-gradient(transparent, var(--cb-bg) 35%); }
    .cb-pregame__row { display: flex; flex-direction: column; gap: 6px; }
    .cb-pregame__row--slider { display: grid; grid-template-columns: 1fr 64px; grid-template-areas: "label label" "slider value"; align-items: center; }
    .cb-pregame__row--slider .cb-field-label { grid-area: label; }
    .cb-pregame__slider { grid-area: slider; accent-color: var(--cb-accent); }
    .cb-pregame__value { grid-area: value; font: 600 13px/1 var(--cb-mono); text-align: right; }
    .cb-pregame__advanced { border-top: 1px solid var(--cb-line); padding-top: 12px; display: block; }
    .cb-pregame__advanced summary { cursor: pointer; font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--cb-text-dim); }
    .cb-pregame__advanced[open] summary { margin-bottom: 12px; }
    .cb-pregame__advanced .cb-hint { margin: 2px 0 12px; }
    .cb-pregame__seed { font: 14px/1.2 var(--cb-mono); color: var(--cb-text); background: #0b0e16; border: 1px solid var(--cb-line-strong); border-radius: 4px; padding: 9px 10px; }
    .cb-pregame__heading { margin: 0 0 12px; font-size: 13px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--cb-text-dim); font-weight: 600; }
    .cb-pregame__explain { display: flex; flex-direction: column; gap: 16px; }
    .cb-pregame__block { display: flex; flex-direction: column; gap: 8px; }
    .cb-pregame__subheading { margin: 0; font-size: 16px; letter-spacing: 0.06em; }
    .cb-pregame__tag { color: var(--bey-accent); font-weight: 700; letter-spacing: 0.12em; }
    .cb-pregame__summary { margin: 0; font-size: 14px; }
    .cb-pregame__lines { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
    .cb-pregame__lines .is-good { color: var(--cb-win); }
    .cb-pregame__lines .is-bad { color: var(--cb-warn); }
    .cb-pregame__style { color: var(--cb-text-dim); }
    .cb-pregame__caps { display: flex; flex-direction: column; gap: 6px; }
    .cb-pregame__cap { display: grid; grid-template-columns: 120px 90px 1fr; gap: 10px; align-items: center; font-size: 13px; }
    .cb-pregame__cap-readout { color: var(--cb-text-dim); font-size: 12px; }
    @media (max-width: 820px) {
      .cb-pregame__layout { grid-template-columns: minmax(0, 1fr); grid-template-areas: "header" "controls" "explain" "footer"; padding: 16px; }
      .cb-pregame__cap { grid-template-columns: 110px 1fr; }
      .cb-pregame__cap-readout { grid-column: 1 / -1; margin-top: -4px; }
      .cb-footer__hints { display: none; }
    }
  `;
  document.head.append(style);
}
