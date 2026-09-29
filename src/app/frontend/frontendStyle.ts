// ============================================================
// FRONTEND STYLE — SHARED LOOK OF THE PLAYER SCREENS (M10)
// One stylesheet for Character Select, Pregame, Settings, Pause, Results
// and the HUD. Visual direction (owner-authorized for M10): the approved
// prototypes' language — dark industrial simulator surfaces, restrained
// emissive accents, strong hierarchy, readable numbers — with each Bey's
// own color as its accent. Everything is a CSS custom property, so a
// later visual pass retunes one block.
// ============================================================

const STYLE_ID = 'chaosbey-frontend-style';

const CSS = `
:root {
  --cb-bg: #07080d;
  --cb-panel: rgba(12, 15, 23, 0.92);
  --cb-panel-solid: #0c0f17;
  --cb-line: #262e42;
  --cb-line-strong: #3b4766;
  --cb-text: #e4e9f5;
  --cb-text-dim: #8d97b3;
  --cb-accent: #6ee7ff;
  --cb-accent-dim: rgba(110, 231, 255, 0.18);
  --cb-warn: #ffb347;
  --cb-win: #7dffa8;
  --cb-loss: #ff6b6b;
  --cb-font: "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif;
  --cb-mono: ui-monospace, Menlo, Consolas, monospace;
}
.cb-screen { position: fixed; inset: 0; pointer-events: auto; font: 15px/1.45 var(--cb-font); color: var(--cb-text); z-index: 1100; }
.cb-screen[hidden] { display: none; }
.cb-screen--opaque { background: radial-gradient(ellipse at 50% 30%, #121726 0%, var(--cb-bg) 70%); overflow-y: auto; }
.cb-screen *:focus-visible { outline: 2px solid var(--cb-accent); outline-offset: 2px; }
.cb-eyebrow { margin: 0; font-size: 12px; letter-spacing: 0.28em; text-transform: uppercase; color: var(--cb-text-dim); }
.cb-title { margin: 2px 0 0; font-size: 30px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.cb-panel { background: var(--cb-panel); border: 1px solid var(--cb-line); border-radius: 6px; padding: 16px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45); }
.cb-button { font: 600 14px/1 var(--cb-font); letter-spacing: 0.12em; text-transform: uppercase; color: var(--cb-text); background: #151a28; border: 1px solid var(--cb-line-strong); border-radius: 4px; padding: 12px 18px; cursor: pointer; }
.cb-button:hover { background: #1d2436; }
.cb-button--primary { background: var(--cb-accent-dim); border-color: var(--cb-accent); color: #fff; }
.cb-button--primary:hover { background: rgba(110, 231, 255, 0.3); }
.cb-button:disabled { opacity: 0.45; cursor: default; }
.cb-key { display: inline-block; min-width: 1.6em; padding: 1px 5px; border: 1px solid var(--cb-line-strong); border-bottom-width: 2px; border-radius: 3px; font: 12px/1.4 var(--cb-mono); color: var(--cb-text-dim); text-align: center; }
.cb-hint { font-size: 12px; color: var(--cb-text-dim); }
.cb-bar { position: relative; height: 8px; background: #161b29; border-radius: 4px; overflow: hidden; }
.cb-bar__fill { position: absolute; inset: 0 auto 0 0; background: var(--cb-accent); border-radius: 4px; transition: width 120ms linear; }
.cb-footer { display: flex; gap: 12px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
.cb-footer__hints { margin-right: auto; display: flex; gap: 14px; flex-wrap: wrap; }
`;

/** Adds the shared stylesheet once. */
export function ensureFrontendStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

/** document.createElement with a class name (and optional test id). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', testId?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (testId) node.setAttribute('data-testid', testId);
  return node;
}

export function button(label: string, className: string, testId: string, onClick: () => void): HTMLButtonElement {
  const node = el('button', `cb-button ${className}`.trim(), testId);
  node.type = 'button';
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

/** A key cap plus its meaning, for footer hints: "[Enter] Confirm". */
export function keyHint(keys: readonly string[], meaning: string): HTMLElement {
  const hint = el('span', 'cb-hint');
  for (const key of keys) {
    const cap = el('span', 'cb-key');
    cap.textContent = key;
    hint.append(cap, ' ');
  }
  hint.append(meaning);
  return hint;
}
