// ============================================================
// MATCH RESULTS (M10, GDD 56)
// Shown over the frozen arena once the match is decided: who won and how,
// then the next step — play again, change the setup, or leave.
// ============================================================

import { button, el, ensureFrontendStyle, keyHint } from './frontendStyle';
import { navigationIntent, wrapIndex } from './listNavigation';
import type { OutcomeText } from './matchOutcome';

export interface MatchResultsAction {
  readonly id: string;
  readonly label: string;
  readonly primary?: boolean;
  readonly run: () => void;
}

export interface MatchResultsContent {
  readonly outcome: OutcomeText;
  /** Lines under the headline, e.g. the matchup and the score. */
  readonly details: readonly string[];
  readonly actions: readonly MatchResultsAction[];
}

export class MatchResultsScreen {
  private readonly root = el('div', 'cb-screen cb-results', 'match-results');
  private readonly buttons: HTMLButtonElement[] = [];
  private focusIndex = 0;
  private closed = false;

  constructor(mount: HTMLElement, content: MatchResultsContent) {
    ensureFrontendStyle();
    injectResultsStyle();
    this.root.classList.add(`cb-results--${content.outcome.result}`);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'match-results-headline');

    const panel = el('section', 'cb-panel cb-results__panel');
    const headline = el('h1', 'cb-results__headline', 'match-results-headline');
    headline.id = 'match-results-headline';
    headline.textContent = content.outcome.headline;
    const finish = el('p', 'cb-results__finish', 'match-results-finish');
    finish.textContent = content.outcome.finish;
    panel.append(headline, finish);
    for (const line of content.details) {
      const detail = el('p', 'cb-results__detail');
      detail.textContent = line;
      panel.append(detail);
    }

    const row = el('div', 'cb-results__actions');
    content.actions.forEach((action) => {
      const node = button(action.label, action.primary ? 'cb-button--primary' : '', `match-results-${action.id}`, () => {
        if (!this.closed) action.run();
      });
      this.buttons.push(node);
      row.append(node);
    });
    const hints = el('div', 'cb-results__hints');
    hints.append(keyHint(['←', '→'], 'Select'), keyHint(['Enter'], 'Confirm'));
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
    .cb-results__finish { margin: 0 0 6px; font-size: 16px; }
    .cb-results__detail { margin: 0; font-size: 13px; color: var(--cb-text-dim); }
    .cb-results__actions { margin-top: 14px; display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }
    .cb-results__hints { margin-top: 8px; display: flex; gap: 14px; justify-content: center; }
  `;
  document.head.append(style);
}
