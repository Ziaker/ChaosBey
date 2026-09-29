// ============================================================
// MAIN MENU (GDD sections 1.2, 56; M10 lane A)
// The plain game URL opens here. PLAY enters the real player-facing flow:
// Character Select -> Pregame -> Match. Developer tools stay isolated in
// their own section and still use the same ?mode= routing.
// ============================================================

import { appModeHref, type AppMode } from '../modes/appMode';

export interface MainMenuEntry {
  readonly id: string;
  readonly label: string;
  readonly mode: AppMode;
}

export interface MainMenuModel {
  readonly player: readonly MainMenuEntry[];
  readonly developerSectionLabel: string;
  readonly developer: readonly MainMenuEntry[];
}

export const MAIN_MENU: MainMenuModel = {
  player: [{ id: 'play', label: 'PLAY', mode: 'character-select' }],
  developerSectionLabel: 'Developer / Debug',
  developer: [
    { id: 'debug-lab', label: 'DEBUG LAB', mode: 'debug-lab' },
    { id: 'self-test', label: 'SELF TEST', mode: 'self-test' },
  ],
};

export interface MainMenuOptions {
  readonly navigate?: (href: string) => void;
  readonly location?: { readonly pathname: string; readonly search: string };
}

export function startMainMenu(mount: HTMLElement, options: MainMenuOptions = {}): void {
  const location = options.location ?? window.location;
  const navigate = options.navigate ?? ((href: string) => window.location.assign(href));
  injectStyle();

  const root = element('div', 'main-menu');
  root.setAttribute('data-testid', 'main-menu');
  const eyebrow = element('div', 'main-menu__eyebrow');
  eyebrow.textContent = 'COMBAT SIMULATOR';
  const title = element('h1', 'main-menu__title');
  title.textContent = 'CHAOSBEY';
  const subtitle = element('p', 'main-menu__subtitle');
  subtitle.textContent = 'Physics-driven spinning-top combat. Configure the fight, then prove it in the arena.';

  const entryButton = (entry: MainMenuEntry): HTMLButtonElement => {
    const button = element('button', 'main-menu__entry');
    button.type = 'button';
    button.textContent = entry.label;
    button.setAttribute('data-testid', `main-menu-${entry.id}`);
    button.addEventListener('click', () => navigate(appModeHref(entry.mode, location)));
    return button;
  };

  const top = element('nav', 'main-menu__list');
  top.setAttribute('aria-label', 'Main menu');
  top.setAttribute('data-testid', 'main-menu-top');
  for (const entry of MAIN_MENU.player) top.append(entryButton(entry));

  const developerToggle = element('button', 'main-menu__entry main-menu__entry--section');
  developerToggle.type = 'button';
  developerToggle.textContent = MAIN_MENU.developerSectionLabel;
  developerToggle.setAttribute('data-testid', 'main-menu-developer');
  developerToggle.setAttribute('aria-expanded', 'false');
  developerToggle.setAttribute('aria-controls', 'main-menu-developer-section');
  top.append(developerToggle);

  const developer = element('section', 'main-menu__list main-menu__list--developer');
  developer.id = 'main-menu-developer-section';
  developer.setAttribute('aria-label', MAIN_MENU.developerSectionLabel);
  developer.setAttribute('data-testid', 'main-menu-developer-section');
  developer.hidden = true;
  const heading = element('h2', 'main-menu__section-title');
  heading.textContent = MAIN_MENU.developerSectionLabel;
  developer.append(heading);
  const developerButtons = MAIN_MENU.developer.map(entryButton);
  developer.append(...developerButtons);
  const back = element('button', 'main-menu__entry main-menu__entry--back');
  back.type = 'button';
  back.textContent = 'Back';
  back.setAttribute('data-testid', 'main-menu-back');
  developer.append(back);

  const showDeveloper = (open: boolean): void => {
    top.hidden = open;
    developer.hidden = !open;
    developerToggle.setAttribute('aria-expanded', String(open));
    (open ? developerButtons[0] : developerToggle)?.focus();
  };
  developerToggle.addEventListener('click', () => showDeveloper(true));
  back.addEventListener('click', () => showDeveloper(false));
  developer.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      showDeveloper(false);
    }
  });

  root.append(eyebrow, title, subtitle, top, developer);
  mount.append(root);
  top.querySelector('button')?.focus();
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function injectStyle(): void {
  if (document.querySelector('#chaosbey-main-menu-style')) return;
  const style = document.createElement('style');
  style.id = 'chaosbey-main-menu-style';
  style.textContent = `
    .main-menu { pointer-events: auto; position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; background: radial-gradient(circle at 50% 25%, #152036 0, #080b13 42%, #05050a 75%); font: 14px/1.4 ui-monospace, Menlo, Consolas, monospace; color: #d8e0f0; }
    .main-menu__eyebrow { color:#6f9cff; letter-spacing:.24em; font-size:10px; font-weight:700; }
    .main-menu__title { margin: 0; font-size: clamp(36px,7vw,70px); letter-spacing: 0.2em; font-weight: 800; text-indent:.2em; }
    .main-menu__subtitle { width:min(520px,80vw); margin:0 0 16px; color:#8290aa; text-align:center; }
    .main-menu__list { display: flex; flex-direction: column; gap: 8px; min-width: min(320px,80vw); }
    .main-menu__list[hidden] { display: none; }
    .main-menu__section-title { margin: 0 0 4px; font-size: 12px; font-weight: normal; color: #8a96b8; text-transform: uppercase; letter-spacing: 0.1em; text-align: center; }
    .main-menu__entry { font: inherit; letter-spacing:.08em; color: #e6ecff; background: #151d2d; border: 1px solid #405173; padding: 12px 18px; cursor: pointer; }
    .main-menu__entry:first-child { background:linear-gradient(90deg,#557fd8,#88aaf0); color:#07101d; border-color:#afc7ff; font-weight:800; }
    .main-menu__entry:hover, .main-menu__entry:focus-visible { outline: 2px solid #a9c3fa; outline-offset:2px; }
    .main-menu__entry--section { margin-top: 20px; font-size: 11px; color: #8290aa; background: transparent !important; border-style: dashed; font-weight:400 !important; }
    .main-menu__entry--back { margin-top: 8px; font-size: 12px; background: transparent !important; font-weight:400 !important; color:#aab6ca !important; }
  `;
  document.head.append(style);
}
