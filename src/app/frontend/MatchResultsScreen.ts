// ============================================================
// MATCH RESULTS / MENU DIALOG (M10, GDD 56)
// A centred dialog over the frozen arena: a headline, a line under it,
// details, and a row of actions. Results (who won and how, then the next
// step), the between-rounds result and the Pause menu all use it.
// ←/→ (or ↑/↓) select, Enter confirms, Esc runs `onBack` when given.
// ============================================================

import { button, el, ensureFrontendStyle, keyHint } from './frontendStyle';
import { navigationIntent, wrapIndex } from './listNavigation';

export interface MatchResultsAction {
  readonly id: string;
  readonly label: string;
  readonly primary?: boolean;
  readonly run: () => void;
}

export interface MatchResultsContent {
  /** Headline color: a win, a loss, a draw, or a neutral menu. */
  readonly tone: 'win' | 'loss' | 'draw' | 'neutral';
  readonly headline: string;
  /** The line under the headline (e.g. how the round ended). */
  readonly subline: string;
  /** Root test id and id prefix; defaults to "match-results". */
  readonly testId?: string;
  /** Esc: e.g. Resume on the Pause menu. */
  readonly onBack?: () => void;
  /** Lines under the headline, e.g. the matchup and the score. */
  readonly details: readonly string[];
  readonly actions: readonly MatchResultsAction[];
}

export class MatchResultsScreen {
  private readonly root: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private focusIndex = 0;
  private closed = false;
  private readonly onBack: (() => void) | null;

  constructor(mount: HTMLElement, content: MatchResultsContent) {
    ensureFrontendStyle();
    injectResultsStyle();
    const id = content.testId ?? 'match-results';
    this.onBack = content.onBack ?? null;
    this.root = el('div', `cb-screen cb-results cb-results--${content.tone}`, id);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', `${id}-headline`);

    const panel = el('section', 'cb-panel cb-results__panel');
    const headline = el('h1', 'cb-results__headline', `${id}-headline`);
    headline.id = `${id}-headline`;
    headline.textContent = content.headline;
    const finish = el('p', 'cb-results__finish', `${id}-subline`);
    finish.textContent = content.subline;
    panel.append(headline, finish);
    for (const line of content.details) {
      const detail = el('p', 'cb-results__detail');
      detail.textContent = line;
      panel.append(detail);
    }

    const row = el('div', 'cb-results__actions');
    content.actions.forEach((action) => {
      const node = button(action.label, action.primary ? 'cb-button--primary' : '', `${id}-${action.id}`, () => {
        if (!this.closed) action.run();
      });
      // Tab or a click moves focus too: Enter must act on the button actually focused.
      const index = this.buttons.length;
      node.addEventListener('focus', () => (this.focusIndex = index));
      this.buttons.push(node);
      row.append(node);
    });
    const hints = el('div', 'cb-results__hints');
    hints.append(keyHint(['←', '→'], 'Select'), keyHint(['Enter'], 'Confirm'));
    if (content.onBack) hints.append(keyHint(['Esc'], 'Back'));
    panel.append(row, hints);
    this.root.append(panel);
    mount.append(this.root);

    this.focusIndex = Math.max(0, content.actions.findIndex((a) => a.primary));
    this.buttons[this.focusIndex]?.focus();
    window.addEventListener('keydown', this.handleKey);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    window.removeEventListener('keydown', this.handleKey);
    this.root.remove();
  }

  private readonly handleKey = (event: KeyboardEvent): void => {
    const intent = navigationIntent(event.code);
    if (!intent) return;
    event.preventDefault();
    if (intent === 'previous' || intent === 'decrease') this.moveFocus(-1);
    else if (intent === 'next' || intent === 'increase') this.moveFocus(1);
    else if (intent === 'confirm') this.buttons[this.focusIndex]?.click();
    else if (intent === 'back' && this.onBack && !this.closed) this.onBack();
  };

  private moveFocus(delta: number): void {
    this.focusIndex = wrapIndex(this.focusIndex, delta, this.buttons.length);
    this.buttons[this.focusIndex]?.focus();
  }
}

let resultsStyleInjected = false;
function injectResultsStyle(): void {
  if (resultsStyleInjected) return;
  resultsStyleInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .cb-results { display: flex; align-items: center; justify-content: center; background: rgba(4, 5, 9, 0.55); animation: cb-results-in 240ms ease-out; }
    @keyframes cb-results-in { from { opacity: 0; } to { opacity: 1; } }
    .cb-results__panel { min-width: min(440px, calc(100vw - 32px)); max-width: calc(100vw - 32px); box-sizing: border-box; text-align: center; display: flex; flex-direction: column; gap: 6px; }
    .cb-results__headline { margin: 0; font-size: 44px; letter-spacing: 0.22em; font-weight: 800; }
    .cb-results--win .cb-results__headline { color: var(--cb-win); text-shadow: 0 0 24px rgba(125, 255, 168, 0.35); }
    .cb-results--loss .cb-results__headline { color: var(--cb-loss); text-shadow: 0 0 24px rgba(255, 107, 107, 0.3); }
    .cb-results--draw .cb-results__headline { color: var(--cb-warn); }
    .cb-results--neutral .cb-results__headline { color: var(--cb-text); font-size: 34px; }
    .cb-results__finish { margin: 0 0 6px; font-size: 16px; }
    .cb-results__detail { margin: 0; font-size: 13px; color: var(--cb-text-dim); }
    .cb-results__actions { margin-top: 14px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .cb-results__hints { margin-top: 8px; display: flex; gap: 14px; justify-content: center; }
  `;
  document.head.append(style);
}
