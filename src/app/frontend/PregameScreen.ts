// ============================================================
// PREGAME SETUP (M10, GDD 56/59; overhauled 2026-10-07 — docs/design-decisions/pregame-overhaul.md)
// The match setup between Character Select and the fight. Left: the configuration in compact sections — Preset (the five
// official Advanced presets + the derived Custom state, and the player's Saved rule sets), Opponent, AI, Arena, Match and
// Advanced (six category tabs, MODIFIED markers against Normal Original, Reset category / Reset all). Right: a short live
// summary; the deeper matchup / AI / rules explanation stays one click away. Simple, dark, no showcase.
// Keyboard: ↑/↓ row, ←/→ change, Enter start, Esc back (inside Advanced: ←/→ switch a tab or move a slider, Tab walks the rest).
// ============================================================

import { AI_DIFFICULTY_TIERS, aiDifficultyTier, type AiDifficultyTierId } from '../../ai/difficulty/AiDifficultyTiers';
import { isEditableEventTarget } from '../../input/devices/EditableTarget';
import { AI_PERSONALITY_CHOICES, resolveAiPersonality, type AiPersonalityChoice } from '../session/SideControllers';
import type { Bey } from '../../bey/core/Bey';
import { AI_STYLE_LABELS, aiCapabilities, aiStyleLines } from './aiExplanation';
import { BEY_ROSTER, rosterEntry } from './beyRoster';
import { button, el, ensureFrontendStyle, keyHint } from './frontendStyle';
import { navigationIntent, wrapIndex } from './listNavigation';
import { ROUNDS_TO_WIN_CHOICES, describeRoundsToWin, type RoundsToWin } from './matchScore';
import { changedRuleLines, defaultMatchRules, deleteRuleConfig, loadRuleConfigs, matchupLines, normalizeSeedText, saveRuleConfig, withArenaFloor, withArenaPreset, withDefaultRules, withRuleConfig, type MatchSetup } from './matchSetup';
import { ADVANCED_CATEGORIES, ADVANCED_CATEGORY_LABELS, ADVANCED_CONTROLS, isLockedByRealMode, isModified, isSharedWithRealMode, isToggle, modifiedCount, normalOriginalValue, readAdvanced, resetCategory, writeAdvanced, type AdvancedCategory, type AdvancedControl } from './advancedControls';
import { RealModePanel } from './RealModePanel';
import { OFFICIAL_PRESETS, applyPreset, detectPreset, presetLabel, type OfficialPresetId } from './pregamePresets';
import { ARENA_FLOORS, ARENA_FLOOR_IDS, DEFAULT_ARENA_FLOOR, type ArenaFloorId } from '../../arena/floor/ArenaFloorProfile';
import { DEFAULT_MOTION_DIRECTION, MOTION_DIRECTIONS, MOTION_DIRECTION_IDS, type MotionDirectionId } from '../../bey/motion/MotionPresets';
import { ARENA_PRESETS, arenaPreset, isPresetGeometry, type ArenaPresetId } from '../../arena/presets/ArenaPresets';

export interface PregameOptions {
  readonly setup: MatchSetup;
  readonly onStart: (setup: MatchSetup) => void;
  readonly onBack: (setup: MatchSetup) => void;
}

type SectionId = 'preset' | 'opponent' | 'ai' | 'arena' | 'match';

const SECTION_TITLES: Readonly<Record<SectionId, string>> = {
  preset: 'Preset',
  opponent: 'Opponent',
  ai: 'AI',
  arena: 'Arena',
  match: 'Match',
};

interface ChoiceOption<T> {
  readonly value: T;
  readonly label: string;
  readonly accentCss?: string;
  /** A short line under the label (the official presets' approved descriptions). */
  readonly description?: string;
}

interface ChoiceRow<T> {
  readonly id: string;
  readonly section: SectionId;
  readonly label: string;
  readonly options: readonly ChoiceOption<T>[];
  get(setup: MatchSetup): T | null;
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

// Row order is the keyboard order (↑/↓). The preset row first, as in the screen.
const ROWS: readonly AnyChoiceRow[] = [
  row<OfficialPresetId>({
    id: 'preset',
    section: 'preset',
    label: 'Advanced preset',
    options: OFFICIAL_PRESETS.map((p) => ({ value: p.id, label: p.label, description: p.description })),
    // Custom (no official preset matches) has no checked option.
    get: (s) => {
      const detected = detectPreset(s);
      return detected === 'custom' ? null : detected;
    },
    set: (s, v) => applyPreset(s, v),
  }),
  row<string>({
    id: 'opponent-bey',
    section: 'opponent',
    label: 'Opponent Bey',
    options: BEY_ROSTER.map((e) => ({ value: e.definition.id, label: e.label, accentCss: e.accentCss })),
    get: (s) => s.opponentBeyId,
    set: (s, v) => ({ ...s, opponentBeyId: v }),
  }),
  row<AiDifficultyTierId>({
    id: 'ai-level',
    section: 'ai',
    label: 'AI level',
    options: AI_DIFFICULTY_TIERS.map((t) => ({ value: t.id, label: t.label })),
    get: (s) => s.ai.tier,
    set: (s, v) => ({ ...s, ai: { ...s.ai, tier: v } }),
  }),
  row<AiPersonalityChoice>({
    id: 'ai-style',
    section: 'ai',
    label: 'AI style',
    options: AI_PERSONALITY_CHOICES.map((c) => ({ value: c, label: AI_STYLE_LABELS[c] })),
    get: (s) => s.ai.style,
    set: (s, v) => ({ ...s, ai: { ...s.ai, style: v } }),
  }),
  row<ArenaPresetId>({
    id: 'arena',
    section: 'arena',
    label: 'Arena',
    options: ARENA_PRESETS.map((p) => ({ value: p.id, label: p.label, accentCss: `#${p.theme.rimHex.toString(16).padStart(6, '0')}` })),
    get: (s) => s.arena.presetId,
    set: (s, v) => withArenaPreset(s, v),
  }),
  row<ArenaFloorId>({
    id: 'arena-floor',
    section: 'arena',
    label: 'Floor (playtest)',
    options: ARENA_FLOOR_IDS.map((id) => ({ value: id, label: ARENA_FLOOR_SHORT_LABELS[id] })),
    get: (s) => s.arena.geometry.floor ?? DEFAULT_ARENA_FLOOR,
    set: (s, v) => withArenaFloor(s, v),
  }),
  row<MotionDirectionId>({
    id: 'motion',
    section: 'match',
    label: 'Movement',
    options: MOTION_DIRECTION_IDS.map((id) => ({ value: id, label: MOTION_DIRECTIONS[id].name })),
    get: (s) => s.motion ?? DEFAULT_MOTION_DIRECTION,
    set: (s, v) => ({ ...s, motion: v }),
  }),
  row<RoundsToWin>({
    id: 'rounds',
    section: 'match',
    label: 'Match length',
    options: ROUNDS_TO_WIN_CHOICES.map((n) => ({ value: n, label: n === 1 ? '1 round' : `First to ${n}` })),
    get: (s) => s.roundsToWin,
    set: (s, v) => ({ ...s, roundsToWin: v }),
  }),
];

function row<T>(definition: ChoiceRow<T>): AnyChoiceRow {
  return definition as unknown as AnyChoiceRow;
}

/** One rendered Advanced control: its row and the parts the refresh updates. */
interface ControlView {
  readonly control: AdvancedControl;
  readonly wrapper: HTMLElement;
  readonly input: HTMLInputElement;
  readonly output: HTMLElement;
  readonly defaultText: HTMLElement;
  readonly modified: HTMLButtonElement;
}

interface TabView {
  readonly category: AdvancedCategory;
  readonly tab: HTMLButtonElement;
  readonly count: HTMLElement;
  readonly panel: HTMLElement;
}

export class PregameScreen {
  private readonly root = el('div', 'cb-screen cb-screen--opaque cb-pregame', 'pregame');
  private readonly rowButtons: HTMLButtonElement[][] = [];
  private readonly customTile = el('div', 'cb-preset-custom', 'pregame-preset-custom');
  private readonly presetState = el('p', 'cb-pregame__state', 'pregame-preset-state');
  private readonly summary = el('dl', 'cb-pregame__facts', 'pregame-summary');
  private readonly explanation = el('div', 'cb-pregame__explain', 'pregame-explanation');
  private readonly views: ControlView[] = [];
  private readonly tabs: TabView[] = [];
  private readonly seedInput = el('input', 'cb-pregame__seed', 'pregame-seed');
  private readonly advanced = el('details', 'cb-pregame__advanced', 'pregame-advanced');
  private readonly advancedCount = el('span', 'cb-pregame__chip', 'pregame-advanced-count');
  /** Bey Real (0.59.0): the alternative mode's switch, camera, presets and every slider of the mode. */
  private readonly real = new RealModePanel({ getSetup: () => this.setup, onChange: (next) => this.update(next) });
  private readonly resetCategoryButton = button('Reset category', 'cb-button--small', 'pregame-reset-category', () => this.update(resetCategory(this.setup, this.activeCategory)));
  private readonly resetAllButton = button('Reset all', 'cb-button--small', 'pregame-reset-defaults', () => this.update(withDefaultRules(this.setup)));
  private setup: MatchSetup;
  private activeCategory: AdvancedCategory = 'movement';
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
    title.textContent = 'Pregame setup';
    const you = rosterEntry(this.setup.playerBeyId);
    const youLine = el('p', 'cb-pregame__you', 'pregame-player');
    youLine.style.setProperty('--bey-accent', you.accentCss);
    youLine.textContent = `You play ${you.label}`;
    header.append(eyebrow, title, youLine);

    const controls = el('section', 'cb-panel cb-pregame__controls');
    controls.setAttribute('aria-label', 'Match setup');
    const sections = new Map<SectionId, HTMLElement>();
    for (const id of Object.keys(SECTION_TITLES) as SectionId[]) {
      const section = el('div', 'cb-pregame__section', `pregame-section-${id}`);
      const heading = el('h2', 'cb-pregame__heading');
      heading.textContent = SECTION_TITLES[id];
      section.append(heading);
      sections.set(id, section);
      controls.append(section);
    }
    ROWS.forEach((choiceRow, rowIndex) => sections.get(choiceRow.section)!.append(this.buildRow(choiceRow, rowIndex)));
    sections.get('preset')!.append(this.presetState, this.savedConfigsRow());
    controls.append(this.buildAdvanced(), this.real.element);

    const side = el('section', 'cb-panel cb-pregame__side');
    side.setAttribute('aria-label', 'Match summary');
    const sideTitle = el('h2', 'cb-pregame__heading');
    sideTitle.textContent = 'Match summary';
    const more = el('details', 'cb-pregame__more', 'pregame-details');
    const moreSummary = el('summary');
    moreSummary.textContent = 'Matchup, AI and rules in detail';
    more.append(moreSummary, this.explanation);
    side.append(sideTitle, this.summary, more);

    const footer = el('div', 'cb-footer cb-pregame__footer');
    const hints = el('div', 'cb-footer__hints');
    hints.append(keyHint(['↑', '↓'], 'Row'), keyHint(['←', '→'], 'Change'), keyHint(['Enter'], 'Start'), keyHint(['Esc'], 'Back'));
    footer.append(
      hints,
      button('Back', '', 'pregame-back', () => this.back()),
      button('Start match', 'cb-button--primary', 'pregame-start', () => this.start()),
    );

    layout.append(header, controls, side, footer);
    this.root.append(layout);
    mount.append(this.root);

    this.refresh();
    this.focusCheckedIn(0);
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
    const isPreset = choiceRow.id === 'preset';
    // A single row under a section of the same name (Opponent, Arena) keeps its label for screen readers only.
    const quietLabel = isPreset || choiceRow.id === 'opponent-bey' || choiceRow.id === 'arena';
    const wrapper = el('div', isPreset ? 'cb-pregame__row cb-pregame__row--presets' : 'cb-pregame__row');
    const label = el('span', quietLabel ? 'cb-field-label cb-visually-hidden' : 'cb-field-label');
    label.id = `pregame-label-${choiceRow.id}`;
    label.textContent = choiceRow.label;
    const group = el('div', isPreset ? 'cb-segments cb-presets' : 'cb-segments', `pregame-${choiceRow.id}`);
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', label.id);
    const buttons: HTMLButtonElement[] = [];
    for (const option of choiceRow.options) {
      const node = el('button', isPreset ? 'cb-segment cb-preset' : 'cb-segment', `pregame-${choiceRow.id}-${String(option.value)}`);
      node.type = 'button';
      node.setAttribute('role', 'radio');
      if (option.description) {
        const name = el('span', 'cb-preset__name');
        name.textContent = option.label;
        const text = el('span', 'cb-preset__text', `pregame-${choiceRow.id}-${String(option.value)}-description`);
        text.textContent = option.description;
        node.append(name, text);
      } else {
        node.textContent = option.label;
      }
      if (option.accentCss) node.style.setProperty('--bey-accent', option.accentCss);
      node.addEventListener('click', () => {
        this.focusRow = rowIndex;
        this.update(choiceRow.set(this.setup, option.value as never));
      });
      buttons.push(node);
      group.append(node);
    }
    if (isPreset) {
      // The derived sixth state: shown, never applied.
      const name = el('span', 'cb-preset__name');
      name.textContent = 'Custom';
      const text = el('span', 'cb-preset__text');
      text.textContent = 'Your own mix of Advanced settings. Not a preset you pick: it shows when no official one matches.';
      this.customTile.append(name, text);
      group.append(this.customTile);
    }
    this.rowButtons[rowIndex] = buttons;
    wrapper.append(label, group);
    return wrapper;
  }

  private buildAdvanced(): HTMLElement {
    const summary = el('summary');
    const summaryTitle = el('span');
    summaryTitle.textContent = 'Advanced';
    summary.append(summaryTitle, this.advancedCount);
    this.advanced.append(summary);

    const tablist = el('div', 'cb-tabs', 'pregame-tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Advanced categories');
    const panels = el('div', 'cb-pregame__panels');
    for (const category of ADVANCED_CATEGORIES) {
      const tab = el('button', 'cb-tab', `pregame-tab-${category}`);
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.id = `pregame-tab-id-${category}`;
      const name = el('span');
      name.textContent = ADVANCED_CATEGORY_LABELS[category];
      const count = el('span', 'cb-tab__count', `pregame-tab-${category}-count`);
      tab.append(name, count);
      tab.addEventListener('click', () => this.selectCategory(category));
      tablist.append(tab);

      const panel = el('section', 'cb-pregame__group', `pregame-group-${category}`);
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.dataset.category = category;
      for (const control of ADVANCED_CONTROLS.filter((c) => c.category === category)) panel.append(this.buildControl(control));
      panels.append(panel);
      this.tabs.push({ category, tab, count, panel });
    }

    // The explanations are one tick away rather than on focus/hover: a note that opens and closes under the pointer moves the rows
    // below it in the middle of a click.
    const notesToggle = el('label', 'cb-pregame__notes');
    const notesInput = el('input', '', 'pregame-show-notes');
    notesInput.type = 'checkbox';
    notesInput.addEventListener('change', () => this.advanced.classList.toggle('show-notes', notesInput.checked));
    notesToggle.append(notesInput, ' Show descriptions');
    const actions = el('div', 'cb-pregame__actions');
    actions.append(this.resetCategoryButton, this.resetAllButton, notesToggle);

    const seedRow = el('label', 'cb-pregame__row cb-pregame__seedrow');
    const seedLabel = el('span', 'cb-field-label');
    seedLabel.textContent = 'Seed';
    this.seedInput.type = 'text';
    this.seedInput.placeholder = 'random each match';
    this.seedInput.maxLength = 64;
    this.seedInput.spellcheck = false;
    this.seedInput.addEventListener('input', () => this.update({ ...this.setup, seedText: normalizeSeedText(this.seedInput.value) }));
    const seedNote = el('p', 'cb-hint');
    seedNote.textContent = 'Same seed, same inputs, same match. Leave blank for a new one every time.';
    seedRow.append(seedLabel, this.seedInput, seedNote);

    this.advanced.append(tablist, panels, actions, seedRow);
    return this.advanced;
  }

  private buildControl(control: AdvancedControl): HTMLElement {
    const wrapper = el('div', isToggle(control) ? 'cb-pregame__ctl cb-pregame__ctl--toggle' : 'cb-pregame__ctl cb-pregame__ctl--slider');
    const head = el('div', 'cb-pregame__ctl-head');
    const labelNode = el('label', 'cb-field-label');
    labelNode.textContent = control.label;
    labelNode.title = control.note;
    const defaultText = el('span', 'cb-pregame__default', `pregame-${control.id}-default`);
    const modified = el('button', 'cb-chip-modified', `pregame-${control.id}-modified`);
    modified.type = 'button';
    modified.textContent = 'Modified';
    modified.title = 'Differs from Normal Original — click to reset this one';
    modified.setAttribute('aria-label', `${control.label} is modified: reset to default`);
    modified.hidden = true;
    modified.addEventListener('click', () => this.update(writeAdvanced(this.setup, control.key, normalOriginalValue(this.setup, control.key))));
    head.append(labelNode, modified, defaultText);

    const input = el('input', isToggle(control) ? 'cb-pregame__toggle' : 'cb-pregame__slider', `pregame-${control.id}`);
    input.id = `pregame-input-${control.id}`;
    labelNode.htmlFor = input.id;
    const note = el('p', 'cb-hint cb-pregame__note');
    note.id = `pregame-note-${control.id}`;
    note.textContent = control.note;
    input.setAttribute('aria-describedby', note.id);
    const output = el(isToggle(control) ? 'span' : 'output', 'cb-pregame__value', `pregame-${control.id}-value`);

    if (isToggle(control)) {
      input.type = 'checkbox';
      input.addEventListener('change', () => this.update(writeAdvanced(this.setup, control.key, input.checked, true)));
      const line = el('div', 'cb-pregame__ctl-line');
      line.append(input, output);
      wrapper.append(head, line, note);
    } else {
      input.type = 'range';
      input.min = String(control.range.min);
      input.max = String(control.range.max);
      input.step = String(control.range.step);
      input.addEventListener('input', () => this.update(writeAdvanced(this.setup, control.key, Number(input.value))));
      const line = el('div', 'cb-pregame__ctl-line');
      line.append(input, output);
      wrapper.append(head, line, note);
    }
    this.views.push({ control, wrapper, input, output, defaultText, modified });
    return wrapper;
  }

  /** Owner, 2026-10-04: save the Advanced rules under a name, and load or delete a saved one. (Overhaul: the "Saved" area.) */
  private savedConfigsRow(): HTMLElement {
    const area = el('div', 'cb-pregame__saved', 'pregame-saved-configs');
    const label = el('span', 'cb-field-label');
    label.textContent = 'Saved';
    const select = el('select', 'cb-pregame__select', 'pregame-saved-select');
    select.setAttribute('aria-label', 'Saved rule sets');
    const refill = (selected?: string): void => {
      const names = Object.keys(loadRuleConfigs()).sort();
      select.replaceChildren(...(names.length ? names : ['(none saved)']).map((n) => {
        const option = el('option');
        option.value = names.length ? n : '';
        option.textContent = n;
        return option;
      }));
      if (selected) select.value = selected;
    };
    const save = button('Save current', 'cb-button--small', 'pregame-save-config', () => {
      const name = window.prompt('Name for these rules:', select.value || 'My rules')?.trim();
      if (!name) return;
      saveRuleConfig(name, this.setup);
      refill(name);
    });
    const load = button('Load', 'cb-button--small', 'pregame-load-config', () => {
      const saved = loadRuleConfigs()[select.value];
      if (saved) this.update(withRuleConfig(this.setup, saved));
    });
    const remove = button('Delete', 'cb-button--small', 'pregame-delete-config', () => {
      if (!select.value) return;
      deleteRuleConfig(select.value);
      refill();
    });
    refill();
    area.append(label, select, save, load, remove);
    return area;
  }

  private selectCategory(category: AdvancedCategory): void {
    this.activeCategory = category;
    this.refresh();
  }

  private update(next: MatchSetup): void {
    this.setup = next;
    this.refresh();
  }

  private refresh(): void {
    const setup = this.setup;
    ROWS.forEach((choiceRow, rowIndex) => {
      const current = choiceRow.get(setup);
      const buttons = this.rowButtons[rowIndex]!;
      let anyChecked = false;
      choiceRow.options.forEach((option, optionIndex) => {
        const node = buttons[optionIndex]!;
        const checked = current !== null && option.value === current;
        anyChecked ||= checked;
        node.setAttribute('aria-checked', String(checked));
        node.tabIndex = checked ? 0 : -1;
      });
      // Custom: nothing checked, but the row stays reachable by Tab.
      if (!anyChecked && buttons[0]) buttons[0].tabIndex = 0;
    });

    const preset = detectPreset(setup);
    const modified = modifiedCount(setup);
    this.customTile.classList.toggle('is-active', preset === 'custom');
    if (preset === 'custom') this.customTile.setAttribute('aria-current', 'true');
    else this.customTile.removeAttribute('aria-current');
    this.presetState.textContent = preset === 'custom' ? `Custom — ${modified} Advanced ${modified === 1 ? 'setting differs' : 'settings differ'} from Normal Original` : `${presetLabel(preset)} is active`;
    this.presetState.dataset.preset = preset;

    for (const view of this.views) {
      const { control } = view;
      const value = readAdvanced(setup, control.key);
      const isMod = isModified(setup, control.key);
      if (isToggle(control)) {
        view.input.checked = value as boolean;
        view.output.textContent = value ? 'On' : 'Off';
        view.defaultText.textContent = `default ${normalOriginalValue(setup, control.key) ? 'on' : 'off'}`;
      } else {
        view.input.value = String(value);
        view.output.textContent = control.format(value as number);
        view.defaultText.textContent = `default ${control.format(normalOriginalValue(setup, control.key) as number)}`;
        const disabled = control.disabledWhen?.(setup) ?? false;
        view.input.disabled = disabled;
        view.wrapper.classList.toggle('is-disabled', disabled);
        view.wrapper.title = isLockedByRealMode(control, setup) ? 'Bloqueado: o modo Bey Real (bloco abaixo) controla este valor.' : isSharedWithRealMode(control, setup) ? 'Em Bey Real este controle é o mesmo do bloco Bey Real (arena e regras).' : '';
      }
      view.modified.hidden = !isMod;
      view.wrapper.classList.toggle('is-modified', isMod);
    }
    for (const view of this.tabs) {
      const active = view.category === this.activeCategory;
      const count = modifiedCount(setup, view.category);
      view.tab.setAttribute('aria-selected', String(active));
      view.tab.tabIndex = active ? 0 : -1;
      view.panel.hidden = !active;
      view.count.textContent = count > 0 ? String(count) : '';
      view.tab.title = count > 0 ? `${count} modified` : 'All default';
    }
    this.real.refresh(setup);
    this.advancedCount.textContent = modified > 0 ? `${modified} modified` : 'default';
    this.advancedCount.classList.toggle('is-modified', modified > 0);
    this.resetCategoryButton.textContent = `Reset ${ADVANCED_CATEGORY_LABELS[this.activeCategory].toLowerCase()}`;
    this.resetCategoryButton.disabled = modifiedCount(setup, this.activeCategory) === 0;
    this.resetAllButton.disabled = modified === 0;

    if (normalizeSeedText(this.seedInput.value) !== setup.seedText) this.seedInput.value = setup.seedText ?? '';
    this.renderSummary(preset, modified);
    this.renderExplanation();
  }

  private renderSummary(preset: ReturnType<typeof detectPreset>, modified: number): void {
    const setup = this.setup;
    const you = rosterEntry(setup.playerBeyId);
    const them = rosterEntry(setup.opponentBeyId);
    const tier = aiDifficultyTier(setup.ai.tier);
    const arena = arenaPreset(setup.arena.presetId);
    const floor = ARENA_FLOORS[setup.arena.geometry.floor ?? DEFAULT_ARENA_FLOOR];
    const r = setup.rules;
    const ways = [r.winByKo ? 'Knock-out' : null, r.winByRingOut ? 'Ring-out' : null, r.winBySpinOut ? 'Spin-out' : null].filter((w): w is string => w !== null);
    const facts: readonly { readonly key: string; readonly label: string; readonly value: string; readonly accentCss?: string }[] = [
      { key: 'player', label: 'You', value: you.label, accentCss: you.accentCss },
      { key: 'opponent', label: 'Opponent', value: them.label, accentCss: them.accentCss },
      { key: 'ai-level', label: 'AI difficulty', value: tier.label },
      { key: 'ai-style', label: 'AI style', value: AI_STYLE_LABELS[setup.ai.style] },
      { key: 'arena', label: 'Arena', value: `${arena.label} · ${floor.label}` },
      { key: 'length', label: 'Match length', value: describeRoundsToWin(setup.roundsToWin) },
      { key: 'wins', label: 'A round ends on', value: `${ways.join(' · ')}${r.roundTimeLimitS > 0 ? ` · draw after ${r.roundTimeLimitS.toFixed(0)} s` : ''}` },
      { key: 'mode', label: 'Mode', value: setup.real?.enabled ? `Bey Real · ${setup.real.camera === 'real' ? 'Bey Real' : setup.real.camera} camera` : 'Classic' },
      { key: 'preset', label: 'Preset', value: presetLabel(preset) },
      { key: 'modified', label: 'Advanced', value: modified === 0 ? 'All Normal Original' : `${modified} ${modified === 1 ? 'setting differs' : 'settings differ'} from Normal Original` },
    ];
    const nodes: HTMLElement[] = [];
    for (const fact of facts) {
      const term = el('dt');
      term.textContent = fact.label;
      const value = el('dd', fact.key === 'modified' && modified > 0 ? 'is-modified' : '', `pregame-summary-${fact.key}`);
      value.textContent = fact.value;
      if (fact.accentCss) {
        value.classList.add('cb-pregame__tag');
        value.style.setProperty('--bey-accent', fact.accentCss);
      }
      nodes.push(term, value);
    }
    this.summary.replaceChildren(...nodes);
  }

  private renderExplanation(): void {
    const setup = this.setup;
    const you = rosterEntry(setup.playerBeyId);
    const them = rosterEntry(setup.opponentBeyId);
    const tier = aiDifficultyTier(setup.ai.tier);
    const personality = resolveAiPersonality(setup.ai.style, { definition: them.definition } as Bey);

    const matchup = el('div', 'cb-pregame__block', 'pregame-matchup');
    const matchupTitle = el('h3', 'cb-pregame__subheading');
    matchupTitle.append(tag(you.label, you.accentCss), ' vs ', tag(them.label, them.accentCss));
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
    const r = setup.rules;
    const ways = [r.winByKo ? 'a knock-out (a hit while broken)' : null, r.winByRingOut ? 'a ring-out' : null, r.winBySpinOut ? 'a spin-out (Stamina 0)' : null].filter((w): w is string => w !== null);
    addRule(`A round ends on ${ways.join(', ')}${r.roundTimeLimitS > 0 ? `, or a draw after ${r.roundTimeLimitS.toFixed(0)} s` : ''}. A draw scores nobody.`);
    if (r.arenaBowlDepthM !== defaultMatchRules().arenaBowlDepthM && walls.floor !== 'flat') addRule(r.arenaBowlDepthM === 0 ? 'Bowl depth 0 m: the floor is flat' : `Bowl depth ${r.arenaBowlDepthM.toFixed(2)} m (default ${defaultMatchRules().arenaBowlDepthM.toFixed(2)} m)`);
    // Item 11 (owner, 2026-10-04): speed decides how hard you hit.
    if (!r.circularAttack) addRule('No Circular attack this match: Z does nothing on a tap — hold it for the Dash. The AI has no Circular either.');
    if (r.speedDamageGain > 0) addRule(`Speed is power: the faster a hit lands, the more damage it deals${r.dashCarriesSpeed ? ', and a Dash keeps the speed you built up' : ''}. Build momentum by moving fast and straight.`);
    const changed = changedRuleLines(setup);
    if (changed.length > 0) addRule(`Changed from the defaults: ${changed.join('; ')}.`);
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
    const current = choiceRow.get(this.setup);
    const index = choiceRow.options.findIndex((o) => o.value === current);
    // Custom (nothing checked): → starts at the first option, ← at the last.
    const nextIndex = index < 0 ? (delta > 0 ? 0 : choiceRow.options.length - 1) : wrapIndex(index, delta, choiceRow.options.length);
    this.update(choiceRow.set(this.setup, choiceRow.options[nextIndex]!.value as never));
    this.focusCheckedIn(this.focusRow);
  }

  private focusCheckedIn(rowIndex: number): void {
    const buttons = this.rowButtons[rowIndex];
    (buttons?.find((b) => b.getAttribute('aria-checked') === 'true') ?? buttons?.[0])?.focus();
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
    const target = event.target instanceof HTMLElement ? event.target : null;
    // The Advanced tabs: ← / → move between categories; ↑ / ↓ stay with the page.
    const tabIndex = this.tabs.findIndex((t) => t.tab === target);
    if (tabIndex >= 0 && (intent === 'decrease' || intent === 'increase')) {
      event.preventDefault();
      const next = this.tabs[wrapIndex(tabIndex, intent === 'increase' ? 1 : -1, this.tabs.length)]!;
      this.selectCategory(next.category);
      next.tab.focus();
      return;
    }
    // Inside the open Advanced panel everything but Enter / Esc keeps its native keys (sliders: ← → ↑ ↓; checkboxes: Space).
    const inAdvanced = target !== null && (this.advanced.contains(target) || this.real.contains(target)) && target.tagName !== 'SUMMARY';
    if (inAdvanced && intent !== 'confirm' && intent !== 'back') return;
    if (target?.tagName === 'INPUT' && (target as HTMLInputElement).type === 'checkbox' && event.code === 'Space') return;
    if (target?.tagName === 'SUMMARY' && intent === 'confirm' && event.code !== 'KeyZ') return;
    // Enter/Space on a plain button (Back, Start, a tab, Modified, Reset…) activates that button (Z still means "start").
    if (intent === 'confirm' && event.code !== 'KeyZ' && target instanceof HTMLButtonElement && !target.classList.contains('cb-segment')) return;
    event.preventDefault();
    switch (intent) {
      case 'previous':
        this.focusRow = target?.tagName === 'SUMMARY' ? ROWS.length - 1 : wrapIndex(this.focusRow, -1, ROWS.length);
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
    .cb-pregame__layout { box-sizing: border-box; max-width: 1180px; margin: 0 auto; padding: 28px 24px; display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(300px, 1fr); grid-template-areas: "header header" "controls side" "footer footer"; gap: 18px; }
    .cb-pregame__header { grid-area: header; }
    .cb-pregame__you { margin: 6px 0 0; color: var(--cb-text-dim); }
    .cb-pregame__you::before { content: ''; display: inline-block; width: 10px; height: 10px; margin-right: 8px; border-radius: 50%; background: var(--bey-accent); box-shadow: 0 0 8px var(--bey-accent); }
    .cb-pregame__controls { grid-area: controls; display: flex; flex-direction: column; gap: 18px; align-self: start; }
    .cb-pregame__side { grid-area: side; align-self: start; position: sticky; top: 16px; }
    .cb-pregame__footer { grid-area: footer; position: sticky; bottom: 0; padding: 12px 0 4px; background: linear-gradient(transparent, var(--cb-bg) 35%); }
    .cb-pregame__section { display: flex; flex-direction: column; gap: 10px; }
    .cb-pregame__section + .cb-pregame__section { border-top: 1px solid var(--cb-line); padding-top: 14px; }
    .cb-pregame__heading { margin: 0; font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--cb-text-dim); font-weight: 600; }
    .cb-pregame__row { display: flex; flex-direction: column; gap: 6px; }
    .cb-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .cb-presets { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 8px; }
    .cb-preset, .cb-preset-custom { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; text-align: left; padding: 10px 12px; border-radius: 4px; }
    .cb-preset { --bey-accent: var(--cb-accent); }
    .cb-preset__name { font: 700 13px/1.2 var(--cb-font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--cb-text); }
    .cb-preset__text { font: 400 12px/1.35 var(--cb-font); letter-spacing: 0; text-transform: none; color: var(--cb-text-dim); }
    .cb-preset[aria-checked="true"] .cb-preset__text { color: var(--cb-text); }
    .cb-preset-custom { border: 1px dashed var(--cb-line); color: var(--cb-text-dim); }
    .cb-preset-custom .cb-preset__name { color: var(--cb-text-dim); }
    .cb-preset-custom.is-active { border-style: solid; border-color: var(--cb-warn); background: rgba(255, 179, 71, 0.08); }
    .cb-preset-custom.is-active .cb-preset__name { color: var(--cb-warn); }
    .cb-pregame__state { margin: 0; font-size: 12px; color: var(--cb-text-dim); }
    .cb-pregame__saved { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .cb-pregame__select { font: 13px/1.2 var(--cb-font); color: var(--cb-text); background: #0b0e16; border: 1px solid var(--cb-line-strong); border-radius: 4px; padding: 7px 8px; min-width: 130px; }
    .cb-button--small { font-size: 12px; padding: 8px 12px; letter-spacing: 0.08em; }
    .cb-pregame__advanced { border-top: 1px solid var(--cb-line); padding-top: 14px; display: block; }
    .cb-pregame__advanced summary { cursor: pointer; display: flex; align-items: center; gap: 10px; font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--cb-text-dim); font-weight: 600; }
    .cb-pregame__advanced[open] summary { margin-bottom: 12px; }
    .cb-pregame__chip { font: 600 11px/1 var(--cb-font); letter-spacing: 0.06em; text-transform: none; color: var(--cb-text-dim); border: 1px solid var(--cb-line); border-radius: 10px; padding: 3px 8px; }
    .cb-pregame__chip.is-modified { color: var(--cb-warn); border-color: var(--cb-warn); }
    .cb-tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid var(--cb-line); margin-bottom: 12px; }
    .cb-tab { display: inline-flex; align-items: center; gap: 6px; font: 600 12px/1 var(--cb-font); letter-spacing: 0.08em; text-transform: uppercase; color: var(--cb-text-dim); background: transparent; border: 0; border-bottom: 2px solid transparent; padding: 9px 10px; cursor: pointer; }
    .cb-tab:hover { color: var(--cb-text); }
    .cb-tab[aria-selected="true"] { color: #fff; border-bottom-color: var(--cb-accent); }
    .cb-tab__count:not(:empty) { font-size: 10px; color: #1a1305; background: var(--cb-warn); border-radius: 8px; padding: 2px 6px; }
    .cb-pregame__group { display: flex; flex-direction: column; gap: 14px; }
    .cb-pregame__group[hidden] { display: none; }
    .cb-pregame__ctl { display: flex; flex-direction: column; gap: 5px; }
    .cb-pregame__ctl.is-disabled { opacity: 0.4; }
    .cb-pregame__ctl-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
    .cb-pregame__ctl-line { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; }
    .cb-pregame__ctl--toggle .cb-pregame__ctl-line { grid-template-columns: auto 1fr; }
    .cb-pregame__slider { accent-color: var(--cb-accent); min-width: 0; width: 100%; }
    .cb-pregame__ctl.is-modified .cb-pregame__slider { accent-color: var(--cb-warn); }
    .cb-pregame__value { font: 600 13px/1 var(--cb-mono); text-align: right; min-width: 64px; }
    .cb-pregame__ctl--toggle .cb-pregame__value { text-align: left; }
    .cb-pregame__default { margin-left: auto; font-size: 11px; color: var(--cb-text-dim); font-weight: 400; letter-spacing: 0; text-transform: none; opacity: 0.8; }
    .cb-chip-modified { font: 700 10px/1 var(--cb-font); letter-spacing: 0.1em; text-transform: uppercase; color: var(--cb-warn); background: rgba(255, 179, 71, 0.1); border: 1px solid rgba(255, 179, 71, 0.5); border-radius: 3px; padding: 3px 6px; cursor: pointer; }
    .cb-chip-modified[hidden] { display: none; }
    .cb-chip-modified:hover { background: rgba(255, 179, 71, 0.22); }
    .cb-pregame__note { display: none; margin: 0; }
    .cb-pregame__advanced.show-notes .cb-pregame__note { display: block; }
    .cb-pregame__toggle { width: 18px; height: 18px; accent-color: var(--cb-accent); }
    .cb-pregame__actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .cb-pregame__notes { margin-left: auto; align-self: center; font-size: 12px; color: var(--cb-text-dim); cursor: pointer; }
    .cb-pregame__seedrow { margin-top: 14px; }
    .cb-pregame__seed { font: 14px/1.2 var(--cb-mono); color: var(--cb-text); background: #0b0e16; border: 1px solid var(--cb-line-strong); border-radius: 4px; padding: 9px 10px; }
    .cb-pregame__side .cb-pregame__heading { margin-bottom: 12px; }
    .cb-pregame__facts { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 8px 14px; font-size: 14px; }
    .cb-pregame__facts dt { color: var(--cb-text-dim); font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; align-self: center; }
    .cb-pregame__facts dd { margin: 0; }
    .cb-pregame__facts dd.is-modified { color: var(--cb-warn); }
    .cb-pregame__more { margin-top: 16px; border-top: 1px solid var(--cb-line); padding-top: 12px; }
    .cb-pregame__more summary { cursor: pointer; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--cb-text-dim); }
    .cb-pregame__more[open] summary { margin-bottom: 12px; }
    .cb-pregame__explain { display: flex; flex-direction: column; gap: 16px; }
    .cb-pregame__block { display: flex; flex-direction: column; gap: 8px; }
    .cb-pregame__subheading { margin: 0; font-size: 16px; letter-spacing: 0.06em; }
    .cb-pregame__tag { color: var(--bey-accent); font-weight: 700; letter-spacing: 0.08em; }
    .cb-pregame__summary { margin: 0; font-size: 14px; }
    .cb-pregame__lines { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; font-size: 13px; }
    .cb-pregame__lines .is-good { color: var(--cb-win); }
    .cb-pregame__lines .is-bad { color: var(--cb-warn); }
    .cb-pregame__style { color: var(--cb-text-dim); }
    .cb-pregame__caps { display: flex; flex-direction: column; gap: 6px; }
    .cb-pregame__cap { display: grid; grid-template-columns: 120px 90px 1fr; gap: 10px; align-items: center; font-size: 13px; }
    .cb-pregame__cap-readout { color: var(--cb-text-dim); font-size: 12px; }
    @media (max-width: 820px) {
      .cb-pregame__layout { grid-template-columns: minmax(0, 1fr); grid-template-areas: "header" "controls" "side" "footer"; padding: 16px; }
      .cb-pregame__side { position: static; }
      .cb-presets { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
      .cb-pregame__cap { grid-template-columns: 110px 1fr; }
      .cb-pregame__cap-readout { grid-column: 1 / -1; margin-top: -4px; }
      .cb-footer__hints { display: none; }
    }
  `;
  document.head.append(style);
}
