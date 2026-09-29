// ============================================================
// CHARACTER SELECT (M10, GDD 56)
// The player picks their Bey. The focused Bey spins in 3D on the game
// canvas (BeyPreviewStage); the side panel shows its Attack/Defense/
// Stamina ratings and how it handles compared with a default Bey.
// Keyboard: ↑/↓ (or ←/→) to move, Enter/Z to choose, Esc to go back.
// ============================================================

import type { AppRenderer } from '../bootstrap/createRenderer';
import { BEY_ROSTER, formatTrait, rosterTraits, type RosterEntry } from './beyRoster';
import { BeyPreviewStage } from './BeyPreviewStage';
import { button, el, ensureFrontendStyle, keyHint } from './frontendStyle';
import { navigationIntent, wrapIndex } from './listNavigation';

export interface CharacterSelectOptions {
  /** Bey focused when the screen opens. */
  readonly initialBeyId: string;
  readonly onConfirm: (beyId: string) => void;
  readonly onBack: () => void;
}

const RATING_MAX = 10;

export class CharacterSelectScreen {
  private readonly root = el('div', 'cb-screen cb-select', 'character-select');
  private readonly cards: HTMLButtonElement[] = [];
  private readonly detail = el('div', 'cb-select__detail', 'character-select-detail');
  private readonly stage: BeyPreviewStage;
  private focusIndex: number;
  private closed = false;
  private shown = false;

  constructor(
    mount: HTMLElement,
    appRenderer: AppRenderer,
    private readonly options: CharacterSelectOptions,
  ) {
    ensureFrontendStyle();
    injectSelectStyle();
    this.stage = new BeyPreviewStage(appRenderer);
    this.focusIndex = Math.max(0, BEY_ROSTER.findIndex((e) => e.definition.id === options.initialBeyId));

    const panel = el('section', 'cb-panel cb-select__panel');
    panel.setAttribute('aria-label', 'Character select');
    const eyebrow = el('p', 'cb-eyebrow');
    eyebrow.textContent = 'Player 1';
    const title = el('h1', 'cb-title');
    title.textContent = 'Choose your Bey';

    const list = el('div', 'cb-select__list');
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Beys');
    BEY_ROSTER.forEach((entry, index) => {
      const card = el('button', 'cb-select__card', `character-select-option-${entry.definition.id}`);
      card.type = 'button';
      card.setAttribute('role', 'option');
      card.style.setProperty('--bey-accent', entry.accentCss);
      card.append(cardContent(entry));
      card.addEventListener('click', () => {
        if (this.focusIndex === index) this.confirm();
        else this.focus(index);
      });
      card.addEventListener('mouseenter', () => this.focus(index, false));
      this.cards.push(card);
      list.append(card);
    });

    const footer = el('div', 'cb-footer');
    const hints = el('div', 'cb-footer__hints');
    hints.append(keyHint(['↑', '↓'], 'Browse'), keyHint(['Enter'], 'Choose'), keyHint(['Esc'], 'Back'));
    footer.append(
      hints,
      button('Back', '', 'character-select-back', () => this.back()),
      button('Choose', 'cb-button--primary', 'character-select-confirm', () => this.confirm()),
    );

    const header = el('header', 'cb-select__header');
    header.append(eyebrow, title);
    const body = el('div', 'cb-select__body');
    body.append(list, this.detail);
    panel.append(header, body, footer);
    this.root.append(panel);
    mount.append(this.root);

    window.addEventListener('keydown', this.handleKey);
    this.focus(this.focusIndex);
    this.stage.start();
  }

  /** The currently focused Bey. */
  getFocusedBeyId(): string {
    return BEY_ROSTER[this.focusIndex]!.definition.id;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.handleKey);
    this.stage.dispose();
    this.root.remove();
  }

  private focus(index: number, moveKeyboardFocus = true): void {
    const changed = index !== this.focusIndex || !this.shown;
    this.focusIndex = index;
    this.shown = true;
    const entry = BEY_ROSTER[index]!;
    this.cards.forEach((card, i) => {
      card.classList.toggle('is-focused', i === index);
      card.setAttribute('aria-selected', String(i === index));
    });
    if (moveKeyboardFocus) this.cards[index]?.focus();
    if (!changed) return;
    this.renderDetail(entry);
    this.stage.show(entry.definition, Number.parseInt(entry.accentCss.slice(1), 16));
  }

  private renderDetail(entry: RosterEntry): void {
    this.detail.replaceChildren();
    this.detail.style.setProperty('--bey-accent', entry.accentCss);
    const description = el('p', 'cb-select__description');
    description.textContent = entry.description;

    const ratings = el('div', 'cb-select__ratings');
    const { attack, defense, stamina } = entry.definition.ratings;
    ratings.append(ratingRow('Attack', attack), ratingRow('Defense', defense), ratingRow('Stamina', stamina));

    const traits = rosterTraits(entry.definition);
    const traitList = el('dl', 'cb-select__traits');
    const addTrait = (label: string, ratio: number): void => {
      const dt = el('dt');
      dt.textContent = label;
      const dd = el('dd');
      dd.textContent = formatTrait(ratio);
      dd.classList.toggle('is-up', Math.round((ratio - 1) * 100) > 0);
      dd.classList.toggle('is-down', Math.round((ratio - 1) * 100) < 0);
      traitList.append(dt, dd);
    };
    addTrait('Weight', traits.weight);
    addTrait('Top speed', traits.topSpeed);
    addTrait('Acceleration', traits.acceleration);
    addTrait('Grip', traits.grip);
    addTrait('Reach', traits.reach);
    addTrait('Dash speed', traits.dashSpeed);
    const traitsNote = el('p', 'cb-hint');
    traitsNote.textContent = 'Compared with a standard Bey.';

    this.detail.append(description, ratings, traitList, traitsNote);
  }

  private confirm(): void {
    if (this.closed) return;
    this.options.onConfirm(this.getFocusedBeyId());
  }

  private back(): void {
    if (this.closed) return;
    this.options.onBack();
  }

  private readonly handleKey = (event: KeyboardEvent): void => {
    const intent = navigationIntent(event.code);
    if (!intent) return;
    event.preventDefault();
    switch (intent) {
      case 'previous':
      case 'decrease':
        this.focus(wrapIndex(this.focusIndex, -1, BEY_ROSTER.length));
        break;
      case 'next':
      case 'increase':
        this.focus(wrapIndex(this.focusIndex, 1, BEY_ROSTER.length));
        break;
      case 'confirm':
        this.confirm();
        break;
      case 'back':
        this.back();
        break;
    }
  };
}

function cardContent(entry: RosterEntry): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const swatch = el('span', 'cb-select__swatch');
  const text = el('span', 'cb-select__card-text');
  const label = el('span', 'cb-select__label');
  label.textContent = entry.label;
  const role = el('span', 'cb-select__role');
  role.textContent = entry.role;
  text.append(label, role);
  const mini = el('span', 'cb-select__mini');
  const { attack, defense, stamina } = entry.definition.ratings;
  mini.textContent = `ATK ${attack} · DEF ${defense} · STA ${stamina}`;
  fragment.append(swatch, text, mini);
  return fragment;
}

function ratingRow(label: string, value: number): HTMLElement {
  const row = el('div', 'cb-select__rating');
  row.setAttribute('data-rating', label.toLowerCase());
  const name = el('span', 'cb-select__rating-name');
  name.textContent = label;
  const bar = el('div', 'cb-bar');
  const fill = el('div', 'cb-bar__fill');
  fill.style.width = `${(value / RATING_MAX) * 100}%`;
  bar.append(fill);
  const number = el('span', 'cb-select__rating-value');
  number.textContent = `${value}`;
  row.append(name, bar, number);
  return row;
}

let selectStyleInjected = false;
function injectSelectStyle(): void {
  if (selectStyleInjected) return;
  selectStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .cb-select { pointer-events: none; display: flex; align-items: stretch; padding: 24px; box-sizing: border-box; }
    .cb-select__panel { pointer-events: auto; width: min(420px, 100%); display: flex; flex-direction: column; gap: 12px; max-height: 100%; box-sizing: border-box; }
    .cb-select__panel .cb-title { font-size: 24px; }
    .cb-select__body { display: flex; flex-direction: column; gap: 12px; overflow-y: auto; min-height: 0; flex: 1 1 auto; padding-right: 2px; }
    .cb-select__list { display: flex; flex-direction: column; gap: 8px; }
    .cb-select__card { display: grid; grid-template-columns: 6px 1fr auto; gap: 12px; align-items: center; text-align: left; font: inherit; color: var(--cb-text); background: #111522; border: 1px solid var(--cb-line); border-radius: 5px; padding: 10px 12px 10px 0; cursor: pointer; overflow: hidden; }
    .cb-select__card:hover { border-color: var(--cb-line-strong); }
    .cb-select__card.is-focused { border-color: var(--bey-accent); background: linear-gradient(90deg, color-mix(in srgb, var(--bey-accent) 16%, #111522), #111522 70%); box-shadow: 0 0 18px color-mix(in srgb, var(--bey-accent) 25%, transparent); }
    .cb-select__swatch { align-self: stretch; background: var(--bey-accent); opacity: 0.35; }
    .cb-select__card.is-focused .cb-select__swatch { opacity: 1; }
    .cb-select__card-text { display: flex; flex-direction: column; }
    .cb-select__label { font-weight: 700; letter-spacing: 0.16em; }
    .cb-select__role { font-size: 12px; color: var(--cb-text-dim); }
    .cb-select__mini { font: 11px/1 var(--cb-mono); color: var(--cb-text-dim); }
    .cb-select__detail { border-top: 1px solid var(--cb-line); padding-top: 12px; display: flex; flex-direction: column; gap: 10px; }
    .cb-select__description { margin: 0; color: var(--cb-text); font-size: 14px; }
    .cb-select__ratings { display: flex; flex-direction: column; gap: 6px; }
    .cb-select__rating { display: grid; grid-template-columns: 70px 1fr 22px; gap: 10px; align-items: center; font-size: 13px; }
    .cb-select__rating .cb-bar__fill { background: var(--bey-accent); }
    .cb-select__rating-value { font: 600 13px/1 var(--cb-mono); text-align: right; }
    .cb-select__traits { display: grid; grid-template-columns: 1fr auto 1fr auto; gap: 4px 12px; margin: 0; font-size: 13px; }
    .cb-select__traits dt { color: var(--cb-text-dim); }
    .cb-select__traits dd { margin: 0; font: 13px/1.4 var(--cb-mono); text-align: right; }
    .cb-select__traits dd.is-up { color: var(--cb-win); }
    .cb-select__traits dd.is-down { color: var(--cb-warn); }
    @media (max-width: 720px) { .cb-select { padding: 12px; align-items: flex-end; } .cb-select__panel { max-height: 60%; } .cb-select__panel .cb-title { font-size: 20px; } .cb-footer__hints { display: none; } }
  `;
  document.head.append(style);
}
